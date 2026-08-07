// Reading an osai-bench result file. Pure: no I/O, no clock, no randomness.
//
// A bench result is the one protocol-grade measurement artifact this platform
// produces, and this module is where its guarantees are either honoured or
// lost. Three rules shape everything below:
//
// 1. AN UNKNOWN PROTOCOL IS REFUSED, NOT GUESSED AT. A result carries its
//    protocolVersion precisely so a reader can decline to reinterpret numbers
//    produced under rules it does not know. Refusal names both versions.
// 2. QUALITY MARKS ARE LOUD AND PERMANENT. A run recorded under
//    --quality-override is marked cohort-ineligible forever by the contract;
//    the view model carries that at the top, not in a footnote.
// 3. COMPARISON IS A PRIVILEGE THE DATA MUST EARN. Two results may sit side
//    by side only when the user attests both came from this machine (cross-
//    machine comparison does not exist here, by project policy), the model
//    identity matches, and bench's own environment-comparability verdict
//    allows it. Every refusal carries the verdict's own message rather than
//    a paraphrase.

import { compareRuntimeEnvironments } from "./environment.js";

/**
 * The protocols this viewer can faithfully render. Extending this list is a
 * deliberate act that follows reading the newer protocol's spec — never a
 * loosening of the check because a file "looks close enough".
 */
export const ACCEPTED_PROTOCOL_VERSIONS = ["osai-bench/1.3"];

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const numberOrNull = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** {median, coefficientOfVariation, samples} → view shape, null-safe. */
function metric(summary) {
  if (!isObject(summary)) return null;
  return {
    median: numberOrNull(summary.median),
    coefficientOfVariation: numberOrNull(summary.coefficientOfVariation),
    samples: numberOrNull(summary.samples) ?? 0,
  };
}

/**
 * Validate one parsed result and shape it for display.
 *
 * Returns {ok:false, reason} for anything this viewer cannot faithfully
 * render, with the reason a user can act on. The view model carries nulls for
 * fields older result files legitimately lack (environment before client
 * 0.8.0, placement before 0.9.0) — absent is rendered as absent, never
 * backfilled.
 */
export function inspectBenchResult(parsed) {
  if (!isObject(parsed)) {
    return { ok: false, reason: "not a JSON object — this does not look like an osai-bench result file" };
  }
  if (typeof parsed.protocolVersion !== "string") {
    return { ok: false, reason: "no protocolVersion field — this does not look like an osai-bench result file" };
  }
  if (!ACCEPTED_PROTOCOL_VERSIONS.includes(parsed.protocolVersion)) {
    return {
      ok: false,
      reason:
        `this result was produced under ${parsed.protocolVersion}; this viewer speaks ` +
        `${ACCEPTED_PROTOCOL_VERSIONS.join(", ")} and refuses to reinterpret another protocol's numbers`,
    };
  }
  const derived = parsed.derived;
  if (!isObject(derived)) {
    return { ok: false, reason: "the result has no derived block — it may be truncated or hand-edited" };
  }

  const model = isObject(parsed.model) ? parsed.model : {};
  const runtime = isObject(parsed.runtime) ? parsed.runtime : {};
  const configuration = isObject(parsed.configuration) ? parsed.configuration : {};
  const roofline = isObject(derived.roofline) ? derived.roofline : {};
  const placement = isObject(runtime.offloadPlacement) ? runtime.offloadPlacement : null;
  const environment = isObject(runtime.environment) ? runtime.environment : null;

  return {
    ok: true,
    view: {
      protocolVersion: parsed.protocolVersion,
      clientVersion: parsed.clientVersion ?? null,
      scoringVersion: parsed.scoringVersion ?? null,
      createdAt: parsed.createdAt ?? null,

      model: {
        identifier: model.identifier ?? null,
        family: model.family ?? null,
        parameterSize: model.parameterSize ?? null,
        quantization: model.quantization ?? null,
        digest: model.digest ?? null,
        weightsBytes: numberOrNull(model.weightsBytes),
      },
      runtime: { name: runtime.name ?? null, version: runtime.version ?? null },

      // Rule 2: quality first, and never softened. `conditions` carries the
      // §4 codes that were detected (and overridden) at run time.
      quality: {
        cohortEligible: parsed.cohortEligible === true,
        qualityOverride: parsed.qualityOverride === true,
        conditions: Array.isArray(parsed.qualityConditions)
          ? parsed.qualityConditions.map((c) => c?.code).filter((c) => typeof c === "string")
          : [],
      },

      metrics: {
        generationTokensPerSecond: metric(derived.generationTokensPerSecond),
        prefillTokensPerSecond: metric(derived.prefillTokensPerSecond),
        timeToFirstTokenMs: {
          ...(metric(derived.timeToFirstTokenMs) ?? { median: null, coefficientOfVariation: null, samples: 0 }),
          reasoningWithheldPasses: numberOrNull(derived.timeToFirstTokenMs?.reasoningWithheldPasses) ?? 0,
        },
        timeToFirstVisibleTokenMs: metric(derived.timeToFirstVisibleTokenMs),
        coldLoadSeconds: numberOrNull(derived.coldLoad?.seconds),
        passFailurePercent: numberOrNull(derived.passFailureRate?.percent),
        attemptFailurePercent: numberOrNull(derived.attemptFailureRate?.percent),
      },

      roofline: {
        modelWeightsGB: numberOrNull(roofline.modelWeightsGB),
        memoryBandwidthGBps: numberOrNull(roofline.memoryBandwidthGBps),
        theoreticalMaxTokensPerSecond: numberOrNull(roofline.theoreticalMaxTokensPerSecond),
        utilization: numberOrNull(roofline.utilization),
        // Provenance travels with the number: a manual figure must render as
        // manual, a table figure as manufacturer-sourced.
        bandwidthSource: configuration.memoryBandwidthSource ?? null,
        bandwidthEntryId: configuration.memoryBandwidthEntryId ?? null,
      },

      // Passed through with their four-state status untouched: "unavailable"
      // and "not-applicable" are findings, not gaps to hide.
      diagnostics: Array.isArray(derived.diagnostics)
        ? derived.diagnostics
            .filter((d) => isObject(d))
            .map((d) => ({ id: d.id ?? null, status: d.status ?? null, message: d.message ?? null }))
        : [],

      placement: placement
        ? {
            vramResidentFraction: numberOrNull(placement.vramResidentFraction),
            residentBytes: numberOrNull(placement.residentBytes),
            vramResidentBytes: numberOrNull(placement.vramResidentBytes),
          }
        : null,

      // The declaration, verbatim: values and presence-booleans only by
      // construction upstream, and `authoritative: false` is part of the data.
      environment: environment
        ? {
            declared: environment.declared ?? null,
            declaredNonDefault: Array.isArray(environment.declaredNonDefault)
              ? environment.declaredNonDefault
              : [],
            authoritative: environment.authoritative === true,
            note: environment.note ?? null,
          }
        : null,
    },
  };
}

/**
 * Gate a side-by-side rendering of two results. Rule 3, in code.
 *
 * The environment verdict and its message come from bench's own comparability
 * module (the generated copy), so a refusal here is bench's refusal, not this
 * package's paraphrase of it.
 */
export function compareBenchResults(left, right, { sameMachineAttested = false } = {}) {
  const a = inspectBenchResult(left);
  if (!a.ok) return { allowed: false, reason: `left result: ${a.reason}` };
  const b = inspectBenchResult(right);
  if (!b.ok) return { allowed: false, reason: `right result: ${b.reason}` };

  if (left.protocolVersion !== right.protocolVersion) {
    return {
      allowed: false,
      reason: `different protocols (${left.protocolVersion} vs ${right.protocolVersion}) are not comparable`,
    };
  }

  // Project policy, enforced rather than suggested: numbers describe one
  // machine on its own terms, and no attestation UI unchecks itself.
  if (sameMachineAttested !== true) {
    return {
      allowed: false,
      reason:
        "cross-machine comparison does not exist here. Confirm both runs came from this machine to compare them.",
    };
  }

  const modelA = a.view.model;
  const modelB = b.view.model;
  if (modelA.identifier !== modelB.identifier || modelA.quantization !== modelB.quantization) {
    return {
      allowed: false,
      reason:
        `different subjects: ${modelA.identifier ?? "unknown"} (${modelA.quantization ?? "?"}) vs ` +
        `${modelB.identifier ?? "unknown"} (${modelB.quantization ?? "?"}). ` +
        "A comparison is only meaningful for the same model at the same quantization.",
    };
  }
  if (modelA.digest && modelB.digest && modelA.digest !== modelB.digest) {
    return {
      allowed: false,
      reason: "same name, different weights: the model digests differ, so these are not the same artifact.",
    };
  }

  const envVerdict = compareRuntimeEnvironments(
    left?.runtime?.environment ?? null,
    right?.runtime?.environment ?? null,
  );
  if (!envVerdict.comparable) {
    return { allowed: false, reason: envVerdict.message, environmentVerdict: envVerdict.verdict };
  }

  const notes = [];
  if (envVerdict.verdict === "advisory") notes.push(envVerdict.message);
  if ((a.view.runtime.version ?? null) !== (b.view.runtime.version ?? null)) {
    notes.push(
      `the runs used different runtime versions (${a.view.runtime.version ?? "unknown"} vs ` +
        `${b.view.runtime.version ?? "unknown"}) — a runtime upgrade can change performance on its own`,
    );
  }
  if (a.view.quality.qualityOverride || b.view.quality.qualityOverride) {
    notes.push("at least one run was recorded under --quality-override and is permanently cohort-ineligible");
  }

  return {
    allowed: true,
    environmentVerdict: envVerdict.verdict,
    environmentDifferences: envVerdict.differences,
    notes,
    left: a.view,
    right: b.view,
  };
}
