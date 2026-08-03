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

const gauge = ({ id, label, percent, detail, kind = "load", available = true, reason = null }) => ({
  id,
  label,
  percent: available ? pct(percent) : null,
  detail: available ? detail : null,
  severity: available ? severityFor(kind, pct(percent)) : "unknown",
  available,
  reason,
});

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
    const used = mem.totalBytes - mem.freeBytes;
    gauges.push(
      gauge({
        id: "ram",
        label: "System memory",
        kind: "capacity",
        percent: (used / mem.totalBytes) * 100,
        detail: `${toGb(used)} / ${toGb(mem.totalBytes)} GB`,
      }),
    );
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
 * Loaded models, with the one runtime fact that matters most: whether the model
 * actually fits. Below 100% residency it is running partly on CPU, typically at
 * a small fraction of the speed.
 */
export function buildLoaded(telemetry) {
  const ollama = telemetry.ollama;
  if (!ollama?.reachable) return { reachable: false, models: [] };

  return {
    reachable: true,
    models: (ollama.models ?? []).map((m) => {
      const residency = m.sizeBytes ? Math.round((m.sizeVramBytes / m.sizeBytes) * 100) : null;
      return {
        name: m.name,
        sizeGb: toGb(m.sizeBytes),
        sizeVramGb: toGb(m.sizeVramBytes),
        vramResidentPercent: residency,
        spilled: residency !== null && residency < 100,
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
