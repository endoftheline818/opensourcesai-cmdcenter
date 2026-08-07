// Derivation over stored measurement records. Pure: no I/O, no clock, no
// randomness — the same discipline as the rest of derive/, over the record
// shape src/storage/measurements.js validates.
//
// THE RULE THAT SHAPES EVERY FUNCTION HERE: a figure that cannot be computed
// returns null WITH A REASON, never zero and never a guess. A record whose
// runtime reported no eval counters is not a slow generation — it is an
// unmeasured one, and the gauges' unavailable-is-not-zero rule applies to
// history exactly as it applies to live readings. Reasons come from a closed
// set of short strings so the UI can render them without interpreting prose.
//
// WHAT IS DELIBERATELY ABSENT
// - Cross-record aggregation ("this machine's best for a model") — that is a
//   later phase's work, gated on records having accumulated, and it carries
//   its own comparability rules (records whose environmentHash differs are
//   not one series; see derive/environment.js).
// - Detection of Ollama's KV prefix reuse across successive requests. A cache
//   hit makes promptEvalCount cover only the un-cached suffix, which turns a
//   "prefill rate" into a cache benchmark — but detecting it requires knowing
//   the full submitted prompt size, which a record deliberately does not carry.
//   Until the record schema carries a safe form of that fact, prefill figures
//   are labelled by the caller as covering PROCESSED tokens only, and nothing
//   here pretends to know more.

const NANOSECONDS_PER_SECOND = 1e9;

/**
 * The floor above which a reported load_duration is annotated as a real load.
 *
 * Ollama reports load_duration on every response: a warm, already-resident
 * model reports milliseconds of bookkeeping; an actual load from disk reports
 * seconds. The two regimes are orders of magnitude apart, and this constant
 * only has to sit between them — it is an ANNOTATION floor ("this response
 * included loading the model"), not a performance judgment, and nothing
 * downstream may treat it as one.
 */
export const COLD_LOAD_ANNOTATION_FLOOR_MS = 1000;

/** Closed vocabulary for why a figure is unavailable. The UI renders these verbatim. */
export const UNAVAILABLE = Object.freeze({
  notReported: "not reported by the runtime",
  zeroDuration: "reported duration was zero",
  noTokens: "no tokens were generated",
  notMeasured: "not measured",
  missingInput: "required input unavailable",
});

const usable = (v) => typeof v === "number" && Number.isFinite(v);

/** value-or-reason pair — the shape every figure below comes in. */
const figure = (value, reason = null) =>
  value === null ? { value: null, available: false, reason } : { value, available: true, reason: null };

function rate(count, durationNs) {
  if (!usable(count) || !usable(durationNs)) return figure(null, UNAVAILABLE.notReported);
  if (durationNs === 0) return figure(null, UNAVAILABLE.zeroDuration);
  if (count === 0) return figure(null, UNAVAILABLE.noTokens);
  return figure(count / (durationNs / NANOSECONDS_PER_SECOND));
}

/** Decode rate for one record — tokens the runtime generated, per second. */
export function generationTokensPerSecond(record) {
  return rate(record?.reported?.evalCount ?? null, record?.reported?.evalDurationNs ?? null);
}

/**
 * Prefill rate for one record — PROCESSED prompt tokens per second. See the
 * module header: on a KV prefix-cache hit this covers only the un-cached
 * suffix, and the caller must label it as a processing rate, not a capability.
 */
export function prefillTokensPerSecond(record) {
  return rate(record?.reported?.promptEvalCount ?? null, record?.reported?.promptEvalDurationNs ?? null);
}

/**
 * Load time for one record, with the annotation the strip renders: seconds
 * when reported, plus whether this response included a real load — so a 14 s
 * first token reads as "included cold load (12.4 s)" instead of as a broken
 * configuration.
 */
export function coldLoad(record) {
  const ns = record?.reported?.loadDurationNs ?? null;
  if (!usable(ns)) return { ...figure(null, UNAVAILABLE.notReported), includedColdLoad: null };
  const seconds = ns / NANOSECONDS_PER_SECOND;
  return { ...figure(seconds), includedColdLoad: seconds * 1000 >= COLD_LOAD_ANNOTATION_FLOOR_MS };
}

/**
 * The bandwidth roofline, inherited from the bench protocol: the theoretical
 * decode ceiling is memory bandwidth divided by weight bytes, because decoding
 * one token reads every weight once. Its caveats travel with it and are not
 * optional — generation only, degrades with context length, 100% unreachable,
 * meaningful solely against this machine's own ceiling.
 *
 * Both inputs are frequently and legitimately absent (no sourced bandwidth
 * figure for this GPU; no weight size for this model), and absence flows
 * through as unavailable — a ceiling is exactly the kind of number that must
 * never be guessed, because everything shown against it inherits the guess.
 */
export function theoreticalMaxTokensPerSecond({ memoryBandwidthGBps = null, weightsBytes = null } = {}) {
  if (!usable(memoryBandwidthGBps) || memoryBandwidthGBps <= 0) return figure(null, UNAVAILABLE.missingInput);
  if (!usable(weightsBytes) || weightsBytes <= 0) return figure(null, UNAVAILABLE.missingInput);
  return figure(memoryBandwidthGBps / (weightsBytes / 1e9));
}

/** Observed generation rate against the ceiling, as a fraction of 1. */
export function rooflineUtilization(record, { memoryBandwidthGBps = null, weightsBytes = null } = {}) {
  const ceiling = theoreticalMaxTokensPerSecond({ memoryBandwidthGBps, weightsBytes });
  if (!ceiling.available) return figure(null, ceiling.reason);
  const generation = generationTokensPerSecond(record);
  if (!generation.available) return figure(null, generation.reason);
  return figure(generation.value / ceiling.value);
}

/**
 * One record, display-ready: every figure with its availability and reason,
 * nothing invented. The measurement strip renders this shape directly; the
 * roofline inputs arrive from the caller because bandwidth provenance is the
 * caller's problem (a sourced table entry or an explicit manual figure —
 * never a guess made here).
 */
export function describeMeasurement(record, { memoryBandwidthGBps = null, weightsBytes = null } = {}) {
  const observed = record?.observed ?? {};
  return {
    source: record?.source ?? null,
    recordedAt: record?.recordedAt ?? null,
    model: record?.model?.name ?? null,
    generation: generationTokensPerSecond(record),
    prefill: prefillTokensPerSecond(record),
    coldLoad: coldLoad(record),
    timeToFirstTokenMs: usable(observed.timeToFirstTokenMs)
      ? figure(observed.timeToFirstTokenMs)
      : figure(null, UNAVAILABLE.notMeasured),
    timeToFirstVisibleTokenMs: usable(observed.timeToFirstVisibleTokenMs)
      ? figure(observed.timeToFirstVisibleTokenMs)
      : figure(null, UNAVAILABLE.notMeasured),
    elapsedMs: usable(observed.elapsedMs) ? figure(observed.elapsedMs) : figure(null, UNAVAILABLE.notMeasured),
    utilization: rooflineUtilization(record, { memoryBandwidthGBps, weightsBytes }),
    environmentHash: record?.environmentHash ?? null,
  };
}
