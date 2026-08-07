// GENERATED FILE — DO NOT EDIT. Re-run the sync script instead.
//
// A byte-exact copy of opensourcesai-bench's src/derivation/environment.js. This
// package keeps a hard boundary with the bench repository and never imports
// across it; the module is copied instead, and this file is that copy.
//
// WHAT THIS MODULE IS, AND WHY IT IS SHARED VERBATIM
// It is the single definition of which Ollama server settings change what a
// measurement MEANS: the allowlisted variables, whether each is captured by
// value or by presence (§9 of the bench protocol — path-like and address-like
// values never leave the machine), and the comparability verdict two runs get
// (comparable / advisory / incomparable / unknown). Command Center uses it to
// stamp its own measurement records and to refuse side-by-side rendering of
// results whose run conditions differ. Two repos re-deriving those rules
// independently would eventually disagree about which comparisons are honest —
// the exact failure class the verbatim-copy mechanism exists to close.
//
//   source      opensourcesai-bench src/derivation/environment.js (client 0.11.0)
//   sha256      29a7970739d41e9f2111ab507de699c0be86b4517b2452a10fd7281f26b7b25c
//   copied      2026-08-07
//   regenerate  node scripts/sync-from-bench.mjs ../opensourcesai-bench
//
// The digest covers everything below the marker — the upstream bytes,
// LF-normalized — and test/environment.test.js recomputes it, so an edit here
// fails the suite instead of quietly forking the rules.
// @generated:begin-verbatim
// Ollama server settings that change what gets measured.
//
// IMPORTANT — this is a DECLARATION, not a reading. The bench reads these from
// its own process environment, which is not guaranteed to be the environment
// the Ollama *server* was started with: the server is a separate process (a
// Windows service, a systemd unit, a container) and may hold entirely
// different values. Ollama exposes no endpoint that reports its resolved
// configuration, so no authoritative reading is available over the API.
//
// Two rules follow, and both are load-bearing:
//   1. Nothing here may feed a measurement, a derived metric, or a score. It is
//      metadata about run conditions only.
//   2. Two runs whose declarations differ are not comparable, and two runs
//      whose declarations *match* are only presumed comparable — the
//      declaration could be wrong on either side. `unknown` is a real outcome
//      and must never be reported as `comparable`.
//
// Observed 2026-07-26: the RTX 4070 Ti box declares OLLAMA_KV_CACHE_TYPE=q8_0
// and OLLAMA_FLASH_ATTENTION=true; the RTX 3080 rig declares neither and runs
// f16. Same model, same context: 272 MiB of KV cache against 512 MiB. Every
// cross-box comparison in the fixture set predates this capture.

export const ENVIRONMENT_DECLARATION_SOURCE = "client-process-env";

// Allowlist, from `ollama serve --help` on 0.32.3. Strictly an allowlist:
// §9 forbids recording anything identifying the machine or its user, so
// path-like and address-like variables are captured as presence only —
// OLLAMA_MODELS routinely contains a home directory, OLLAMA_HOST an address.
//
// `comparability`:
//   blocking — changes what is measured; differing values make runs incomparable
//   advisory — may explain a discrepancy but does not by itself invalidate one
export const OLLAMA_ENVIRONMENT_VARIABLES = [
  {
    name: "OLLAMA_KV_CACHE_TYPE",
    capture: "value",
    comparability: "blocking",
    documentedDefault: "f16",
    reason: "K/V cache quantization changes KV VRAM footprint and can change throughput",
  },
  {
    name: "OLLAMA_FLASH_ATTENTION",
    capture: "value",
    comparability: "blocking",
    documentedDefault: null,
    reason: "Flash attention changes the attention kernel used for prefill and generation",
  },
  {
    name: "OLLAMA_CONTEXT_LENGTH",
    capture: "value",
    comparability: "blocking",
    documentedDefault: null,
    reason: "Server-side default context length changes KV allocation when num_ctx is unset",
  },
  {
    name: "OLLAMA_NUM_PARALLEL",
    capture: "value",
    comparability: "blocking",
    documentedDefault: null,
    reason: "Parallel request slots multiply KV cache allocation",
  },
  {
    name: "OLLAMA_GPU_OVERHEAD",
    capture: "value",
    comparability: "blocking",
    documentedDefault: null,
    reason: "Reserved VRAM per GPU changes how many layers fit and can force partial offload",
  },
  {
    name: "OLLAMA_SCHED_SPREAD",
    capture: "value",
    comparability: "blocking",
    documentedDefault: null,
    reason: "Spreading a model across all GPUs changes placement",
  },
  {
    name: "OLLAMA_LLM_LIBRARY",
    capture: "value",
    comparability: "blocking",
    documentedDefault: null,
    reason: "Bypassing library autodetection changes the compute backend",
  },
  {
    name: "LLAMA_ARG_FIT",
    capture: "value",
    comparability: "blocking",
    documentedDefault: "on",
    reason: "llama.cpp automatic memory fit changes offload decisions (Ollama 0.32+)",
  },
  {
    name: "LLAMA_ARG_FIT_TARGET",
    capture: "value",
    comparability: "blocking",
    documentedDefault: null,
    reason: "Target free-VRAM margin changes offload decisions (Ollama 0.32+)",
  },
  {
    name: "OLLAMA_MAX_LOADED_MODELS",
    capture: "value",
    comparability: "advisory",
    documentedDefault: null,
    reason: "Co-resident models compete for VRAM; §4 preconditions already check for them",
  },
  {
    name: "OLLAMA_KEEP_ALIVE",
    capture: "value",
    comparability: "advisory",
    documentedDefault: "5m",
    reason: "The protocol sets keep_alive per request, so the server default rarely applies",
  },
  {
    name: "OLLAMA_DEBUG",
    capture: "value",
    comparability: "advisory",
    documentedDefault: null,
    reason: "Verbose logging adds minor per-request overhead",
  },
  {
    name: "OLLAMA_MODELS",
    capture: "presence",
    comparability: "advisory",
    documentedDefault: null,
    reason: "A relocated model store can change cold-load time (storage medium differs)",
  },
  {
    name: "OLLAMA_HOST",
    capture: "presence",
    comparability: "advisory",
    documentedDefault: null,
    reason: "Recorded as presence only; §10 already requires a loopback endpoint",
  },
];

const BY_NAME = new Map(
  OLLAMA_ENVIRONMENT_VARIABLES.map((variable) => [variable.name, variable]),
);

function normalize(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function declaredValue(variable, rawEnvironment) {
  const raw = normalize(rawEnvironment?.[variable.name]);
  // Presence-only variables never record their value (§9).
  return variable.capture === "presence" ? raw !== null : raw;
}

/**
 * Shape the client process environment into the recorded declaration.
 * Pure: pass a synthetic environment object in tests.
 */
export function deriveRuntimeEnvironment(rawEnvironment = {}) {
  const declared = {};
  const nonDefault = [];
  for (const variable of OLLAMA_ENVIRONMENT_VARIABLES) {
    const value = declaredValue(variable, rawEnvironment);
    declared[variable.name] = value;
    const isSet = variable.capture === "presence" ? value : value !== null;
    if (isSet) nonDefault.push(variable.name);
  }
  return {
    source: ENVIRONMENT_DECLARATION_SOURCE,
    authoritative: false,
    note:
      "Read from the benchmark client's own process environment. The Ollama " +
      "server may have been started with a different environment; Ollama " +
      "exposes no endpoint reporting its resolved configuration.",
    declared,
    declaredNonDefault: nonDefault,
  };
}

function isDeclaration(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    value.declared !== null &&
    typeof value.declared === "object"
  );
}

function difference(name, left, right) {
  const variable = BY_NAME.get(name);
  return {
    variable: name,
    comparability: variable?.comparability ?? "advisory",
    reason: variable?.reason ?? null,
    left: left ?? null,
    right: right ?? null,
  };
}

/**
 * Compare two recorded environment declarations.
 *
 * Returns `verdict`:
 *   "unknown"      — one or both runs predate environment capture. NOT comparable.
 *   "incomparable" — a blocking variable differs.
 *   "advisory"     — only advisory variables differ.
 *   "comparable"   — declarations match (presumed comparable; see module header).
 */
export function compareRuntimeEnvironments(left, right) {
  if (!isDeclaration(left) || !isDeclaration(right)) {
    return {
      verdict: "unknown",
      comparable: false,
      differences: [],
      message:
        "At least one run has no recorded runtime environment, so the two " +
        "cannot be shown to be comparable. Re-capture with a client that " +
        "records runtime.environment.",
    };
  }

  const differences = [];
  for (const variable of OLLAMA_ENVIRONMENT_VARIABLES) {
    const a = left.declared[variable.name] ?? null;
    const b = right.declared[variable.name] ?? null;
    if (a !== b) differences.push(difference(variable.name, a, b));
  }

  const blocking = differences.filter(
    (entry) => entry.comparability === "blocking",
  );
  if (blocking.length > 0) {
    return {
      verdict: "incomparable",
      comparable: false,
      differences,
      message:
        `${blocking.length} setting(s) that change what is measured differ: ` +
        `${blocking.map((entry) => entry.variable).join(", ")}. ` +
        "These runs must not be compared or pooled into a cohort.",
    };
  }
  if (differences.length > 0) {
    return {
      verdict: "advisory",
      comparable: true,
      differences,
      message:
        `Runs are comparable, but ${differences.length} advisory setting(s) ` +
        `differ: ${differences.map((entry) => entry.variable).join(", ")}.`,
    };
  }
  return {
    verdict: "comparable",
    comparable: true,
    differences: [],
    message:
      "Both runs declare the same Ollama environment. Comparability is " +
      "presumed, not proven — each declaration is the client's own " +
      "environment, not a reading from the server.",
  };
}
