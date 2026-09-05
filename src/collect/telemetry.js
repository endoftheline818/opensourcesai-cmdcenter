// Live telemetry — the POLL-SAFE collector.
//
// WHY THIS IS SEPARATE FROM collect/index.js
// The full capture costs roughly two seconds on Windows, almost entirely in
// PowerShell process spawns for CIM and registry reads. Polling that every few
// seconds would peg a core to draw a gauge. So the split is by COST, not by
// subject: anything here must be cheap enough to run on a timer, which in
// practice means no PowerShell, no registry, and no system_profiler.
//
// Validation measurements put nvidia-smi around 50ms, /api/ps around 2ms, and
// os.* reads near-free. The whole poll lands well under 100ms.
//
// Static facts (GPU model, VRAM capacity, source disagreements, catalog
// grading) are collected ONCE by collect/index.js and never re-polled — they
// cannot change while the process runs.

import os from "node:os";
import fsp from "node:fs/promises";
import { run } from "./exec.js";

/**
 * CPU utilisation is a RATE, not an instantaneous reading: os.cpus() reports
 * cumulative jiffies since boot, so a single sample says nothing. This is the
 * one piece of state in the collection layer, and it exists because the
 * alternative — making every caller thread a previous sample through — pushes
 * the same state somewhere less obvious.
 */
let previousCpuSample = null;

function sampleCpu() {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    for (const value of Object.values(cpu.times)) total += value;
    idle += cpu.times.idle;
  }
  return { idle, total, at: Date.now() };
}

function cpuUtilisation() {
  const current = sampleCpu();
  const previous = previousCpuSample;
  previousCpuSample = current;

  // The first poll after start has nothing to diff against. Report null rather
  // than 0 — "unknown" and "idle" are different claims, and a gauge that reads
  // 0% on load would be a lie for the first two seconds.
  if (!previous || current.total <= previous.total) return null;

  const idleDelta = current.idle - previous.idle;
  const totalDelta = current.total - previous.total;
  return Math.max(0, Math.min(100, Math.round((1 - idleDelta / totalDelta) * 100)));
}

/**
 * The model disk's I/O counters are a RATE, like CPU utilisation: two reads of
 * /sys/block/<dev>/stat, differenced. Same shape of state, same seam to reset
 * it, and the same first-poll honesty — null is "not yet measurable", never 0.
 */
let previousDiskIoSample = null;

/** Test seam: clears the disk I/O baseline so a suite starts deterministic. */
export function resetDiskIoBaseline() {
  previousDiskIoSample = null;
}

/**
 * Find the mount that serves `targetPath` in /proc/self/mountinfo text, by
 * LONGEST mount-point prefix — /home/x must resolve to /home's device, not
 * /'s. PURE and exported for tests.
 *
 * Mountinfo's mount point is field 5, with spaces octal-escaped as \040; the
 * device is field 3's major:minor, which /sys/dev/block resolves without any
 * parsing of device-name conventions here.
 */
export function resolveMountDevice(mountinfoText, targetPath) {
  const unescape = (v) => v.replace(/\\(\d{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));
  let best = null;
  for (const line of String(mountinfoText).split("\n")) {
    const f = line.split(" ");
    if (f.length < 5) continue;
    const mountPoint = unescape(f[4]);
    const covers =
      mountPoint === "/" || targetPath === mountPoint || targetPath.startsWith(mountPoint + "/");
    if (!covers) continue;
    if (!best || mountPoint.length > best.mountPoint.length) {
      best = { mountPoint, majmin: f[2] };
    }
  }
  return best;
}

/**
 * Parse /sys/block/<dev>/stat (or a partition's): whitespace-separated
 * counters, of which field 3 is sectors read (×512 bytes, a fixed unit
 * regardless of the device's own sector size) and field 10 is io_ticks — the
 * milliseconds the device had I/O in flight. PURE and exported for tests.
 */
export function parseBlockStat(text) {
  const f = String(text).trim().split(/\s+/).map(Number);
  if (f.length < 10 || f.some((n) => !Number.isFinite(n))) return null;
  return { sectorsRead: f[2], ioTicksMs: f[9] };
}

/**
 * Difference two block-stat samples into a rate. PURE and exported for tests.
 *
 * Null on anything that would make the arithmetic lie: a different device
 * (store moved, drive replugged), counters that went BACKWARDS (reset or
 * wrap — the next honest answer is a fresh baseline, not a negative rate), or
 * no elapsed time. Busy is clamped to 100: io_ticks can outrun wall time by a
 * millisecond of rounding, and 101% busy is a typo, not a measurement.
 */
export function diskIoDelta(prev, curr) {
  if (!prev || !curr || prev.device !== curr.device) return null;
  const elapsedMs = curr.at - prev.at;
  if (!(elapsedMs > 0)) return null;
  const sectors = curr.sectorsRead - prev.sectorsRead;
  const ticks = curr.ioTicksMs - prev.ioTicksMs;
  if (sectors < 0 || ticks < 0) return null;
  return {
    readBytesPerSec: (sectors * 512 * 1000) / elapsedMs,
    busyPercent: Math.min(100, (ticks / elapsedMs) * 100),
  };
}

/**
 * Live I/O of the block device under the model store. Linux only, and for the
 * same reasons as linuxCpuTemp below it in spirit: sysfs and procfs are plain
 * files inside the poll budget, while Windows disk counters live behind
 * PowerShell (banned here by the cost rule at the top of this file) and macOS
 * behind iostat spawns. Elsewhere: null, and the gauge is absent.
 *
 * The device measured is the one the filesystem actually reads — the
 * PARTITION (or dm mapping) that /sys/dev/block resolves for the mount, not
 * the whole disk. Its name rides the reading as provenance.
 *
 * Returns null (cannot measure here), { measuring, device } (first comparable
 * sample still pending), or { device, readBytesPerSec, busyPercent }.
 */
async function linuxDiskIo(storePath) {
  if (process.platform !== "linux" || !storePath) return null;
  try {
    const mountinfo = await fsp.readFile("/proc/self/mountinfo", "utf8");
    const mount = resolveMountDevice(mountinfo, storePath);
    if (!mount) return null;

    const sysdev = await fsp.realpath(`/sys/dev/block/${mount.majmin}`);
    const device = sysdev.split("/").pop();
    const stat = parseBlockStat(await fsp.readFile(`${sysdev}/stat`, "utf8"));
    if (!stat) return null;

    const current = { device, ...stat, at: Date.now() };
    const previous = previousDiskIoSample;
    previousDiskIoSample = current;

    const delta = diskIoDelta(previous, current);
    if (!delta) return { measuring: true, device };
    return { device, ...delta };
  } catch {
    return null;
  }
}

/**
 * Choose the CPU temperature from a set of parsed hwmon sensors.
 *
 * PURE and exported for tests. The allowlist is the point: /sys/class/hwmon
 * holds every sensor the kernel knows — NVMe drives, the wifi radio, the GPU,
 * ACPI zones of unknowable position — and picking "the hottest thing" or "the
 * first thing" would report a warm SSD as the CPU. Only drivers that are BY
 * NAME the CPU's own are eligible; everything else, acpitz included, is
 * rejected because a motherboard zone is not a CPU reading, however close it
 * usually sits.
 *
 * Channel preference, in order and for cause:
 *   Tdie          k10temp's real die temperature, where the driver offers it
 *   Package id 0  coretemp's whole-package sensor, over per-core channels
 *   Tctl          k10temp's control input — a target for the fan curve that
 *                 reads HIGH by design (a fixed offset on some parts), so it
 *                 ranks below the two honest ones and its name rides the
 *                 reading as provenance
 *   first channel whatever an unlabelled driver (cpu_thermal on SBCs) offers
 */
export function pickCpuTempSensor(hwmons) {
  const CPU_DRIVERS = new Set(["coretemp", "k10temp", "zenpower", "cpu_thermal", "cpu-thermal"]);
  const candidates = (hwmons ?? []).filter((h) => CPU_DRIVERS.has(String(h?.name ?? "").trim()));

  const byLabel = (label) => {
    for (const sensor of candidates) {
      for (const ch of sensor.channels ?? []) {
        if (ch?.label === label && Number.isFinite(ch.milliC)) {
          return { tempC: Math.round(ch.milliC / 1000), source: `${sensor.name} ${label}` };
        }
      }
    }
    return null;
  };

  const preferred = byLabel("Tdie") ?? byLabel("Package id 0") ?? byLabel("Tctl");
  if (preferred) return preferred;

  for (const sensor of candidates) {
    for (const ch of sensor.channels ?? []) {
      if (Number.isFinite(ch?.milliC)) {
        return { tempC: Math.round(ch.milliC / 1000), source: sensor.name };
      }
    }
  }
  return null;
}

/**
 * Read the CPU temperature from Linux hwmon. Null everywhere it cannot be
 * read honestly: Windows exposes no per-CPU sensor without a kernel driver
 * (the WMI thermal zone is absent or motherboard-grade on most desktops, and
 * reaching it would need PowerShell — banned from this collector by the cost
 * rule at the top of the file); macOS keeps the SMC behind entitlements and
 * powermetrics behind sudo. sysfs, by contrast, is plain files: the whole
 * scan is a handful of reads costing microseconds against the poll's ~50ms
 * nvidia-smi.
 */
async function linuxCpuTemp() {
  if (process.platform !== "linux") return null;
  try {
    const base = "/sys/class/hwmon";
    const entries = await fsp.readdir(base);
    const hwmons = [];
    for (const entry of entries.slice(0, 24)) {
      const dir = `${base}/${entry}`;
      let name;
      try {
        name = (await fsp.readFile(`${dir}/name`, "utf8")).trim();
      } catch {
        continue;
      }
      const files = await fsp.readdir(dir).catch(() => []);
      const channels = [];
      for (const file of files) {
        const m = /^temp(\d+)_input$/.exec(file);
        if (!m || channels.length >= 32) continue;
        const milliC = Number((await fsp.readFile(`${dir}/${file}`, "utf8").catch(() => "")).trim());
        const label = (await fsp.readFile(`${dir}/temp${m[1]}_label`, "utf8").catch(() => "")).trim() || null;
        channels.push({ label, milliC: Number.isFinite(milliC) ? milliC : null });
      }
      hwmons.push({ name, channels });
    }
    return pickCpuTempSensor(hwmons);
  } catch {
    return null;
  }
}

/**
 * Parse one CSV line of clocks_throttle_reasons fields.
 *
 * PURE and exported for tests. nvidia-smi reports these as the strings
 * "Active" / "Not Active", with "[N/A]" where a board does not expose one.
 * Anything unrecognised parses as null — UNKNOWN IS NOT "NOT THROTTLING", and
 * collapsing the two would let a failed probe masquerade as a healthy card.
 *
 * These are the VENDOR'S OWN throttle verdicts, which is the whole reason this
 * probe exists. The tempting alternative — inferring throttle from "clocks
 * below max while hot" — misfires on every idle card: verified on this
 * project's own RTX 4070 Ti sitting at 345/3135 MHz with the active-reasons
 * bitmask reading 0x1 (GPU_IDLE). Downclocking at idle is health, not
 * distress, and only the vendor can tell the difference from outside.
 */
export function parseThrottleReasons(line) {
  const flag = (v) => {
    const s = String(v ?? "").trim();
    if (s === "Active") return true;
    if (s === "Not Active") return false;
    return null;
  };
  const f = String(line).split(",").map((s) => s.trim());
  return {
    index: Number.isFinite(Number(f[0])) ? Number(f[0]) : null,
    swPowerCap: flag(f[1]),
    hwThermalSlowdown: flag(f[2]),
    swThermalSlowdown: flag(f[3]),
    hwSlowdown: flag(f[4]),
  };
}

/**
 * Parse one CSV line of pcie.link fields. PURE and exported for tests, like
 * parseThrottleReasons above and for the same reason.
 *
 * All four figures or none: a link reading is a comparison, and "Gen 1 of
 * rated Gen ?" is not one. A board that answers "[N/A]" for any field parses
 * to null and the gauge stays absent — unknown is not "downshifted", and it
 * is not "fine" either.
 */
export function parsePcieLink(line) {
  const f = String(line).split(",").map((s) => s.trim());
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const index = num(f[0]);
  const genCurrent = num(f[1]);
  const widthCurrent = num(f[2]);
  const genMax = num(f[3]);
  const widthMax = num(f[4]);
  const complete =
    genCurrent !== null && widthCurrent !== null && genMax !== null && widthMax !== null;
  return { index, link: complete ? { genCurrent, widthCurrent, genMax, widthMax } : null };
}

/**
 * NVIDIA live counters. `nounits` strips the trailing " %", " MiB", " W" so the
 * fields parse as plain numbers rather than needing per-field suffix handling.
 *
 * THREE QUERIES, DELIBERATELY. The throttle-reason and pcie.link fields ride
 * separate nvidia-smi calls: if a driver generation does not know one field,
 * nvidia-smi fails the WHOLE query — and a missing throttle or link probe must
 * degrade to its own unknown, never take the temperature and VRAM gauges down
 * with it, and never take each other down. The calls run concurrently, so the
 * poll budget pays for the slowest of the three, not the sum.
 */
async function nvidiaTelemetry() {
  const [res, throttleRes, pcieRes] = await Promise.all([
    run(
      "nvidia-smi",
      [
        "--query-gpu=index,name,utilization.gpu,utilization.memory,memory.used,memory.total,temperature.gpu,power.draw,power.limit,clocks.sm,clocks.max.sm,fan.speed",
        "--format=csv,noheader,nounits",
      ],
      { timeout: 4000 },
    ),
    run(
      "nvidia-smi",
      [
        "--query-gpu=index,clocks_throttle_reasons.sw_power_cap,clocks_throttle_reasons.hw_thermal_slowdown,clocks_throttle_reasons.sw_thermal_slowdown,clocks_throttle_reasons.hw_slowdown",
        "--format=csv,noheader,nounits",
      ],
      { timeout: 4000 },
    ),
    run(
      "nvidia-smi",
      [
        "--query-gpu=index,pcie.link.gen.current,pcie.link.width.current,pcie.link.gen.max,pcie.link.width.max",
        "--format=csv,noheader,nounits",
      ],
      { timeout: 4000 },
    ),
  ]);
  if (!res.ok) return { available: false, reason: res.error };

  const throttleByIndex = new Map();
  if (throttleRes.ok) {
    for (const line of throttleRes.stdout.split("\n").filter(Boolean)) {
      const parsed = parseThrottleReasons(line);
      if (parsed.index !== null) throttleByIndex.set(parsed.index, parsed);
    }
  }

  const pcieByIndex = new Map();
  if (pcieRes.ok) {
    for (const line of pcieRes.stdout.split("\n").filter(Boolean)) {
      const parsed = parsePcieLink(line);
      if (parsed.index !== null && parsed.link) pcieByIndex.set(parsed.index, parsed.link);
    }
  }

  const num = (v) => {
    const n = Number(String(v).trim());
    // nvidia-smi prints "[N/A]" for counters a given board does not expose —
    // a laptop GPU with no fan, for instance. Null, never 0.
    return Number.isFinite(n) ? n : null;
  };

  const gpus = res.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const f = line.split(",").map((s) => s.trim());
      const index = num(f[0]);
      const throttleRow = index === null ? undefined : throttleByIndex.get(index);
      return {
        index,
        name: f[1],
        utilizationPercent: num(f[2]),
        memoryUtilizationPercent: num(f[3]),
        memoryUsedMib: num(f[4]),
        memoryTotalMib: num(f[5]),
        temperatureC: num(f[6]),
        powerDrawW: num(f[7]),
        powerLimitW: num(f[8]),
        clockMhz: num(f[9]),
        clockMaxMhz: num(f[10]),
        fanPercent: num(f[11]),
        // Null when the throttle probe did not answer — unknown, not "fine".
        throttle: throttleRow
          ? {
              swPowerCap: throttleRow.swPowerCap,
              hwThermalSlowdown: throttleRow.hwThermalSlowdown,
              swThermalSlowdown: throttleRow.swThermalSlowdown,
              hwSlowdown: throttleRow.hwSlowdown,
            }
          : null,
        // Null when the link probe did not answer, or answered incompletely —
        // a link reading is a comparison, and half of one is not a reading.
        pcie: (index !== null && pcieByIndex.get(index)) || null,
      };
    });
  return { available: true, gpus };
}

/**
 * macOS memory, taken from the kernel rather than inferred from os.freemem().
 *
 * WHY THIS EXISTS. On macOS `os.freemem()` counts only genuinely free pages —
 * free plus speculative. macOS deliberately fills the rest of RAM with
 * reclaimable file cache, so `total - free` counts that cache as used and
 * reports ~93% on a completely healthy machine. Measured on an idle M1: 7.95 GB
 * of 8.59 GB "used", while the kernel simultaneously reported NORMAL memory
 * pressure and Activity Monitor showed 5.54 GB. That is a false alarm on every
 * Mac, not a Mac that is short of memory.
 *
 * Two things are captured, both raw and unreconciled:
 *   - vm_stat's page counters, so available memory can be computed honestly.
 *   - kern.memorystatus_vm_pressure_level — the kernel's OWN verdict, and
 *     exactly what Activity Monitor's green/yellow/red graph renders.
 *
 * Both are cheap enough for the poll budget (single-digit milliseconds each,
 * against the ~50ms nvidia-smi already in this sample).
 */
async function darwinMemory() {
  if (process.platform !== "darwin") return null;

  const [vmStat, pressure] = await Promise.all([
    run("vm_stat", [], { timeout: 3000 }),
    run("sysctl", ["-n", "kern.memorystatus_vm_pressure_level"], { timeout: 3000 }),
  ]);
  if (!vmStat.ok) return { available: false, reason: vmStat.error };

  // Header line: "Mach Virtual Memory Statistics: (page size of 16384 bytes)".
  // Page size is read rather than assumed — it is 16 KiB on Apple Silicon and
  // 4 KiB on Intel Macs, and hardcoding either silently scales every figure.
  const pageSizeMatch = /page size of (\d+) bytes/.exec(vmStat.stdout);
  const pages = (label) => {
    const match = new RegExp(`^Pages ${label}:\\s+(\\d+)`, "m").exec(vmStat.stdout);
    return match ? Number(match[1]) : null;
  };

  const level = pressure.ok ? Number(pressure.stdout.trim()) : NaN;

  return {
    available: true,
    pageSizeBytes: pageSizeMatch ? Number(pageSizeMatch[1]) : null,
    free: pages("free"),
    speculative: pages("speculative"),
    inactive: pages("inactive"),
    purgeable: pages("purgeable"),
    wiredDown: pages("wired down"),
    // 1 = normal, 2 = warn, 4 = critical. Null when sysctl did not answer, so
    // the derive layer can tell "healthy" from "not measured".
    pressureLevel: Number.isFinite(level) ? level : null,
  };
}

async function diskFor(storePath) {
  if (!storePath) return null;
  try {
    const stat = await fsp.statfs(storePath);
    return {
      path: storePath,
      freeBytes: stat.bavail * stat.bsize,
      totalBytes: stat.blocks * stat.bsize,
    };
  } catch {
    return null;
  }
}

async function loadedModels(host) {
  try {
    const res = await fetch(`${host}/api/ps`, { signal: AbortSignal.timeout(3000) });
    // The status rides along on refusal. Ollama's local API never demands
    // credentials, so an auth-shaped status here is a specific finding — the
    // configured endpoint is something standing IN FRONT of Ollama — and the
    // derive layer can only name it if the raw number survives collection.
    if (!res.ok) return { reachable: false, httpStatus: res.status };
    const body = await res.json();
    return {
      reachable: true,
      models: (body.models ?? []).map((m) => ({
        name: m.name,
        sizeBytes: m.size,
        sizeVramBytes: m.size_vram ?? 0,
        // The context this model was LOADED with. It is a memory decision, not
        // a detail: the same qwen3:8b Q4_K_M is an 11.0 GB allocation at
        // 36,864 ctx (spilling 2 GB to CPU on a 10 GB card) and a fully
        // resident 6.3 GB at 8,192. Null where an older Ollama omits the
        // field — unknown, never 0.
        contextLength: m.context_length ?? null,
        expiresAt: m.expires_at ?? null,
      })),
    };
  } catch {
    return { reachable: false, httpStatus: null };
  }
}

/**
 * One cheap telemetry sample.
 *
 * @param {object} options
 * @param {string} options.host        Ollama endpoint (already resolved).
 * @param {string} [options.storePath] Model-store path, for disk headroom.
 * @param {string} [options.sampledAt] Caller-supplied ISO timestamp.
 */
export async function collectTelemetry({ host, storePath = null, sampledAt = null } = {}) {
  // Independent, so run concurrently — the whole sample is bounded by the
  // slowest probe (nvidia-smi) rather than their sum.
  const [gpu, disk, ollama, darwin, cpuTemp, diskIo] = await Promise.all([
    nvidiaTelemetry(),
    diskFor(storePath),
    loadedModels(host),
    darwinMemory(),
    linuxCpuTemp(),
    linuxDiskIo(storePath),
  ]);

  return {
    sampledAt,
    cpu: {
      utilizationPercent: cpuUtilisation(),
      logicalCores: os.cpus().length,
      // Load average is meaningless on Windows (always zeros), so it is
      // reported as null there rather than as three convincing-looking zeros.
      loadAverage: process.platform === "win32" ? null : os.loadavg(),
      // Null off Linux and on Linux boxes with no recognised CPU sensor — see
      // linuxCpuTemp() for why the other platforms cannot answer honestly.
      tempC: cpuTemp?.tempC ?? null,
      tempSource: cpuTemp?.source ?? null,
    },
    memory: {
      totalBytes: os.totalmem(),
      // Kept even on macOS, where it is known to understate available memory.
      // The collect layer does not drop a source for disagreeing with another —
      // here the disagreement between this and vm_stat IS the finding.
      freeBytes: os.freemem(),
      // Null on every platform except macOS, where os.freemem() cannot express
      // pressure on its own. See darwinMemory().
      darwin,
    },
    gpu,
    disk,
    // Null where it cannot be measured honestly; { measuring } until the
    // second sample exists — a rate, like CPU utilisation, and honest the
    // same way about its first poll.
    diskIo,
    ollama,
  };
}

/** Test seam: clears the CPU rate baseline so a suite starts deterministic. */
export function resetCpuBaseline() {
  previousCpuSample = null;
}
