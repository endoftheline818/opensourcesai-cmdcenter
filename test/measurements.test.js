import test from "node:test";
import assert from "node:assert/strict";
import { emptyMeasurement } from "../src/storage/measurements.js";
import {
  COLD_LOAD_ANNOTATION_FLOOR_MS,
  UNAVAILABLE,
  coldLoad,
  conversationPhysics,
  describeMeasurement,
  expectationVersusObservation,
  generationTokensPerSecond,
  prefillTokensPerSecond,
  residencyPercent,
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

// ---------------------------------------------------------------------------
// Expectation versus observation — the engine's own claims, checked
// ---------------------------------------------------------------------------

const withResidency = (fraction, gen = { evalCount: 512, evalDurationNs: 4_534_000_000 }) =>
  record({
    reported: gen,
    residencyAfter: fraction === null ? null : { sizeBytes: 6_000_000_000, sizeVramBytes: 6_000_000_000 * fraction },
  });

test("a kept promise agrees; a spilled fit disagrees naming both figures", () => {
  const grade = { fit: "comfortable", quant: "q4_k_m", requiredVramGb: 7.1, sparseMoe: false };

  const kept = expectationVersusObservation(grade, withResidency(1));
  assert.equal(kept.verdict, "agrees");

  const spilled = expectationVersusObservation(grade, withResidency(0.62));
  assert.equal(spilled.verdict, "disagrees", "predicted-fit-but-spilled is the founding misconfiguration");
  assert.match(spilled.note, /62% resident/);
  assert.match(spilled.note, /7\.1 GB/);
  assert.equal(spilled.observed.residencyPercent, 62);
});

test("a predicted offload agrees when offloaded, and quotes the engine's own speed claim", () => {
  const dense = { fit: "partial", quant: "q4_k_m", requiredVramGb: 21.5, sparseMoe: false };
  const offloaded = expectationVersusObservation(dense, withResidency(0.4, { evalCount: 24, evalDurationNs: 10_000_000_000 }));
  assert.equal(offloaded.verdict, "agrees");
  assert.match(offloaded.note, /roughly 1–5 tok\/s/, "the speed claim is the engine's, quoted — not a new threshold");
  assert.match(offloaded.note, /observed 2\.4/);

  const surprise = expectationVersusObservation(dense, withResidency(1));
  assert.equal(surprise.verdict, "disagrees");
  assert.match(surprise.note, /more VRAM was free/);
});

test("silence on either side is unknown, never a guess", () => {
  const ungraded = expectationVersusObservation(null, withResidency(1));
  assert.equal(ungraded.available, false);
  assert.match(ungraded.reason, /not in the catalog/);

  const unprobed = expectationVersusObservation(
    { fit: "comfortable", quant: "q4_k_m", requiredVramGb: 7.1 },
    withResidency(null),
  );
  assert.equal(unprobed.verdict, "unknown");
  assert.match(unprobed.note, /residency was not observed/);
});

// ---------------------------------------------------------------------------
// Conversation physics — slowdown explained, spill distinguished
// ---------------------------------------------------------------------------

const turn = (tokPerSec, contextTokens, residencyFraction = 1) =>
  record({
    reported: {
      evalCount: 100,
      evalDurationNs: Math.round((100 / tokPerSec) * 1e9),
      promptEvalCount: contextTokens - 100,
      promptEvalDurationNs: 50_000_000,
    },
    residencyAfter: { sizeBytes: 1_000, sizeVramBytes: Math.round(1_000 * residencyFraction) },
  });

test("a residency-stable slowdown is called physics, with the context growth named", () => {
  const physics = conversationPhysics([turn(110.2, 4_000), turn(90, 4_100), turn(74.3, 4_300)]);
  assert.equal(physics.available, true);
  assert.equal(physics.spillSuspected, false);
  assert.match(physics.note, /slowed 110\.2 → 74\.3 tok\/s/);
  assert.match(physics.note, /physics, not misconfiguration/);
  assert.match(physics.note, /12,400 tokens/, "cumulative context reconstructed from the counters");
});

test("a slowdown with falling residency is called spill, not physics", () => {
  const spill = conversationPhysics([turn(110, 4_000, 1), turn(30, 4_100, 0.62)]);
  assert.equal(spill.spillSuspected, true);
  assert.match(spill.note, /100% → 62%/);
  assert.match(spill.note, /spill, not context physics/);
  assert.doesNotMatch(spill.note, /physics, not misconfiguration/);
});

test("a steady conversation says so, and a short one refuses a trend", () => {
  const steady = conversationPhysics([turn(100, 4_000), turn(100.2, 4_100)]);
  assert.match(steady.note, /held ~100\.0 tok\/s/);

  const short = conversationPhysics([turn(100, 4_000)]);
  assert.equal(short.available, false);
  assert.match(short.reason, /fewer than two/);
});

test("a gap in the counters makes later context figures unknown — it does not heal", () => {
  const gapped = conversationPhysics([
    turn(100, 4_000),
    record({ reported: { evalCount: 100, evalDurationNs: 1_000_000_000 } }), // no prompt count
    turn(80, 4_200),
  ]);
  assert.equal(gapped.points[0].cumulativeContextTokens, 4_000);
  assert.equal(gapped.points[1].cumulativeContextTokens, null);
  assert.equal(gapped.points[2].cumulativeContextTokens, null, "the unknown propagates forward");
  assert.equal(gapped.available, true, "the rate trend still stands on its own");
  assert.doesNotMatch(gapped.note, /tokens/, "no context claim without the counters to back it");
});

test("residencyPercent distinguishes unknown from zero", () => {
  assert.equal(residencyPercent(withResidency(null)), null);
  assert.equal(residencyPercent(withResidency(0)), 0, "0% resident is a real observation, not an absence");
  assert.equal(residencyPercent(withResidency(0.62)), 62);
});
