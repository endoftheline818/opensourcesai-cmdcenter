// Turns a raw telemetry sample into display-ready gauges. Pure: no I/O, no
// clock, no randomness — same discipline as the rest of derive/.
//
// THE RULE THAT SHAPES THIS MODULE: a gauge that cannot be measured must read
// as UNAVAILABLE, never as zero. A 0% GPU-utilisation bar and a "this platform
// exposes no GPU counters" state look identical to a user if both render as an
// empty bar, and one of them is a lie. Every gauge below therefore carries an
// explicit `available` flag and a reason when it is false.

import { toGb } from "../units.js";

const pct = (value) => {
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
};

/**
 * Gauges are labelled by severity so the UI can colour them consistently. The
 * thresholds are deliberately generous: a busy machine is not a broken one, and
 * a dashboard that shouts at 70% utilisation trains people to ignore it.
 */
export function severityFor(kind, percent) {
  if (percent === null) return "unknown";
  if (kind === "temperature") {
    if (percent >= 90) return "critical";
    if (percent >= 80) return "warn";
    return "normal";
  }
  if (kind === "capacity") {
    // Running out of a fixed resource (VRAM, disk) is worth flagging earlier
    // than transient load, because it fails hard rather than getting slow.
    if (percent >= 95) return "critical";
    if (percent >= 85) return "warn";
    return "normal";
  }
  return "normal";
}

const gauge = ({
  id,
  label,
  percent,
  detail,
  kind = "load",
  available = true,
  reason = null,
  severity = null,
}) => ({
  id,
  label,
  percent: available ? pct(percent) : null,
  detail: available ? detail : null,
  // An explicit severity wins over the threshold table. It exists for the one
  // case where the operating system knows better than a percentage does: macOS
  // publishes its own memory-pressure verdict, and that verdict is the same
  // thing Activity Monitor renders.
  severity: available ? (severity ?? severityFor(kind, pct(percent))) : "unknown",
  available,
  reason,
});

/**
 * Bytes macOS can actually hand to a new allocation: free + speculative +
 * inactive + purgeable.
 *
 * Inactive and purgeable pages hold reclaimable file cache. macOS fills them on
 * purpose and drops them on demand, so counting them as "used" — which is what
 * `total - os.freemem()` does — describes a healthy machine as a full one.
 *
 * Validated against a real idle M1: this yields 5.53 GB used where Activity
 * Monitor independently reported 5.54 GB, against the 7.95 GB the old
 * calculation claimed.
 */
function darwinAvailableBytes(darwin) {
  if (!darwin?.available || !darwin.pageSizeBytes) return null;
  const counts = [darwin.free, darwin.speculative, darwin.inactive, darwin.purgeable];
  if (counts.some((count) => !Number.isFinite(count))) return null;
  return counts.reduce((total, count) => total + count, 0) * darwin.pageSizeBytes;
}

/** macOS `kern.memorystatus_vm_pressure_level`. Null means "not measured". */
function darwinPressureSeverity(level) {
  if (level === 1) return "normal";
  if (level === 2) return "warn";
  if (level === 4) return "critical";
  return null;
}

const MIB = 1024 * 1024;

/**
 * VRAM in use that Ollama does not account for, in MiB — or null when that
 * cannot be known. Answers the question the VRAM gauge alone cannot: the card
 * reads 28% with no model loaded, so what is holding it?
 *
 * WHY BY SUBTRACTION, AND NOT BY ASKING WHO. The obvious probe is
 * `nvidia-smi --query-compute-apps=pid,used_memory,process_name`, and it is the
 * wrong tool twice over. On Windows every row's used_memory is literally
 * "[N/A]" — the WDDM driver model does not expose per-process GPU memory, so
 * the one number wanted is unavailable on an entire platform (verified on a
 * 4070 Ti: 20 rows, every one [N/A]). And process_name arrives as a full path,
 * so a feature about VRAM would quietly become a feature that prints
 * "C:\\Users\\<name>\\AppData\\..." into a dashboard — a privacy surface bought
 * for nothing. Both numbers below are ALREADY collected, so this costs no
 * probe, leaks no path, and works wherever the existing two work.
 *
 * WHAT IT IS NOT: this is not "another app is hogging your VRAM". The
 * remainder also holds the display, the compositor, and the driver's own
 * allocations — on a desktop that is most of it, on a headless box nearly
 * none. It is named "outside Ollama" because that is the only claim the
 * arithmetic supports.
 *
 * REFUSES TO GUESS in four cases, each of which would produce a confident
 * wrong number:
 *   - more than one GPU, because Ollama reports VRAM across all of them while
 *     this module reads gpus[0] — the subtraction would be comparing a total
 *     against a part
 *   - Ollama unreachable, because then its share is unknown, not zero
 *   - any loaded model missing size_vram, same reason
 *   - a negative remainder beyond rounding slack, which means the two sources
 *     disagree about reality and neither gets to win silently
 */
function vramOutsideOllamaMib(telemetry) {
  const gpus = telemetry.gpu?.gpus;
  if (!Array.isArray(gpus) || gpus.length !== 1) return null;

  const g = gpus[0];
  if (!Number.isFinite(g.memoryUsedMib)) return null;

  const ollama = telemetry.ollama;
  if (!ollama?.reachable) return null;

  const models = ollama.models;
  if (!Array.isArray(models)) return null;
  if (!models.every((m) => Number.isFinite(m?.sizeVramBytes))) return null;

  const ollamaMib = models.reduce((sum, m) => sum + m.sizeVramBytes, 0) / MIB;
  const outside = g.memoryUsedMib - ollamaMib;

  // Two probes, two accounting conventions: a small negative is rounding, and
  // clamps to zero. A large one is a real disagreement — say nothing rather
  // than print a negative gigabyte.
  if (outside < -64) return null;
  return Math.max(0, outside);
}

function gpuGauges(telemetry) {
  const gpu = telemetry.gpu;
  if (!gpu?.available || !gpu.gpus?.length) {
    // Honest platform note rather than a generic failure: on Apple Silicon
    // there is no free GPU counter at all (powermetrics needs elevation), and
    // saying so is more useful than an empty bar.
    const reason =
      process.platform === "darwin"
        ? "macOS exposes no GPU counters without elevated privileges"
        : (gpu?.reason ?? "no NVIDIA GPU detected");
    return [gauge({ id: "gpu", label: "GPU", percent: null, available: false, reason })];
  }

  const g = gpu.gpus[0];
  const out = [];

  out.push(
    gauge({
      id: "gpu",
      label: "GPU",
      percent: g.utilizationPercent,
      detail: g.name,
    }),
  );

  if (Number.isFinite(g.memoryUsedMib) && Number.isFinite(g.memoryTotalMib) && g.memoryTotalMib > 0) {
    out.push(
      gauge({
        id: "vram",
        label: "VRAM",
        kind: "capacity",
        percent: (g.memoryUsedMib / g.memoryTotalMib) * 100,
        // Deliberately just the reading. The VRAM held outside Ollama belongs
        // to the residency panel, which owns the question of who accounts for
        // what — and, unlike this line, has room to say it. A featured tile's
        // detail is one nowrap ellipsised row sharing width with the big
        // percentage: an appended clause rendered as "3.5 GiB o…" here, which
        // is worse than not saying it.
        detail: `${(g.memoryUsedMib / 1024).toFixed(1)} / ${(g.memoryTotalMib / 1024).toFixed(1)} GiB`,
      }),
    );
  }

  if (Number.isFinite(g.temperatureC)) {
    out.push(
      gauge({
        id: "temp",
        label: "GPU temp",
        kind: "temperature",
        // Scaled against 100 °C so the bar is comparable to the others. The
        // detail line carries the real number, which is what people read.
        percent: g.temperatureC,
        detail: `${g.temperatureC} °C`,
      }),
    );
  }

  if (Number.isFinite(g.fanPercent)) {
    // Sits beside GPU temp on purpose: a temperature only means something once
    // you know what the cooling is doing to hold it. 77 °C at 45% fan is a card
    // with headroom; 77 °C at 100% is a card that has already spent it.
    //
    // NEVER ESCALATES, for the same reason the clock gauge refuses to escalate
    // on "at power limit": a fan at 100% is the cooling system doing its job,
    // not a fault. Warning on correct behaviour is how a dashboard teaches
    // people to ignore it. Heat is already judged by the temp gauge, and
    // genuine thermal distress by the vendor's own throttle verdicts on the
    // clock gauge — a third opinion here would be a heuristic, not a reading.
    //
    // ZERO IS A READING, NOT A GAP — which is exactly what the collector's
    // "Null, never 0" rule buys. nvidia-smi reports "[N/A]" for a board with no
    // fan sensor, and collect maps that to null (gauge omitted entirely, like
    // temp and power). A real 0 therefore means something specific: the fan is
    // deliberately stopped, which is how most modern cards idle. Rendered as a
    // bare "0%" beside a warm GPU that reads as a dead fan, so it is named.
    out.push(
      gauge({
        id: "fan",
        label: "GPU fan",
        percent: g.fanPercent,
        detail:
          g.fanPercent === 0
            ? "stopped (zero-RPM idle)"
            : `${Math.round(g.fanPercent)}% of maximum`,
      }),
    );
  }

  if (Number.isFinite(g.powerDrawW) && Number.isFinite(g.powerLimitW) && g.powerLimitW > 0) {
    out.push(
      gauge({
        id: "power",
        label: "Power",
        percent: (g.powerDrawW / g.powerLimitW) * 100,
        detail: `${Math.round(g.powerDrawW)} / ${Math.round(g.powerLimitW)} W`,
      }),
    );
  }

  if (Number.isFinite(g.clockMhz) && Number.isFinite(g.clockMaxMhz) && g.clockMaxMhz > 0) {
    // The clock gauge NEVER escalates on its own numbers: a card at 11% of max
    // clock is usually a healthy card idling (measured on the 4070 Ti at
    // 345/3135 MHz with the vendor's active-reasons bitmask reading GPU_IDLE),
    // and a heuristic like "low clocks while warm" would cry wolf on every
    // desktop. Severity comes ONLY from the vendor's own throttle verdicts —
    // and when the throttle probe did not answer, no claim is made in either
    // direction, because unknown is not "not throttling".
    const throttle = g.throttle ?? null;
    let detail = `${Math.round(g.clockMhz)} / ${Math.round(g.clockMaxMhz)} MHz`;
    let severity = null;
    if (throttle) {
      if (throttle.hwThermalSlowdown === true) {
        // The hardware pulling the brake itself is the drastic form — clocks
        // halve or worse, and the card is protecting itself from damage.
        severity = "critical";
        detail += " — hardware thermal slowdown active (vendor-reported)";
      } else if (throttle.swThermalSlowdown === true) {
        severity = "warn";
        detail += " — thermal slowdown active (vendor-reported)";
      } else if (throttle.hwSlowdown === true) {
        severity = "warn";
        detail += " — hardware slowdown active (vendor-reported)";
      } else if (throttle.swPowerCap === true) {
        // At the power limit is how GPU Boost is DESIGNED to run under load.
        // Named because it explains a clock figure below max; never escalated,
        // because warning on normal operation trains people to ignore warnings.
        detail += " — at power limit";
      }
    }
    out.push(
      gauge({
        id: "clocks",
        label: "GPU clock",
        percent: (g.clockMhz / g.clockMaxMhz) * 100,
        detail,
        severity,
      }),
    );
  }

  const pcie = pcieGauge(g.pcie);
  if (pcie) out.push(pcie);

  return out;
}

/**
 * Transfer rate per lane per PCIe generation, in GT/s. An explicit table, not
 * 2.5 · 2^(gen−1): the doubling story breaks at Gen 3, which moved to 8 GT/s
 * with denser encoding rather than 10. A generation this table does not know
 * yields no gauge — a percentage against a guessed denominator is not a
 * reading.
 */
const PCIE_GTS = { 1: 2.5, 2: 5, 3: 8, 4: 16, 5: 32, 6: 64 };

/**
 * The negotiated PCIe link against what the link is rated for. This is the
 * silent-misconfiguration detector: a card seated behind a flaky riser or in a
 * chipset slot negotiates ×4 instead of ×16, nothing anywhere says so, and
 * model loads plus every CPU-offloaded token quietly take a fraction of the
 * bus they paid for.
 *
 * NEVER ESCALATES, and the reason is load-bearing: PCIe speed STEPS DOWN AT
 * IDLE BY DESIGN. A Gen 4 card sits at Gen 1 in deep idle and renegotiates
 * under load, so "current < max" describes every healthy desktop on the
 * planet several times a minute. There is no vendor verdict to defer to here
 * (unlike the clock gauge's throttle reasons), so severity stays flat and the
 * detail says what is rated and, when speed is the shortfall, why that can be
 * normal. The one shortfall the note deliberately does NOT excuse is width:
 * lanes are negotiated at link training, and a ×4 where ×16 is rated is worth
 * a reader's attention precisely because this gauge will not shout about it.
 *
 * The percentage is negotiated bandwidth over rated bandwidth — speed × width
 * on both sides — so the sparkline shows the link waking up under load, the
 * same story the clock gauge tells.
 */
function pcieGauge(pcie) {
  if (!pcie) return null;
  const { genCurrent, widthCurrent, genMax, widthMax } = pcie;
  const speedNow = PCIE_GTS[genCurrent];
  const speedMax = PCIE_GTS[genMax];
  if (!speedNow || !speedMax || !(widthCurrent > 0) || !(widthMax > 0)) return null;

  const atMax = genCurrent === genMax && widthCurrent === widthMax;
  let detail = `Gen ${genCurrent} ×${widthCurrent}`;
  if (atMax) {
    detail += ", the rated maximum";
  } else {
    detail += ` — rated Gen ${genMax} ×${widthMax}`;
    // Only the speed shortfall gets the by-design note. Saying it beside a
    // width shortfall would teach readers to ignore the one reading that
    // usually means a riser or the wrong slot.
    if (genCurrent < genMax) detail += "; speed steps down at idle by design";
  }

  return gauge({
    id: "pcie",
    label: "PCIe link",
    percent: ((speedNow * widthCurrent) / (speedMax * widthMax)) * 100,
    detail,
  });
}

export function buildGauges(telemetry) {
  const gauges = [];

  gauges.push(
    telemetry.cpu?.utilizationPercent === null
      ? gauge({
          id: "cpu",
          label: "CPU",
          percent: null,
          available: false,
          // The first poll has no previous sample to diff against, and
          // utilisation is a rate. This resolves itself on the next tick.
          reason: "measuring…",
        })
      : gauge({
          id: "cpu",
          label: "CPU",
          percent: telemetry.cpu.utilizationPercent,
          detail: `${telemetry.cpu.logicalCores} logical cores`,
        }),
  );

  const mem = telemetry.memory;
  if (mem?.totalBytes) {
    // `darwin` is null on Windows and Linux, where os.freemem() already tracks
    // available memory. It is an object on macOS, where it does not.
    const onDarwin = mem.darwin !== null && mem.darwin !== undefined;
    const availableBytes = darwinAvailableBytes(mem.darwin);

    if (onDarwin && availableBytes === null) {
      // macOS, but vm_stat gave us nothing usable. Falling back to
      // `total - os.freemem()` here would warn on a healthy machine, which is
      // the exact defect this path exists to prevent — so the gauge reports
      // unavailable instead of reporting something wrong.
      gauges.push(
        gauge({
          id: "ram",
          label: "System memory",
          percent: null,
          available: false,
          reason: "macOS memory pressure needs vm_stat, which did not report",
        }),
      );
    } else {
      const used = availableBytes === null
        ? mem.totalBytes - mem.freeBytes
        : mem.totalBytes - availableBytes;
      gauges.push(
        gauge({
          id: "ram",
          label: "System memory",
          kind: "capacity",
          percent: (used / mem.totalBytes) * 100,
          detail: `${toGb(used)} / ${toGb(mem.totalBytes)} GB`,
          severity: onDarwin ? darwinPressureSeverity(mem.darwin.pressureLevel) : null,
        }),
      );
    }
  }

  gauges.push(...gpuGauges(telemetry));

  // CPU temperature, where the platform can state one honestly — which today
  // means Linux hwmon, and a driver that is BY NAME the CPU's own (see
  // pickCpuTempSensor in collect). Relevant to this dashboard for one specific
  // reason: the moment a model spills to CPU, these cores become the inference
  // hardware, and their thermals start meaning what the GPU's did.
  //
  // ABSENT, NOT "UNAVAILABLE", everywhere else — the fan precedent, extended
  // deliberately. An unavailable tile carries a reason worth reading once; on
  // every Windows and macOS machine this one would carry the same reason
  // forever, and a permanent apology is furniture. The platform limits are
  // documented at the collector, where the code that hits them lives.
  //
  // The sensor's name rides the reading as provenance because the channels are
  // not interchangeable: k10temp's Tctl is a fan-curve target that reads high
  // by design on some parts, and a reader deciding whether 78 °C matters is
  // owed the fact that the number is Tctl and not Tdie.
  if (Number.isFinite(telemetry.cpu?.tempC)) {
    const source = telemetry.cpu.tempSource;
    gauges.push(
      gauge({
        id: "cputemp",
        label: "CPU temp",
        kind: "temperature",
        // Scaled against 100 °C like the GPU temp gauge; the detail line
        // carries the real number, which is what people read.
        percent: telemetry.cpu.tempC,
        detail: `${telemetry.cpu.tempC} °C${source ? ` — ${source}` : ""}`,
      }),
    );
  }

  if (telemetry.disk?.totalBytes) {
    const used = telemetry.disk.totalBytes - telemetry.disk.freeBytes;
    gauges.push(
      gauge({
        id: "disk",
        label: "Model disk",
        kind: "capacity",
        percent: (used / telemetry.disk.totalBytes) * 100,
        detail: `${toGb(telemetry.disk.freeBytes)} GB free`,
      }),
    );
  }

  // Live I/O of the device under the model store — the reading that explains a
  // cold load. A 20 GB model's first-token wait is mostly this device handing
  // over 20 GB, and until now the only trace it left was a slow chat reply.
  //
  // THE DIAL IS DEVICE-BUSY, NOT A RATE ON AN INVENTED SCALE. A throughput has
  // no honest 100% — this dashboard cannot know a disk's ceiling without
  // benchmarking it — but io_ticks over wall time is a real percentage with a
  // real meaning: the fraction of the interval the device had I/O in flight
  // (iostat's %util). The MB/s figure people actually want rides the detail.
  //
  // NEVER ESCALATES (kind "load", like CPU and GPU): a busy disk during a
  // model load is the machine doing its job — and on NVMe, 100% busy does not
  // even mean saturated, since parallel queues keep accepting work.
  //
  // Absent off Linux (see linuxDiskIo), "measuring…" for the first poll —
  // a rate diffed from nothing is not 0 MB/s, the same honesty the CPU gauge
  // applies to its own first sample.
  const io = telemetry.diskIo;
  if (io?.measuring) {
    gauges.push(
      gauge({
        id: "diskio",
        label: "Model disk I/O",
        percent: null,
        available: false,
        reason: "measuring…",
      }),
    );
  } else if (io && Number.isFinite(io.busyPercent) && Number.isFinite(io.readBytesPerSec)) {
    gauges.push(
      gauge({
        id: "diskio",
        label: "Model disk I/O",
        percent: io.busyPercent,
        detail: `${Math.round(io.readBytesPerSec / 1e6)} MB/s read — ${io.device}`,
      }),
    );
  }

  return gauges;
}

/**
 * Auth-shaped HTTP refusals. Ollama's local API has no authentication at all,
 * so any of these from the configured endpoint means the thing answering is
 * NOT bare Ollama — a gateway or reverse proxy standing in front of it.
 * Gateways hand their clients configs that set OLLAMA_HOST to the proxy port,
 * so on a machine running one this is a likely misconfiguration, not an
 * exotic one — and "your endpoint demands credentials" is an actionable
 * finding where "Ollama offline" would be a false claim about a running
 * server. The same dual-purpose-variable trap as OLLAMA_HOST=0.0.0.0
 * (finding 4), wearing a different value.
 */
const AUTH_STATUSES = new Set([401, 403, 407]);

/**
 * Loaded models, with the one runtime fact that matters most: whether the model
 * actually fits. Below 100% residency it is running partly on CPU, typically at
 * a small fraction of the speed — and the context length it was loaded with is
 * the lever, because the KV cache scales with it.
 */
/**
 * The card's own VRAM accounting, in decimal GB. Independent of Ollama on
 * purpose: how much of a GPU is free is a fact about the GPU, and staying
 * readable while Ollama is unreachable is the whole point of separating it from
 * buildLoaded's residency shape.
 *
 * Single GPU only, for the same reason vramOutsideOllamaMib refuses: this
 * module reads gpus[0], while a runtime may place a model across several cards.
 * "Only 2 GB free" is a confident lie on a box with a second idle card in it.
 */
function buildVram(telemetry) {
  const gpus = telemetry.gpu?.gpus;
  if (!Array.isArray(gpus) || gpus.length !== 1) return null;

  const g = gpus[0];
  if (!Number.isFinite(g.memoryUsedMib) || !Number.isFinite(g.memoryTotalMib)) return null;
  if (g.memoryTotalMib <= 0) return null;

  const freeMib = Math.max(0, g.memoryTotalMib - g.memoryUsedMib);
  return {
    totalGb: toGb(g.memoryTotalMib * MIB),
    usedGb: toGb(g.memoryUsedMib * MIB),
    freeGb: toGb(freeMib * MIB),
  };
}

export function buildLoaded(telemetry) {
  const ollama = telemetry.ollama;
  if (!ollama?.reachable) {
    return { reachable: false, authRequired: AUTH_STATUSES.has(ollama?.httpStatus), models: [] };
  }

  const outsideMib = vramOutsideOllamaMib(telemetry);

  return {
    reachable: true,
    // toGb, not GiB. This is a reported SIZE, and every other size the tool
    // states goes through toGb — model sizes, spill, disk free. GiB appears in
    // exactly one place, the VRAM gauge's own detail string. Rendered live, the
    // chip lands in a panel reading "VRAM 5.3 / 5.3 GB" and "Model disk 354.39
    // GB free", where a lone GiB is the odd one out; the gauge it was briefly
    // matched to is a panel away.
    //
    // Null whenever it cannot be known, and reported only once it is worth
    // reading: below a tenth of a gigabyte this is rounding, and a chip saying
    // "0.0 GB outside Ollama" on every sample is how a true statement turns
    // into furniture. See vramOutsideOllamaMib for what the number is not.
    vramOutsideOllamaGb: (() => {
      if (outsideMib === null) return null;
      const gb = toGb(outsideMib * MIB);
      return gb !== null && gb >= 0.1 ? gb : null;
    })(),
    models: (ollama.models ?? []).map((m) => {
      const residency = m.sizeBytes ? Math.round((m.sizeVramBytes / m.sizeBytes) * 100) : null;
      const spilled = residency !== null && residency < 100;
      return {
        name: m.name,
        sizeGb: toGb(m.sizeBytes),
        sizeVramGb: toGb(m.sizeVramBytes),
        vramResidentPercent: residency,
        spilled,
        // How much of the runtime allocation is NOT in VRAM — named in GB
        // because "partly on CPU" undersells a 2 GB spill and oversells a
        // 40 MB one.
        spilledGb: spilled ? toGb(m.sizeBytes - m.sizeVramBytes) : null,
        contextLength: m.contextLength ?? null,
        expiresAt: m.expiresAt,
      };
    }),
  };
}

export function buildLivePayload(telemetry) {
  return {
    sampledAt: telemetry.sampledAt,
    gauges: buildGauges(telemetry),
    loaded: buildLoaded(telemetry),
    // Raw enough to compute with. The VRAM gauge carries a percentage and a
    // display string; deciding whether a model will fit needs the numbers
    // themselves, and null when they are not knowable.
    vram: buildVram(telemetry),
  };
}
