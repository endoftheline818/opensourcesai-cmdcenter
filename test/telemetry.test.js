import test from "node:test";
import assert from "node:assert/strict";
import { buildGauges, buildLivePayload, buildLoaded, severityFor } from "../src/derive/telemetry.js";
import { collectTelemetry, resetCpuBaseline } from "../src/collect/telemetry.js";
import { createRoutes, TELEMETRY_MIN_INTERVAL_MS } from "../src/serve/routes.js";

const sample = (overrides = {}) => ({
  sampledAt: "2026-01-01T00:00:00.000Z",
  cpu: { utilizationPercent: 42, logicalCores: 28, loadAverage: null },
  memory: { totalBytes: 34_000_000_000, freeBytes: 17_000_000_000 },
  gpu: {
    available: true,
    gpus: [{
      index: 0, name: "NVIDIA GeForce RTX 4070 Ti",
      utilizationPercent: 36, memoryUtilizationPercent: 3,
      memoryUsedMib: 4220, memoryTotalMib: 12282,
      temperatureC: 31, powerDrawW: 27.75, powerLimitW: 304.95,
      clockMhz: 210, clockMaxMhz: 2790, fanPercent: 55,
    }],
  },
  disk: { path: "/models", freeBytes: 358_000_000_000, totalBytes: 999_000_000_000 },
  ollama: { reachable: true, models: [] },
  ...overrides,
});

// THE RULE THIS SUITE EXISTS TO PROTECT: an unmeasurable gauge must read as
// UNAVAILABLE, never as zero. Rendered as a bar, "0% GPU" and "this platform
// has no GPU counters" look identical — and one of them is a lie.
test("an unmeasurable gauge is unavailable, never zero", () => {
  const gauges = buildGauges(sample({ gpu: { available: false, reason: "nvidia-smi not found" } }));
  const gpu = gauges.find((g) => g.id === "gpu");

  assert.equal(gpu.available, false);
  assert.equal(gpu.percent, null, "an unavailable gauge must not report a number");
  assert.notEqual(gpu.percent, 0, "zero would render as a real, idle-looking reading");
  assert.match(gpu.reason, /nvidia-smi|GPU/);
  assert.equal(gpu.severity, "unknown");
});

// REGRESSION TEST FOR A FALSE ALARM THAT REACHED THE SCREEN.
//
// These are REAL counters captured from an idle M1 MacBook Air, not invented
// numbers. At the moment of capture the machine was healthy: the kernel
// reported pressure level 1 (normal) and Activity Monitor showed 5.54 GB used
// with a green pressure graph. The dashboard showed 93% and "warn".
//
// The cause was that os.freemem() on macOS counts only free + speculative
// pages — 9905 + 9024 here, which is the 0.30 GB it reported — while 2.6 GB of
// inactive and purgeable file cache, which macOS reclaims on demand, was being
// counted as used. Every healthy Mac would have shown a memory warning.
const IDLE_M1 = {
  available: true,
  pageSizeBytes: 16384,
  free: 9905,
  speculative: 9024,
  inactive: 159602,
  purgeable: 8312,
  wiredDown: 81312,
  pressureLevel: 1,
};
const M1_TOTAL_BYTES = 8_589_934_592;

test("macOS counts reclaimable cache as available, not as used", () => {
  const gauges = buildGauges(
    sample({ memory: { totalBytes: M1_TOTAL_BYTES, freeBytes: 310_000_000, darwin: IDLE_M1 } }),
  );
  const ram = gauges.find((g) => g.id === "ram");

  // free + speculative + inactive + purgeable, at 16 KiB per page.
  const available = (9905 + 9024 + 159602 + 8312) * 16384;
  const used = M1_TOTAL_BYTES - available;

  assert.equal(ram.percent, Math.round((used / M1_TOTAL_BYTES) * 100));
  assert.equal(ram.percent, 64, "the honest figure, matching Activity Monitor's 5.54 GB");
  assert.ok(ram.percent < 85, "must sit below the capacity warn threshold on a healthy machine");
});

test("macOS severity comes from the kernel's own pressure verdict", () => {
  const at = (pressureLevel) =>
    buildGauges(
      sample({
        memory: { totalBytes: M1_TOTAL_BYTES, freeBytes: 310_000_000, darwin: { ...IDLE_M1, pressureLevel } },
      }),
    ).find((g) => g.id === "ram").severity;

  assert.equal(at(1), "normal");
  assert.equal(at(2), "warn");
  assert.equal(at(4), "critical");

  // A machine genuinely under pressure must still escalate even though the
  // percentage alone would read as comfortable — which is the whole point of
  // deferring to the kernel rather than to a threshold table.
  assert.equal(at(4), "critical", "kernel pressure outranks a comfortable-looking percentage");
});

test("macOS without usable vm_stat is unavailable, never a false warning", () => {
  const gauges = buildGauges(
    sample({
      memory: { totalBytes: M1_TOTAL_BYTES, freeBytes: 310_000_000, darwin: { available: false, reason: "not-found" } },
    }),
  );
  const ram = gauges.find((g) => g.id === "ram");

  // Falling back to total - freemem() here would report 96% and warn on a
  // healthy machine. Unavailable is the honest answer.
  assert.equal(ram.available, false);
  assert.equal(ram.percent, null);
  assert.equal(ram.severity, "unknown");
  assert.match(ram.reason, /vm_stat/);
});

test("Windows and Linux memory math is untouched by the macOS path", () => {
  // darwin is null off macOS, where os.freemem() already tracks available
  // memory — verified against /proc/meminfo on the Linux rig, where it follows
  // MemAvailable rather than MemFree.
  const gauges = buildGauges(sample({ memory: { totalBytes: 34_000_000_000, freeBytes: 17_000_000_000, darwin: null } }));
  const ram = gauges.find((g) => g.id === "ram");
  assert.equal(ram.percent, 50);
  assert.equal(ram.severity, "normal");
  assert.equal(ram.available, true);
});

test("the first CPU sample is unknown rather than idle", () => {
  // Utilisation is a rate; the first poll has nothing to diff against.
  const gauges = buildGauges(sample({ cpu: { utilizationPercent: null, logicalCores: 8, loadAverage: null } }));
  const cpu = gauges.find((g) => g.id === "cpu");
  assert.equal(cpu.available, false);
  assert.equal(cpu.percent, null);
  assert.match(cpu.reason, /measuring/);
});

test("gauges derive real percentages from real counters", () => {
  const gauges = buildGauges(sample());
  const byId = Object.fromEntries(gauges.map((g) => [g.id, g]));

  assert.equal(byId.cpu.percent, 42);
  assert.equal(byId.gpu.percent, 36);
  assert.equal(byId.vram.percent, Math.round((4220 / 12282) * 100));
  assert.match(byId.vram.detail, /4\.1 \/ 12\.0 GiB/);
  assert.equal(byId.temp.detail, "31 °C");
  assert.equal(byId.power.percent, Math.round((27.75 / 304.95) * 100));
  assert.match(byId.ram.detail, /GB/);
  assert.match(byId.disk.detail, /free/);
});

test("severity thresholds are generous for load and tighter for capacity", () => {
  // A busy machine is not a broken one — load never escalates on its own.
  assert.equal(severityFor("load", 99), "normal");
  // A full disk or VRAM fails hard rather than getting slow, so it warns earlier.
  assert.equal(severityFor("capacity", 84), "normal");
  assert.equal(severityFor("capacity", 86), "warn");
  assert.equal(severityFor("capacity", 96), "critical");
  assert.equal(severityFor("temperature", 79), "normal");
  assert.equal(severityFor("temperature", 85), "warn");
  assert.equal(severityFor("temperature", 91), "critical");
  assert.equal(severityFor("load", null), "unknown");
});

test("a partially resident model is flagged as spilled", () => {
  const loaded = buildLoaded(sample({
    ollama: {
      reachable: true,
      models: [
        { name: "small:1b", sizeBytes: 1_000_000_000, sizeVramBytes: 1_000_000_000, expiresAt: null },
        { name: "big:31b", sizeBytes: 20_000_000_000, sizeVramBytes: 7_000_000_000, expiresAt: null },
      ],
    },
  }));

  assert.equal(loaded.models[0].vramResidentPercent, 100);
  assert.equal(loaded.models[0].spilled, false);
  assert.equal(loaded.models[1].vramResidentPercent, 35);
  assert.equal(loaded.models[1].spilled, true, "below 100% means it is partly on CPU");
});

test("an unreachable Ollama reports unreachable, not empty", () => {
  // "No models loaded" and "cannot tell" are different claims.
  const loaded = buildLoaded(sample({ ollama: { reachable: false } }));
  assert.equal(loaded.reachable, false);
  assert.deepEqual(loaded.models, []);
});

test("the live payload is deterministic for a given sample", () => {
  const s = sample();
  assert.deepEqual(buildLivePayload(s), buildLivePayload(s));
});

// RATE LIMITING. The resource being protected is the user's CPU: a stuck poll
// loop must not spawn a thousand nvidia-smi processes a second.
test("telemetry sampling is rate limited regardless of client poll rate", async () => {
  let samples = 0;
  let clock = 0;
  const routes = createRoutes({
    collect: async () => ({}),
    catalog: { models: [] },
    now: () => "2026-01-01T00:00:00.000Z",
    monotonic: () => clock,
    telemetry: async ({ sampledAt }) => { samples += 1; return sample({ sampledAt }); },
  });

  const first = JSON.parse((await routes["/api/live"]()).body);
  assert.equal(samples, 1);
  assert.equal(first.cached, false);

  // Hammer it within the window: served from cache, no new process spawned.
  for (let i = 0; i < 50; i += 1) await routes["/api/live"]();
  assert.equal(samples, 1, "50 rapid polls must not re-sample");

  const cached = JSON.parse((await routes["/api/live"]()).body);
  assert.equal(cached.cached, true, "a cached response must say so");

  // Past the window, a fresh sample is taken.
  clock += TELEMETRY_MIN_INTERVAL_MS + 1;
  await routes["/api/live"]();
  assert.equal(samples, 2);
});

test("the live route degrades cleanly when no collector is configured", async () => {
  const routes = createRoutes({ collect: async () => ({}), catalog: { models: [] }, now: () => "x" });
  const body = JSON.parse((await routes["/api/live"]()).body);
  assert.equal(body.available, false);
  assert.match(body.reason, /not configured/);
});

// The collector is the I/O half and is exercised against the real machine —
// it must never throw, whatever this runner happens to have installed.
test("collectTelemetry survives a machine with nothing installed", async () => {
  resetCpuBaseline();
  const result = await collectTelemetry({ host: "http://127.0.0.1:1", storePath: null });

  assert.equal(result.cpu.utilizationPercent, null, "first sample has no baseline");
  assert.ok(result.memory.totalBytes > 0);
  assert.equal(result.ollama.reachable, false, "a dead endpoint is reported, not thrown");
  assert.equal(result.disk, null);
  assert.ok("available" in result.gpu);

  // Second call now has a baseline to diff against.
  const second = await collectTelemetry({ host: "http://127.0.0.1:1", storePath: null });
  assert.ok(second.cpu.utilizationPercent === null || typeof second.cpu.utilizationPercent === "number");
  if (typeof second.cpu.utilizationPercent === "number") {
    assert.ok(second.cpu.utilizationPercent >= 0 && second.cpu.utilizationPercent <= 100);
  }
});

test("load average is null on Windows rather than three convincing zeros", async () => {
  resetCpuBaseline();
  const result = await collectTelemetry({ host: "http://127.0.0.1:1" });
  if (process.platform === "win32") {
    assert.equal(result.cpu.loadAverage, null);
  } else {
    assert.ok(Array.isArray(result.cpu.loadAverage));
  }
});
