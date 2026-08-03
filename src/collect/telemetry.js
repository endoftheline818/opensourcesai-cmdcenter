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
 * NVIDIA live counters. `nounits` strips the trailing " %", " MiB", " W" so the
 * fields parse as plain numbers rather than needing per-field suffix handling.
 */
async function nvidiaTelemetry() {
  const res = await run(
    "nvidia-smi",
    [
      "--query-gpu=index,name,utilization.gpu,utilization.memory,memory.used,memory.total,temperature.gpu,power.draw,power.limit,clocks.sm,clocks.max.sm,fan.speed",
      "--format=csv,noheader,nounits",
    ],
    { timeout: 4000 },
  );
  if (!res.ok) return { available: false, reason: res.error };

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
      return {
        index: num(f[0]),
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
      };
    });
  return { available: true, gpus };
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
    if (!res.ok) return { reachable: false };
    const body = await res.json();
    return {
      reachable: true,
      models: (body.models ?? []).map((m) => ({
        name: m.name,
        sizeBytes: m.size,
        sizeVramBytes: m.size_vram ?? 0,
        expiresAt: m.expires_at ?? null,
      })),
    };
  } catch {
    return { reachable: false };
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
  const [gpu, disk, ollama] = await Promise.all([
    nvidiaTelemetry(),
    diskFor(storePath),
    loadedModels(host),
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
      freeBytes: os.freemem(),
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
