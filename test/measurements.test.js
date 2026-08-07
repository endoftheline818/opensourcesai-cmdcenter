import test from "node:test";
import assert from "node:assert/strict";
import { emptyMeasurement } from "../src/storage/measurements.js";
import {
  COLD_LOAD_ANNOTATION_FLOOR_MS,
  UNAVAILABLE,
  coldLoad,
  describeMeasurement,
  generationTokensPerSecond,
  prefillTokensPerSecond,
  rooflineUtilization,
  theoreticalMaxTokensPerSecond,
} from "../src/derive/measurements.js";

const AT = "2026-08-07T10:00:00Z";

/** A synthetic record with the given reported/observed figures spliced in. */
function record(overrides = {}) {
  const base = emptyMeasurement({ recordedAt: AT, source: "load-action", modelName: "llama3.1:8b" });
  return {
    ...base,
    ...overrides,
    reported: { ...base.reported, ...(overrides.reported ?? {}) },
    observed: { ...base.observed, ...(overrides.observed ?? {}) },
  };
}

// ---------------------------------------------------------------------------
// Rates — the null-with-reason discipline
// ---------------------------------------------------------------------------

test("a measured generation yields a rate; an unmeasured one yields a reason, never zero", () => {
  // 512 tokens in 4.534s — the shape of a real W4-style pass.
  const measured = generationTokensPerSecond(
    record({ reported: { evalCount: 512, evalDurationNs: 4_534_000_000 } }),
  );
  assert.equal(measured.available, true);
  assert.ok(Math.abs(measured.value - 112.925) < 0.01, `expected ~112.93 tok/s, got ${measured.value}`);

  const unmeasured = generationTokensPerSecond(record());
  assert.equal(unmeasured.available, false);
  assert.equal(unmeasured.value, null, "unavailable is null, never 0");
  assert.equal(unmeasured.reason, UNAVAILABLE.notReported);
});

test("degenerate counters yield reasons, not Infinity and not NaN", () => {
  const zeroDuration = generationTokensPerSecond(
    record({ reported: { evalCount: 10, evalDurationNs: 0 } }),
  );
  assert.equal(zeroDuration.available, false);
  assert.equal(zeroDuration.reason, UNAVAILABLE.zeroDuration);

  const zeroTokens = generationTokensPerSecond(
    record({ reported: { evalCount: 0, evalDurationNs: 1_000_000_000 } }),
  );
  assert.equal(zeroTokens.available, false);
  assert.equal(zeroTokens.reason, UNAVAILABLE.noTokens, "0 tokens is not a 0 tok/s measurement");

  const prefill = prefillTokensPerSecond(
    record({ reported: { promptEvalCount: 2659, promptEvalDurationNs: 1_000_000_000 } }),
  );
  assert.equal(prefill.available, true);
  assert.equal(prefill.value, 2659);
});

// ---------------------------------------------------------------------------
// Cold-load annotation
// ---------------------------------------------------------------------------

test("a real load is annotated; warm bookkeeping is not; unreported stays unknown", () => {
  const cold = coldLoad(record({ reported: { loadDurationNs: 12_400_000_000 } }));
  assert.equal(cold.available, true);
  assert.equal(cold.includedColdLoad, true, "12.4s is a load from disk");

  const warm = coldLoad(record({ reported: { loadDurationNs: 8_000_000 } }));
  assert.equal(warm.available, true);
  assert.equal(warm.includedColdLoad, false, "8ms is warm bookkeeping, not a load");

  const unknown = coldLoad(record());
  assert.equal(unknown.available, false);
  assert.equal(unknown.includedColdLoad, null, "an unreported load is unknown, not false");

  // The floor separates the two regimes Ollama reports; it must sit strictly
  // between them or the annotation misfires in one direction.
  assert.ok(COLD_LOAD_ANNOTATION_FLOOR_MS > 100 && COLD_LOAD_ANNOTATION_FLOOR_MS <= 2000);
});

// ---------------------------------------------------------------------------
// The roofline — a ceiling is never guessed
// ---------------------------------------------------------------------------

test("the roofline reproduces the founding example, and refuses without its inputs", () => {
  // RTX 3080: 760 GB/s over 4.9 GB of Q4_K_M weights → ~155 tok/s ceiling;
  // 112.93 observed → ~73%. The numbers the whole product story rests on.
  const inputs = { memoryBandwidthGBps: 760, weightsBytes: 4.9e9 };
  const ceiling = theoreticalMaxTokensPerSecond(inputs);
  assert.equal(ceiling.available, true);
  assert.ok(Math.abs(ceiling.value - 155.1) < 0.1);

  const healthy = rooflineUtilization(
    record({ reported: { evalCount: 512, evalDurationNs: 4_534_000_000 } }),
    inputs,
  );
  assert.equal(healthy.available, true);
  assert.ok(Math.abs(healthy.value - 0.728) < 0.005, `expected ~73%, got ${healthy.value}`);

  const broken = rooflineUtilization(
    record({ reported: { evalCount: 512, evalDurationNs: 58_447_000_000 } }),
    inputs,
  );
  assert.ok(Math.abs(broken.value - 0.0565) < 0.001, "the 8.76 tok/s case reads ~5.7%");

  // No bandwidth, no ceiling — and everything downstream inherits the refusal.
  const noBandwidth = theoreticalMaxTokensPerSecond({ weightsBytes: 4.9e9 });
  assert.equal(noBandwidth.available, false);
  assert.equal(noBandwidth.reason, UNAVAILABLE.missingInput);
  const noUtilization = rooflineUtilization(
    record({ reported: { evalCount: 512, evalDurationNs: 4_534_000_000 } }),
    { weightsBytes: 4.9e9 },
  );
  assert.equal(noUtilization.available, false, "a guessed ceiling would poison every figure shown against it");
});

// ---------------------------------------------------------------------------
// The display shape
// ---------------------------------------------------------------------------

test("describeMeasurement carries every figure with availability, inventing nothing", () => {
  const described = describeMeasurement(
    record({
      reported: { evalCount: 512, evalDurationNs: 4_534_000_000, loadDurationNs: 12_400_000_000 },
      observed: { elapsedMs: 17_000, timeToFirstTokenMs: 240.5, timeToFirstVisibleTokenMs: null },
    }),
    { memoryBandwidthGBps: 760, weightsBytes: 4.9e9 },
  );

  assert.equal(described.model, "llama3.1:8b");
  assert.equal(described.generation.available, true);
  assert.equal(described.prefill.available, false, "prefill was not reported and must say so");
  assert.equal(described.coldLoad.includedColdLoad, true);
  assert.equal(described.timeToFirstTokenMs.value, 240.5);
  assert.equal(described.timeToFirstVisibleTokenMs.available, false);
  assert.equal(described.timeToFirstVisibleTokenMs.reason, UNAVAILABLE.notMeasured);
  assert.equal(described.utilization.available, true);

  // Every figure is a value-or-reason pair; no field may be a bare number the
  // UI would have to guess the provenance of.
  for (const key of ["generation", "prefill", "coldLoad", "timeToFirstTokenMs", "utilization", "elapsedMs"]) {
    assert.ok("available" in described[key], `${key} must carry availability`);
    assert.ok("value" in described[key], `${key} must carry a value slot`);
  }
});

test("describeMeasurement on an empty record is all reasons and no numbers", () => {
  const described = describeMeasurement(record());
  for (const key of ["generation", "prefill", "coldLoad", "timeToFirstTokenMs", "utilization"]) {
    assert.equal(described[key].available, false, `${key} must be unavailable on an empty record`);
    assert.equal(described[key].value, null);
    assert.equal(typeof described[key].reason, "string", `${key} must say why`);
  }
});
