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

  return out;
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
export function buildLoaded(telemetry) {
  const ollama = telemetry.ollama;
  if (!ollama?.reachable) {
    return { reachable: false, authRequired: AUTH_STATUSES.has(ollama?.httpStatus), models: [] };
  }

  return {
    reachable: true,
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
  };
}
