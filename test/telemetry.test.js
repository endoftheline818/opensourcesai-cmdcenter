import test from "node:test";
import assert from "node:assert/strict";
import { buildGauges, buildLivePayload, buildLoaded, severityFor } from "../src/derive/telemetry.js";
import { collectTelemetry, parseThrottleReasons, resetCpuBaseline } from "../src/collect/telemetry.js";
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

// THE CLOCKS GAUGE AND THE VENDOR'S THROTTLE VERDICTS.
//
// The trap this design avoids, pinned with real numbers: the 4070 Ti idles at
// 345/3135 MHz — 11% of max clock — while the vendor's active-reasons bitmask
// reads GPU_IDLE. Any "clocks low while warm" heuristic flags that healthy
// card as throttling. So severity comes only from nvidia-smi's own
// clocks_throttle_reasons fields, and the gauge itself never escalates.

const throttled = (throttle) =>
  sample({
    gpu: {
      available: true,
      gpus: [{
        index: 0, name: "NVIDIA GeForce RTX 4070 Ti",
        utilizationPercent: 99, memoryUtilizationPercent: 80,
        memoryUsedMib: 11000, memoryTotalMib: 12282,
        temperatureC: 86, powerDrawW: 280, powerLimitW: 304.95,
        clockMhz: 1650, clockMaxMhz: 3135, fanPercent: 90,
        throttle,
      }],
    },
  });

test("an idle card's low clocks read as normal, never as throttling", () => {
  // The exact idle readings captured from this rig, throttle probe answering
  // "nothing active" (the GPU_IDLE bit is not one of the slowdown reasons).
  const gauges = buildGauges(sample({
    gpu: {
      available: true,
      gpus: [{
        index: 0, name: "NVIDIA GeForce RTX 4070 Ti",
        utilizationPercent: 24, memoryUtilizationPercent: 3,
        memoryUsedMib: 4220, memoryTotalMib: 12282,
        temperatureC: 32, powerDrawW: 27.75, powerLimitW: 304.95,
        clockMhz: 345, clockMaxMhz: 3135, fanPercent: 0,
        throttle: { swPowerCap: false, hwThermalSlowdown: false, swThermalSlowdown: false, hwSlowdown: false },
      }],
    },
  }));
  const clocks = gauges.find((g) => g.id === "clocks");
  assert.equal(clocks.percent, 11);
  assert.equal(clocks.severity, "normal", "idle downclocking is health, not distress");
  assert.equal(clocks.detail, "345 / 3135 MHz");
});

test("vendor-reported thermal slowdown escalates the clock gauge", () => {
  const sw = buildGauges(throttled({ swPowerCap: false, hwThermalSlowdown: false, swThermalSlowdown: true, hwSlowdown: false }))
    .find((g) => g.id === "clocks");
  assert.equal(sw.severity, "warn");
  assert.match(sw.detail, /thermal slowdown active \(vendor-reported\)/);

  const hw = buildGauges(throttled({ swPowerCap: true, hwThermalSlowdown: true, swThermalSlowdown: true, hwSlowdown: true }))
    .find((g) => g.id === "clocks");
  assert.equal(hw.severity, "critical", "the hardware pulling its own brake is the drastic form");
  assert.match(hw.detail, /hardware thermal slowdown/);
});

test("running at the power limit is named but never escalated", () => {
  // GPU Boost is DESIGNED to sit at the power cap under load. Warning on
  // normal operation trains people to ignore warnings.
  const clocks = buildGauges(throttled({ swPowerCap: true, hwThermalSlowdown: false, swThermalSlowdown: false, hwSlowdown: false }))
    .find((g) => g.id === "clocks");
  assert.equal(clocks.severity, "normal");
  assert.match(clocks.detail, /at power limit/);
});

test("an unanswered throttle probe makes no claim in either direction", () => {
  const clocks = buildGauges(throttled(null)).find((g) => g.id === "clocks");
  assert.equal(clocks.severity, "normal", "the gauge's own numbers never escalate");
  assert.doesNotMatch(clocks.detail, /slowdown|power limit/, "unknown is not 'not throttling' — say nothing");
});

test("missing clock counters mean no clocks gauge, not a zero bar", () => {
  const gauges = buildGauges(sample({
    gpu: {
      available: true,
      gpus: [{
        index: 0, name: "Laptop GPU", utilizationPercent: 10,
        memoryUsedMib: 100, memoryTotalMib: 4096, temperatureC: 40,
        powerDrawW: null, powerLimitW: null, clockMhz: null, clockMaxMhz: null,
        fanPercent: null, throttle: null,
      }],
    },
  }));
  assert.equal(gauges.find((g) => g.id === "clocks"), undefined);
});

test("throttle-reason lines parse Active, Not Active, and unknown honestly", () => {
  const active = parseThrottleReasons("0, Active, Not Active, Active, [N/A]");
  assert.equal(active.index, 0);
  assert.equal(active.swPowerCap, true);
  assert.equal(active.hwThermalSlowdown, false);
  assert.equal(active.swThermalSlowdown, true);
  assert.equal(active.hwSlowdown, null, "[N/A] must parse as unknown, never as false");

  const garbage = parseThrottleReasons("not, a, real, line, at-all");
  assert.equal(garbage.index, null);
  assert.equal(garbage.swPowerCap, null);
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

// REAL CAPTURES, not invented numbers: the same qwen3:8b Q4_K_M loaded twice
// on a 10 GB RTX 3080, differing ONLY in requested context length. At 36,864
// it is an 11.0 GB runtime allocation with 2.05 GB forced off the GPU; at
// 8,192 the identical weights are 6.3 GB and fully resident. Context is a
// memory decision, and these two rows are the controlled experiment that
// proves it — which is why the loaded payload must carry contextLength and
// the spill quantity, not just a boolean.
test("context length and quantified spill ride the loaded payload", () => {
  const loaded = buildLoaded(sample({
    ollama: {
      reachable: true,
      models: [
        { name: "qwen3:8b", sizeBytes: 10_999_792_925, sizeVramBytes: 8_949_166_243, contextLength: 36_864, expiresAt: null },
        { name: "qwen3:8b", sizeBytes: 6_295_440_588, sizeVramBytes: 6_295_440_588, contextLength: 8_192, expiresAt: null },
      ],
    },
  }));

  const [large, small] = loaded.models;
  assert.equal(large.contextLength, 36_864);
  assert.equal(large.spilled, true);
  assert.equal(large.spilledGb, 2.05, "the spill is quantified, not just flagged");
  assert.equal(large.vramResidentPercent, 81);

  assert.equal(small.contextLength, 8_192);
  assert.equal(small.spilled, false);
  assert.equal(small.spilledGb, null, "a fully resident model spills nothing — null, not 0");
  assert.equal(small.vramResidentPercent, 100);
});

test("a missing context length is unknown, never zero", () => {
  // Older Ollama versions omit context_length from /api/ps. "Loaded at 0
  // context" would be a lie; absent must survive as null all the way to the
  // screen, where the UI says nothing rather than something false.
  const loaded = buildLoaded(sample({
    ollama: {
      reachable: true,
      models: [{ name: "old:7b", sizeBytes: 5_000_000_000, sizeVramBytes: 5_000_000_000, expiresAt: null }],
    },
  }));
  assert.equal(loaded.models[0].contextLength, null);
  assert.notEqual(loaded.models[0].contextLength, 0);
});

test("an unreachable Ollama reports unreachable, not empty", () => {
  // "No models loaded" and "cannot tell" are different claims.
  const loaded = buildLoaded(sample({ ollama: { reachable: false } }));
  assert.equal(loaded.reachable, false);
  assert.deepEqual(loaded.models, []);
});

// AUTH-SHAPED REFUSAL IS ITS OWN STATE. Bare Ollama's local API never demands
// credentials, so a 401/403/407 means the configured endpoint is NOT bare
// Ollama — a gateway or reverse proxy in front of it. Gateways hand clients
// configs that set OLLAMA_HOST to the proxy port, so on a machine running one
// this is the LIKELY misconfiguration. Reporting it as "Ollama offline" would
// be a false claim about a running machine; the finding is "wrong endpoint".
test("an auth-demanding endpoint is distinguished from a dead one", () => {
  const auth = buildLoaded(sample({ ollama: { reachable: false, httpStatus: 401 } }));
  assert.equal(auth.reachable, false);
  assert.equal(auth.authRequired, true, "401 must be named, not folded into 'offline'");

  const forbidden = buildLoaded(sample({ ollama: { reachable: false, httpStatus: 403 } }));
  assert.equal(forbidden.authRequired, true);

  const dead = buildLoaded(sample({ ollama: { reachable: false, httpStatus: null } }));
  assert.equal(dead.authRequired, false, "a connection failure carries no status and makes no auth claim");

  const legacy = buildLoaded(sample({ ollama: { reachable: false } }));
  assert.equal(legacy.authRequired, false, "an absent status (older capture shape) is not an auth claim");

  const serverError = buildLoaded(sample({ ollama: { reachable: false, httpStatus: 500 } }));
  assert.equal(serverError.authRequired, false, "a 500 is a broken endpoint, not an authenticating one");
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

// The collector against a live (loopback, in-suite) endpoint: context_length
// must survive collection, and an auth refusal must be captured as the raw
// status rather than flattened into a generic failure — derive can only name
// what collect kept.
test("the collector carries context_length through and keeps an auth refusal's status", async () => {
  const http = await import("node:http");
  const serve = (handler) =>
    new Promise((resolve) => {
      const server = http.createServer(handler);
      server.listen(0, "127.0.0.1", () => resolve(server));
    });

  const ollamaLike = await serve((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    // The real 36k-context capture from a 10 GB RTX 3080, verbatim fields.
    res.end(JSON.stringify({
      models: [{
        name: "qwen3:8b",
        model: "qwen3:8b",
        size: 10_999_792_925,
        size_vram: 8_949_166_243,
        context_length: 36_864,
        expires_at: "2026-08-14T00:05:00Z",
      }],
    }));
  });
  const gatewayLike = await serve((req, res) => {
    // What an authenticating proxy answers when no bearer token is presented.
    res.writeHead(401, { "content-type": "text/plain" });
    res.end("unauthorized");
  });

  try {
    const viaOllama = await collectTelemetry({ host: `http://127.0.0.1:${ollamaLike.address().port}` });
    assert.equal(viaOllama.ollama.reachable, true);
    assert.equal(viaOllama.ollama.models[0].contextLength, 36_864);
    assert.equal(viaOllama.ollama.models[0].sizeBytes, 10_999_792_925);

    const viaGateway = await collectTelemetry({ host: `http://127.0.0.1:${gatewayLike.address().port}` });
    assert.equal(viaGateway.ollama.reachable, false);
    assert.equal(viaGateway.ollama.httpStatus, 401, "the refusal's status must survive collection");
  } finally {
    await new Promise((resolve) => ollamaLike.close(resolve));
    await new Promise((resolve) => gatewayLike.close(resolve));
  }
});
