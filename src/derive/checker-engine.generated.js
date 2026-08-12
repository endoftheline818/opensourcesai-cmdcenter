// GENERATED FILE — DO NOT EDIT. Re-run the sync script instead.
//
// A byte-exact copy of opensourcesai.com's lib/checker-engine.js. This package keeps
// a hard boundary with that repository and never imports across it; the engine
// is copied instead, and this file is that copy.
//
// WHY GENERATED RATHER THAN HAND-PORTED
// It was hand-ported until 2026-08-06, and the hand step is where it failed.
// Website #520 fixed grading to charge weights PLUS runtime overhead; the parity
// fixture beside this file was regenerated the same morning, but carrying the
// change into src/derive/fit.js was a separate human act. For six hours this
// package graded with the pre-fix rule and its whole suite stayed green. A
// fixture proves a copy is IDENTICAL where it samples; it cannot prove someone
// remembered to copy. Nothing here is written by hand any more.
//
//   source      opensourcesai.com lib/checker-engine.js
//   sha256      e31ca84c24124bc1ad2bc43afe749e9cd2ad490240f1816c77557657e0f545f0
//   copied      2026-08-12
//   regenerate  node scripts/sync-from-website.mjs ../opensourcesai.com
//
// The digest covers everything below the marker — the upstream bytes, LF-normalized —
// and test/fit.test.js recomputes it, so an edit here fails the suite instead of
// quietly forking the engine.
//
// NOT EVERYTHING BELOW IS USED. `scoreModel` and `buildRationale` arrive because
// the file arrives whole, and src/derive/fit.js deliberately does not re-export
// either. See the note there; test/package.test.js asserts they stay unreachable.
// @generated:begin-verbatim
// pure, no react/side-effects so it runs client or server.

// effective bits-per-weight per quant (llama.cpp quantize table / community-measured
// file sizes, re-verified 2026-07: Q8_0 8.5, Q6_K 6.56, Q5_K_M 5.69, Q4_K_M 4.85,
// Q4_K_S 4.58 — K-quants carry per-block scale/min metadata above their nominal bits)
const EFFECTIVE_BITS = {
  fp32:   32,
  fp16:   16,
  bf16:   16,
  q8_0:   8.5,
  q6_k:   6.56,
  q5_k_m: 5.69,
  q4_k_m: 4.85,
  q4_k_s: 4.58,
  q3_k_m: 3.91,
  q2_k:   2.5,
  iq4_xs: 4.25,
  iq4_nl: 4.5,
  iq3_xs: 3.4,
  iq2_xs: 2.31,
};

// activations + runtime bookkeeping + ~1gb headroom
export const RUNTIME_OVERHEAD_GB = 1.5;

// Grading thresholds, exported so a consumer can STATE them rather than restate
// them. src/lib/checkerResultContract.js publishes these numbers as the
// assumptions behind a citable result; importing them means an engine change
// rewrites the published assumption instead of silently contradicting it.
export const COMFORTABLE_HEADROOM_GB = 2;
export const RAM_OFFLOAD_MULTIPLIER = 1.6;

export function estimateWeightVram(paramsBillions, effectiveBits) {
  return (paramsBillions * effectiveBits) / 8;
}

// weights + fixed overhead. kv-cache is context-specific so it's handled separately when known.
export function estimateTotalVram(paramsBillions, quantKey) {
  const bits = EFFECTIVE_BITS[quantKey] ?? EFFECTIVE_BITS.q4_k_m;
  return estimateWeightVram(paramsBillions, bits) + RUNTIME_OVERHEAD_GB;
}

// The catalog's `quantizations[q].vramGb` is WEIGHTS ONLY — verified against real
// bench captures, where the stored figure tracks measured weight bytes and nothing
// else. Fit must be graded against weights PLUS runtime overhead, which is what
// /methodology and the copy-to-clipboard summary have always told visitors:
// "the model's weights at a given quantization, plus roughly 1.5 GB of runtime
// overhead for the inference server itself."
//
// That promise was not kept. `estimateTotalVram()` above adds the overhead but was
// never called by any grading path, so every surface graded against bare weights
// and the published safety margin did not exist. On an 8 GB M1 (6 GB effective)
// that rated Qwen3 8B — 5.3 GB of weights — a "tight" fit, and it does not load at
// all: measured resident was 5.58 GB before KV cache, and Ollama timed out starting
// llama-server. See docs/lab/osai-bench-apple-silicon-checker-finding-2026-08-05.md.
//
// Use this at EVERY boundary where a catalog figure becomes a fit input, so the two
// quantities can never be confused again. `gradeVramFit`'s second parameter has
// always meant total required VRAM — the callers were feeding it weights.
//
// Non-numeric input passes through untouched: several callers guard on a null or
// undefined requirement, and quietly turning that into 1.5 would invent a fit.
export function fitRequirementGb(weightsGb) {
  const weights = Number(weightsGb);
  if (!Number.isFinite(weights) || weights <= 0) return weightsGb;
  return weights + RUNTIME_OVERHEAD_GB;
}

// comfortable: vram >= required+2, tight: vram >= required, partial: ram offload viable, else too_large.
// ram offload needs ~1.6x to cover split cpu/gpu overhead.
//
// `offloadBasisGb` exists because the two branches are calibrated against different
// quantities. The VRAM branches take weights PLUS runtime overhead (see
// fitRequirementGb). The offload branch takes bare WEIGHTS, because its 1.6x
// multiplier was calibrated end-to-end against real offloaded runs and already
// absorbs the runtime cost — inflating the basis as well counts it twice.
//
// That is not a theoretical worry. The 2570server rig is 10 GB VRAM / 32 GB RAM,
// and `qwen3:32b` (20 GB Q4_K_M) was MEASURED there at 2.36 tok/s — squarely inside
// the "expect 1–5 tokens/s" this project publishes for a partial fit. Charging the
// overhead twice raises its requirement to 34.4 GB and calls that rig too_large,
// contradicting our own lab evidence. See
// docs/lab/osai-bench-full-catalog-sweep-2026-08-03.md.
//
// It defaults to requiredVramGb so every existing 2- and 3-argument call — including
// the assertions opensourcesai-mobile pins — behaves exactly as before.
export function gradeVramFit(vramGb, requiredVramGb, systemRamGb = 0, offloadBasisGb = requiredVramGb) {
  if (vramGb > 0) {
    if (vramGb >= requiredVramGb + COMFORTABLE_HEADROOM_GB) return 'comfortable';
    if (vramGb >= requiredVramGb)                           return 'tight';
  }
  if (systemRamGb >= offloadBasisGb * RAM_OFFLOAD_MULTIPLIER) return 'partial';
  return 'too_large';
}

// Grade a CATALOG figure. Callers hold weights, not a fit requirement, and every
// one of them needs the same two derivations — weights + overhead for the VRAM
// branches, bare weights for the offload branch. Doing that at each call site meant
// eighteen chances to pass the wrong quantity to the wrong parameter, so it happens
// here once instead. Prefer this over calling gradeVramFit directly with a catalog
// number; gradeVramFit stays exported for consumers that already hold a requirement.
export function gradeModelFit(vramGb, weightsGb, systemRamGb = 0) {
  return gradeVramFit(vramGb, fitRequirementGb(weightsGb), systemRamGb, weightsGb);
}

// highest-quality quant that fits vram, falling back to cpu/ram offload for q4_k_m
export function pickBestQuantization(model, vramGb, systemRamGb = 0) {
  const { q4_k_m, q8_0, fp16 } = model.quantizations;
  // Same requirement the fit grade uses. If these two disagreed, the checker could
  // offer a quantization it then rated too_large.
  if (vramGb > 0) {
    if (fp16  && vramGb >= fitRequirementGb(fp16.vramGb))   return 'fp16';
    if (q8_0  && vramGb >= fitRequirementGb(q8_0.vramGb))   return 'q8_0';
    if (q4_k_m && vramGb >= fitRequirementGb(q4_k_m.vramGb)) return 'q4_k_m';
  }
  // Bare weights here, matching gradeVramFit's offload branch — see the note on
  // `offloadBasisGb` for why the 1.6x multiplier is calibrated against weights and
  // must not also carry the runtime overhead. These two must agree, or this function
  // offers a quantization the grader then calls too_large.
  if (q4_k_m && systemRamGb >= q4_k_m.vramGb * RAM_OFFLOAD_MULTIPLIER) return 'q4_k_m';
  return null;
}

// 0-100: use-case 35, quant quality 25, vram fit 25, context 10, size depth 4–12, license penalty -5, preference bias ±10
export function scoreModel(model, vramGb, systemRamGb, workflow, preference = 'balanced') {
  const quant = pickBestQuantization(model, vramGb, systemRamGb);
  if (!quant) return 0;

  const required = fitRequirementGb(model.quantizations[quant].vramGb);
  const fit = gradeVramFit(vramGb, required, systemRamGb);
  let score = 0;

  // use-case match (handle both spellings of summarisation)
  const normalised = workflow === 'summarization' ? 'summarisation' : workflow;
  if (model.strengths.includes(normalised) || model.strengths.includes(workflow)) score += 35;

  // quant quality
  if (quant === 'fp16')   score += 25;
  else if (quant === 'q8_0') score += 20;
  else                    score += 10;

  // vram fit
  if      (fit === 'comfortable') score += 25;
  else if (fit === 'tight')       score += 15;
  else if (fit === 'partial')     score += 5;

  // context window relevance (matters most for rag)
  if (workflow === 'rag' && model.contextWindowTokens >= 32768) score += 10;
  else if (model.contextWindowTokens >= 32768) score += 4;

  // practical sweet-spot bias (a tie-breaker on top of the separate VRAM-fit score, not
  // a raw "bigger is always better" rule): 12–29B models are the best quality-for-VRAM
  // tradeoff on consumer hardware, so they get the largest bonus. 30B+ scores below that
  // tier on purpose because it usually only fits via slow RAM offload; sub-7B gets nothing.
  // Tier maxima MUST stay in sync with the score legend in
  // components/LocalLlmCompatibilityFinder.js — "model size — 12–29B sweet spot (up to 17 pts)".
  if      (model.parametersBillions >= 30) score += 10;
  else if (model.parametersBillions >= 12) score += 17;
  else if (model.parametersBillions >= 7)  score += 6;

  // non-permissive license penalty
  const lic = model.license.toLowerCase();
  if (!lic.includes('apache') && !lic.includes('mit')) score -= 5;

  // user preference bias
  if (preference === 'speed') {
    if (quant === 'fp16' || quant === 'q8_0') score -= 10;
    else if (quant === 'q4_k_m')              score += 10;
  } else if (preference === 'quality') {
    if (quant === 'fp16' || quant === 'q8_0') score += 10;
    if (fit === 'partial')                    score -= 10;
  }

  return Math.max(0, Math.min(100, score));
}

export function buildRationale(model, quant, vramGb, systemRamGb, workflow) {
  if (!quant) {
    const minNeeded = model.quantizations.q4_k_m?.vramGb ?? model.quantizations.q8_0?.vramGb ?? 0;
    return (
      `${model.name} needs at least ${minNeeded} GB of VRAM or ` +
      `${Math.ceil(minNeeded * 1.6)} GB of system RAM for CPU inference — ` +
      `both exceed your available resources.`
    );
  }

  const required = fitRequirementGb(model.quantizations[quant].vramGb);
  const fit = gradeVramFit(vramGb, required, systemRamGb);
  const quantLabel = { fp16: 'FP16', q8_0: 'Q8_0', q4_k_m: 'Q4_K_M' }[quant];

  // Sparse-MoE offload honesty (#451): a dense model offloaded to system RAM
  // pays for every weight per token — 1–5 tokens/s is the honest dense story. A
  // sparse mixture-of-experts model moves only its active experts per token and
  // stays genuinely usable offloaded (both catalog MoE entries measured
  // ~30–43 tokens/s on a 10 GB RTX 3080). The predicate is inlined rather than
  // imported from wizardEngine because that module imports from THIS one — the
  // field's validity (positive, smaller than total) is enforced by
  // scripts/assert-catalog-integrity.js, so both engines reduce to the same
  // "field present and valid" check. Fit grading itself stays total-parameter
  // by founder decision (#446) — this branch changes copy only.
  const activeB = model.activeParametersBillions;
  const sparseMoe =
    Number.isFinite(activeB) && activeB > 0 && activeB < model.parametersBillions;

  let fitPhrase;
  if (fit === 'comfortable') {
    const headroom = Math.round((vramGb - required) * 10) / 10;
    fitPhrase = `fits in ${quantLabel} with ${headroom} GB of VRAM to spare`;
  } else if (fit === 'tight') {
    fitPhrase = `fills nearly all ${vramGb} GB of VRAM in ${quantLabel} — close long context sessions when not needed`;
  } else if (sparseMoe) {
    fitPhrase = `runs via CPU RAM offload in ${quantLabel} at usable speed — a sparse mixture-of-experts model activates only ~${activeB}B of its ${model.parametersBillions}B parameters per token`;
  } else {
    fitPhrase = `runs via CPU RAM offload in ${quantLabel} — expect 1–5 tokens/s`;
  }

  const normalised = workflow === 'summarization' ? 'summarisation' : workflow;
  const hasStrength = model.strengths.includes(normalised) || model.strengths.includes(workflow);
  const workflowLabel = {
    chat: 'chat', coding: 'coding', rag: 'RAG', agents: 'agent workflows',
    summarization: 'summarisation', reasoning: 'reasoning',
  }[workflow] ?? workflow;

  const matchPhrase = hasStrength
    ? `Rated strong for ${workflowLabel} tasks.`
    : `Not listed as a primary strength for ${workflowLabel}, but capable for general use.`;

  return `${model.name} ${fitPhrase}. ${matchPhrase}`;
}

// Quant-variant tags are not derivable from the base tag (llama3:8b needs
// llama3:8b-instruct-q8_0, phi4 needs phi4:14b-q8_0, …), so fp16/q8_0 commands
// render only when the catalog carries an explicit registry-verified tag —
// never synthesize one (the fabricated-tag defect class the integrity gate exists for).
export function ollamaRunCommand(model, quant) {
  if (!model.ollamaTag) return null;

  if (quant === 'fp16') {
    return model.ollamaTagFp16 ? `ollama run ${model.ollamaTagFp16}` : null;
  }
  if (quant === 'q8_0') {
    return model.ollamaTagQ8 ? `ollama run ${model.ollamaTagQ8}` : null;
  }
  return `ollama run ${model.ollamaTag}`;
}
