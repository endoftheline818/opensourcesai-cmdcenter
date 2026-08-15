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
 * NVIDIA live counters. `nounits` strips the trailing " %", " MiB", " W" so the
 * fields parse as plain numbers rather than needing per-field suffix handling.
 *
 * TWO QUERIES, DELIBERATELY. The throttle-reason fields ride a separate
 * nvidia-smi call: if a driver generation does not know one of them, nvidia-smi
 * fails the WHOLE query — and a missing throttle probe must degrade to
 * "throttle state unknown", never take the temperature and VRAM gauges down
 * with it. The calls run concurrently, so the poll budget pays for the slower
 * of the two, not the sum.
 */
async function nvidiaTelemetry() {
  const [res, throttleRes] = await Promise.all([
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
  ]);
  if (!res.ok) return { available: false, reason: res.error };

  const throttleByIndex = new Map();
  if (throttleRes.ok) {
    for (const line of throttleRes.stdout.split("\n").filter(Boolean)) {
      const parsed = parseThrottleReasons(line);
      if (parsed.index !== null) throttleByIndex.set(parsed.index, parsed);
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
  const [gpu, disk, ollama, darwin] = await Promise.all([
    nvidiaTelemetry(),
    diskFor(storePath),
    loadedModels(host),
    darwinMemory(),
  ]);

  return {
    sampledAt,
    cpu: {
      utilizationPercent: cpuUtilisation(),
      logicalCores: os.cpus().length,
      // Load average is meaningless on Windows (always zeros), so it is
      // reported as null there rather than as three convincing-looking zeros.
      loadAverage: process.platform === "win32" ? null : os.loadavg(),
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
    ollama,
  };
}

/** Test seam: clears the CPU rate baseline so a suite starts deterministic. */
export function resetCpuBaseline() {
  previousCpuSample = null;
}
