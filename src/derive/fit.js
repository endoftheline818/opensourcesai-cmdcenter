// Model fit grading for this machine.
//
// THE ENGINE IS NOT WRITTEN HERE. Thresholds, the quantization pick, and the fit
// grades themselves come from ./checker-engine.generated.js — a byte-exact copy
// of the website's lib/checker-engine.js, written by
// scripts/sync-from-website.mjs and pinned by its digest. This module is the
// layer above it: the parts that are genuinely this dashboard's own, plus a
// façade so the rest of the package imports one module instead of two.
//
// WHY THE SPLIT EXISTS (it did not, until 2026-08-06)
// This file used to be a hand-written copy of that engine, pinned by a parity
// fixture. Website #520 changed grading to charge weights PLUS runtime overhead;
// the fixture was regenerated the same morning, but porting the change here was
// a separate human act, and for six hours this package graded with the pre-fix
// rule while the whole suite stayed green. The fixture was not at fault — it
// proves a copy is IDENTICAL wherever it samples, which is a different property
// from proving somebody remembered to copy. So the copying is now mechanical and
// what remains here is only what the website does not own.
//
// WHAT IS DELIBERATELY NOT RE-EXPORTED, AND WHY IT IS NEVERTHELESS PRESENT
// `scoreModel` — the website's 0–100 ranking — and `buildRationale`, its
// workflow-matching prose. Both sit in the generated copy because the file is
// copied whole, and copying it whole is what makes it verifiable by `diff`
// instead of by judgement. Neither may reach this surface: this dashboard
// reports what fits and what it costs, and does not rank models for you. A
// composite score is an opinion dressed as a measurement, and its weights are
// only defensible on the website, where the surrounding copy explains them.
// test/package.test.js asserts no module here reaches for either.

import {
  RAM_OFFLOAD_MULTIPLIER,
  fitRequirementGb,
  gradeModelFit,
  ollamaRunCommand,
  pickBestQuantization,
} from "./checker-engine.generated.js";

// The façade. Re-exported rather than re-declared, so there is exactly one
// definition of each and no opportunity for this file to drift from the copy.
export {
  COMFORTABLE_HEADROOM_GB,
  RAM_OFFLOAD_MULTIPLIER,
  RUNTIME_OVERHEAD_GB,
  estimateTotalVram,
  estimateWeightVram,
  fitRequirementGb,
  gradeModelFit,
  gradeVramFit,
  ollamaRunCommand,
  pickBestQuantization,
} from "./checker-engine.generated.js";

export const FIT_GRADES = ["comfortable", "tight", "partial", "too_large"];

/**
 * A sparse mixture-of-experts model moves only its active experts per token, so
 * it stays genuinely usable when offloaded — where a dense model pays for every
 * weight per token and drops to 1–5 tok/s. Both were measured on the RTX 3080:
 * sparse MoE held 30–33 tok/s at ~40% residency, dense managed 2.4–3.1.
 *
 * The website inlines this predicate inside `buildRationale`, which this package
 * does not use; it is restated here rather than extracted upstream because the
 * two surfaces explain a partial fit in different words for different readers.
 *
 * Fit grading itself stays total-parameter; this changes explanation only.
 */
export function isSparseMoe(model) {
  const active = model.activeParametersBillions;
  return Number.isFinite(active) && active > 0 && active < model.parametersBillions;
}

/**
 * Plain-language explanation of a fit result. Deliberately states the cost of a
 * partial fit rather than presenting it as a pass — "it runs" and "it is usable"
 * are different claims, and conflating them is how a recommendation surface
 * loses trust.
 */
export function explainFit({ model, quant, fit, vramGb }) {
  if (!quant || fit === "too_large") {
    const minWeights =
      model.quantizations?.q4_k_m?.vramGb ?? model.quantizations?.q8_0?.vramGb ?? 0;
    // VRAM figure carries the runtime overhead; the RAM figure deliberately
    // does not — the 1.6x offload multiplier already absorbs it.
    const minNeeded = minWeights > 0 ? fitRequirementGb(minWeights) : 0;
    return `Needs about ${minNeeded} GB of VRAM including runtime overhead, or roughly ${Math.ceil(minWeights * RAM_OFFLOAD_MULTIPLIER)} GB of system RAM to run on CPU. This machine has neither.`;
  }

  const required = fitRequirementGb(model.quantizations[quant].vramGb);
  const quantLabel = { fp16: "FP16", q8_0: "Q8_0", q4_k_m: "Q4_K_M" }[quant] ?? quant;

  if (fit === "comfortable") {
    const headroom = Math.round((vramGb - required) * 10) / 10;
    return `Fits in ${quantLabel} with ${headroom} GB of VRAM to spare.`;
  }
  if (fit === "tight") {
    return `Fills nearly all ${vramGb} GB of VRAM in ${quantLabel}. Close long-context sessions you are not using.`;
  }
  if (isSparseMoe(model)) {
    return `Runs via CPU RAM offload in ${quantLabel} at usable speed — it is a sparse mixture-of-experts model and activates only about ${model.activeParametersBillions}B of its ${model.parametersBillions}B parameters per token.`;
  }
  return `Runs via CPU RAM offload in ${quantLabel}, but expect roughly 1–5 tokens per second.`;
}

/**
 * Grade one catalog model against this machine.
 *
 * @param {object} model    A catalog entry.
 * @param {object} hardware {vramGb, systemRamGb} — already resolved by the
 *   caller, which is where the Apple usable-memory and nameplate-rounding rules
 *   are applied. This function does no unit reasoning of its own.
 */
export function gradeModel(model, { vramGb = 0, systemRamGb = 0 } = {}) {
  // The engine destructures `model.quantizations` without a guard, because the
  // website's catalog-integrity gate guarantees the field is there. Here the
  // catalog is a committed snapshot, so the guard belongs on this side of the
  // boundary — and it belongs HERE specifically rather than in the copy, which
  // has to stay byte-exact to remain checkable by `diff`. A malformed entry
  // grades as unrunnable; a dashboard that throws while drawing a table would
  // take the whole page down over one bad row.
  const quant = model.quantizations ? pickBestQuantization(model, vramGb, systemRamGb) : null;

  const weightsGb = quant ? model.quantizations[quant].vramGb : null;
  // gradeModelFit is the engine's OWN composition of the two quantities that
  // #520 proved are easy to confuse — weights + overhead for the VRAM branches,
  // bare weights as the offload basis. Calling it, rather than reassembling
  // gradeVramFit's four arguments here, is the point of consuming the engine
  // instead of reimplementing it: upstream added that helper precisely because
  // doing this at each call site was "eighteen chances to pass the wrong
  // quantity to the wrong parameter".
  const fit = quant ? gradeModelFit(vramGb, weightsGb, systemRamGb) : "too_large";
  // The honest figure to display: what the machine needs free, not what the
  // file weighs.
  const requiredVramGb = quant ? fitRequirementGb(weightsGb) : null;

  return {
    id: model.id,
    name: model.name,
    parametersBillions: model.parametersBillions,
    activeParametersBillions: model.activeParametersBillions ?? null,
    sparseMoe: isSparseMoe(model),
    contextWindowTokens: model.contextWindowTokens ?? null,
    license: model.license ?? null,
    quant,
    requiredVramGb,
    fit,
    explanation: explainFit({ model, quant, fit, vramGb }),
    // A command is offered to COPY, never to run.
    runCommand: quant ? ollamaRunCommand(model, quant) : null,
    ollamaTag: model.ollamaTag ?? null,
  };
}

const FIT_ORDER = { comfortable: 0, tight: 1, partial: 2, too_large: 3 };

/**
 * Grade a catalog against this machine.
 *
 * Ordering is by fit then by size descending — NOT by a quality score. The
 * dashboard's job is to say what runs here and what it costs; picking a
 * "best" model is the website's job, where the reasoning is visible.
 */
export function gradeCatalog(models, hardware) {
  return models
    .map((model) => gradeModel(model, hardware))
    .sort((a, b) => {
      const byFit = FIT_ORDER[a.fit] - FIT_ORDER[b.fit];
      if (byFit !== 0) return byFit;
      return (b.parametersBillions ?? 0) - (a.parametersBillions ?? 0);
    });
}
