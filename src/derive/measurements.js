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
 * The residency a record observed, as a percentage — null when the post-stream
 * probe did not answer, which is a different claim from "0% resident".
 */
export function residencyPercent(record) {
  const r = record?.residencyAfter;
  if (!r || !usable(r.sizeBytes) || r.sizeBytes <= 0 || !usable(r.sizeVramBytes)) return null;
  return Math.round((r.sizeVramBytes / r.sizeBytes) * 100);
}

/**
 * The fit engine's prediction beside what the machine actually did — the
 * comparison this product exists for, and the one neither side could make
 * alone. PURE: a grade (from the same engine as the website's checker) and a
 * stored record in, a verdict out.
 *
 * THE RULES ARE THE ENGINE'S OWN CLAIMS, NOT NEW OPINIONS. A comfortable or
 * tight grade claims the model fits in VRAM; a partial grade claims CPU
 * offload, and for a dense model the engine publishes "roughly 1–5 tokens per
 * second" as the cost. This function only checks whether the machine kept
 * those exact promises — it invents no thresholds of its own, and where
 * either side is silent (no catalog grade, no residency probe) it says
 * "unknown" rather than guessing.
 *
 * The verdicts:
 *   agrees     — the machine did what the engine predicted.
 *   disagrees  — it did not, in either direction. Predicted-fit-but-spilled is
 *                the misconfiguration this product was founded on; predicted-
 *                offload-but-resident means more VRAM was free than assumed.
 *   unknown    — one side did not speak.
 */
export function expectationVersusObservation(grade, record) {
  if (!grade || !grade.fit) {
    return {
      available: false,
      reason: "this model is not in the catalog, so nothing was predicted",
      verdict: "unknown",
    };
  }
  const resident = residencyPercent(record);
  const generation = generationTokensPerSecond(record);
  const observed = {
    residencyPercent: resident,
    tokensPerSecond: generation.available ? generation.value : null,
  };
  const quantLabel = grade.quant ? ` in ${String(grade.quant).toUpperCase()}` : "";
  const predicted = {
    fit: grade.fit,
    quant: grade.quant ?? null,
    requiredVramGb: grade.requiredVramGb ?? null,
    summary:
      grade.fit === "partial"
        ? (grade.sparseMoe
            ? "CPU RAM offload at usable speed (sparse mixture-of-experts)"
            : "CPU RAM offload — the engine's published expectation for a dense offloaded model is roughly 1–5 tokens per second")
        : grade.fit === "too_large"
          ? "does not fit this machine at all"
          : `fits in VRAM${quantLabel}, fully resident`,
  };

  if (resident === null) {
    return {
      available: true,
      verdict: "unknown",
      predicted,
      observed,
      note: "residency was not observed after this reply, so the prediction cannot be checked",
    };
  }

  if (grade.fit === "comfortable" || grade.fit === "tight") {
    if (resident >= 100) {
      return { available: true, verdict: "agrees", predicted, observed, note: "fully resident, as predicted" };
    }
    return {
      available: true,
      verdict: "disagrees",
      predicted,
      observed,
      note:
        `predicted to fit fully in VRAM${quantLabel}` +
        (predicted.requiredVramGb !== null ? ` (needs about ${predicted.requiredVramGb} GB)` : "") +
        `; observed ${resident}% resident — something else is holding VRAM, or a setting is constraining the load`,
    };
  }

  if (grade.fit === "partial") {
    if (resident < 100) {
      let note = `offloaded as predicted (${resident}% resident)`;
      if (!grade.sparseMoe && observed.tokensPerSecond !== null) {
        note += ` — the engine's published expectation for a dense offloaded model is roughly 1–5 tok/s; observed ${observed.tokensPerSecond.toFixed(1)}`;
      }
      return { available: true, verdict: "agrees", predicted, observed, note };
    }
    return {
      available: true,
      verdict: "disagrees",
      predicted,
      observed,
      note: "predicted CPU offload, but the model is fully resident — more VRAM was free than the grading assumed",
    };
  }

  // too_large, yet a generation happened: report it plainly rather than
  // pretending the grade was right.
  return {
    available: true,
    verdict: "disagrees",
    predicted,
    observed,
    note: `graded too large for this machine, yet it ran at ${resident}% residency — the grade's inputs are worth re-checking`,
  };
}

/**
 * The slowdown a long conversation actually has, explained honestly.
 *
 * As context grows the decode ceiling genuinely falls — KV-cache reads add
 * per-token memory traffic (the roofline's own caveat) — so a model slowing
 * down as a conversation deepens is often PHYSICS, not misconfiguration. But
 * not always: if residency fell across the same span, the slowdown is spill,
 * and calling it physics would hide exactly the problem this product exists
 * to surface. This function draws that distinction and no other.
 *
 * Cumulative context is reconstructed from the counters themselves: each
 * turn's promptEvalCount counts newly-processed prompt tokens (the uncached
 * delta) and evalCount the generated ones, so their running sum approximates
 * the context after each turn. A turn with missing counters makes every LATER
 * cumulative figure unknown — a gap does not silently heal.
 */
export function conversationPhysics(records) {
  const points = [];
  let cumulative = 0;
  let cumulativeKnown = true;

  (records ?? []).forEach((record, index) => {
    const generation = generationTokensPerSecond(record);
    const prompt = record?.reported?.promptEvalCount;
    const evaluated = record?.reported?.evalCount;
    if (usable(prompt) && usable(evaluated) && cumulativeKnown) {
      cumulative += prompt + evaluated;
    } else {
      cumulativeKnown = false;
    }
    points.push({
      turn: index + 1,
      tokensPerSecond: generation.available ? generation.value : null,
      cumulativeContextTokens: cumulativeKnown ? cumulative : null,
      residencyPercent: residencyPercent(record),
    });
  });

  const measured = points.filter((p) => p.tokensPerSecond !== null);
  if (measured.length < 2) {
    return { available: false, reason: "fewer than two measured replies", points };
  }

  const first = measured[0];
  const last = measured[measured.length - 1];
  const firstRate = first.tokensPerSecond;
  const lastRate = last.tokensPerSecond;
  const contextText =
    last.cumulativeContextTokens !== null
      ? ` as context grew to ~${last.cumulativeContextTokens.toLocaleString("en-US")} tokens`
      : "";

  let note;
  const residencyFell =
    first.residencyPercent !== null && last.residencyPercent !== null && last.residencyPercent < first.residencyPercent;
  if (Math.round(lastRate) < Math.round(firstRate)) {
    note = residencyFell
      ? `generation slowed ${firstRate.toFixed(1)} → ${lastRate.toFixed(1)} tok/s and residency fell ` +
        `${first.residencyPercent}% → ${last.residencyPercent}% — the slowdown is spill, not context physics`
      : `generation slowed ${firstRate.toFixed(1)} → ${lastRate.toFixed(1)} tok/s${contextText} — ` +
        "the ceiling genuinely falls as context grows (KV reads add per-token memory traffic); " +
        "a slowdown with growing context is physics, not misconfiguration";
  } else if (Math.round(lastRate) > Math.round(firstRate)) {
    note = `generation went ${firstRate.toFixed(1)} → ${lastRate.toFixed(1)} tok/s${contextText}`;
  } else {
    note = `generation held ~${firstRate.toFixed(1)} tok/s${contextText}`;
  }

  return { available: true, points, note, spillSuspected: residencyFell };
}

/**
 * This machine's own best for one model — the comparison the founding example
 * actually used. 8.76 tok/s was damning not against a theoretical ceiling but
 * against the 112.93 the SAME model on the SAME rig had already demonstrated,
 * and that comparison only becomes possible once history is retained.
 *
 * THE GATE IS THE ENVIRONMENT HASH. Records whose declared run conditions
 * differ from the current declaration are excluded, not blended: hash equality
 * is exactly bench's "comparable" verdict (property-tested in the environment
 * suite), so a best set under different KV-cache or flash-attention settings
 * never masquerades as this configuration's best. Excluded records are
 * COUNTED — silence about what was set aside would overstate the baseline's
 * authority.
 *
 * @param {Array} records        Stored measurement records (any models).
 * @param {object} options
 * @param {string} options.model            The model name to baseline.
 * @param {string|null} options.environmentHash Current declaration hash;
 *   records must match it exactly. Null matches only records that also carry
 *   null — "unknown conditions" only ever compares with itself.
 * @param {string|null} [options.runtime]   When given, records from OTHER
 *   runtimes are excluded and counted: two runtimes can serve the same model
 *   NAME while running different artifacts (quantization, engine), so their
 *   counters are not the same claim. Null skips the gate.
 */
export function machineBaseline(records, { model, environmentHash = null, runtime = null } = {}) {
  let best = null;
  let comparable = 0;
  let excludedByEnvironment = 0;
  let excludedByRuntime = 0;

  for (const record of records ?? []) {
    if (record?.model?.name !== model) continue;
    if (runtime !== null && record?.runtime?.name !== runtime) {
      excludedByRuntime += 1;
      continue;
    }
    if ((record.environmentHash ?? null) !== environmentHash) {
      excludedByEnvironment += 1;
      continue;
    }
    const generation = generationTokensPerSecond(record);
    if (!generation.available) continue;
    comparable += 1;
    if (best === null || generation.value > best.tokensPerSecond) {
      best = { tokensPerSecond: generation.value, recordedAt: record.recordedAt ?? null };
    }
  }

  if (best === null) {
    return {
      available: false,
      reason:
        excludedByEnvironment > 0
          ? `no comparable history — ${excludedByEnvironment} record(s) exist under different run conditions`
          : excludedByRuntime > 0
            ? `no comparable history — ${excludedByRuntime} record(s) exist from a different runtime`
            : "no measured history for this model yet",
      comparableCount: 0,
      excludedByEnvironment,
      excludedByRuntime,
    };
  }
  return { available: true, ...best, comparableCount: comparable, excludedByEnvironment, excludedByRuntime };
}

/**
 * One generation against this machine's own best. Three honest outcomes: a
 * first measurement (nothing to compare), a new best, or a figure beside the
 * standing best — stated as data, never as a percentage judgment.
 */
export function compareToBaseline(record, baseline) {
  const generation = generationTokensPerSecond(record);
  if (!generation.available) {
    return { available: false, reason: generation.reason };
  }
  if (!baseline?.available) {
    return {
      available: true,
      isFirst: true,
      isNewBest: false,
      note: "first measured reply for this model under these run conditions",
    };
  }
  if (generation.value > baseline.tokensPerSecond) {
    return {
      available: true,
      isFirst: false,
      isNewBest: true,
      previousBestTokensPerSecond: baseline.tokensPerSecond,
      note: `new best on this machine (previously ${baseline.tokensPerSecond.toFixed(1)} tok/s over ${baseline.comparableCount} comparable repl${baseline.comparableCount === 1 ? "y" : "ies"})`,
    };
  }
  return {
    available: true,
    isFirst: false,
    isNewBest: false,
    bestTokensPerSecond: baseline.tokensPerSecond,
    note: `best on this machine: ${baseline.tokensPerSecond.toFixed(1)} tok/s over ${baseline.comparableCount} comparable repl${baseline.comparableCount === 1 ? "y" : "ies"}`,
  };
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
