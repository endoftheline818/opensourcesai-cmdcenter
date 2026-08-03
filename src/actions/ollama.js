// THE ONLY MUTATION SURFACE IN THIS PACKAGE.
//
// Phase 1 was read-only by construction: the server refused every non-GET verb
// before routing, so there was no mutating endpoint to reach. Phase 2 opens
// exactly two actions — load a model, unload a model — and nothing else.
//
// WHY THESE TWO AND NOTHING ELSE
// Both are small, reversible, and self-undoing: a loaded model unloads itself
// when its keep-alive expires, and an unloaded model reloads on next use. They
// destroy nothing and cost nothing but VRAM and a few seconds. Compare `pull`
// (downloads gigabytes over someone's connection) or `delete` (irreversible,
// destroys data the user may not be able to re-obtain). Those are deliberately
// NOT here, and test/actions.test.js asserts they are unreachable.
//
// HOW THE NARROWNESS IS ENFORCED, rather than merely intended:
//   - Exactly one Ollama endpoint is ever called: /api/generate. Not /api/pull,
//     not /api/delete, not /api/push, not /api/create.
//   - The prompt is ALWAYS empty. This module cannot run inference; it can only
//     move a model in or out of memory.
//   - `keep_alive` comes from a fixed internal set, never from the caller.
//   - The model name must match one Ollama already reports as installed, so a
//     caller cannot name an arbitrary string and provoke surprising behaviour.

/** The complete set of actions. Adding to this list is a deliberate act. */
export const ACTIONS = ["load", "unload"];

/** Fixed keep-alive values. Never caller-supplied. */
const KEEP_ALIVE = { load: "5m", unload: 0 };

const OLLAMA_ENDPOINT = "/api/generate";

async function installedModelNames(host) {
  const res = await fetch(host + "/api/tags", { signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error("could not list installed models");
  const body = await res.json();
  return (body.models ?? []).map((m) => m.name);
}

/**
 * Validate a requested action against what is actually installed.
 *
 * PURE and exported so the allowlist can be tested without a running Ollama.
 * Returns a reason string when refused — never throws for ordinary bad input,
 * because a user picking a stale entry from a dropdown is not an error
 * condition, it is a thing to explain.
 */
export function validateRequest({ action, model }, installed) {
  if (!ACTIONS.includes(action)) return { ok: false, reason: `unsupported action: ${String(action).slice(0, 40)}` };
  if (typeof model !== "string" || model.trim() === "") return { ok: false, reason: "no model given" };
  if (model.length > 200) return { ok: false, reason: "model name is implausibly long" };

  // Exact match against the live installed list. Not a pattern, not a prefix —
  // the set of acceptable values is enumerated by Ollama itself, so there is no
  // string a caller can craft that reaches anything unexpected.
  if (!installed.includes(model)) {
    return { ok: false, reason: "that model is not installed on this machine" };
  }
  return { ok: true };
}

/**
 * Build the request body for an action.
 *
 * PURE. Kept separate so a test can assert the exact shape that goes over the
 * wire — specifically that the prompt is empty and keep_alive is ours.
 */
export function buildActionBody({ action, model }) {
  return {
    model,
    // Empty, always. This module moves models in and out of memory; it does
    // not generate. An action that could carry a prompt would be an inference
    // API wearing a control-panel label.
    prompt: "",
    stream: false,
    keep_alive: KEEP_ALIVE[action],
  };
}

/**
 * @param {object} deps
 * @param {string} deps.host        Resolved Ollama endpoint (loopback).
 * @param {typeof fetch} [deps.fetchImpl] Injected for tests.
 */
export function createActions({ host, fetchImpl = fetch }) {
  async function perform({ action, model }) {
    let installed;
    try {
      installed = await installedModelNames(host);
    } catch {
      return { ok: false, status: 503, reason: "Ollama is not reachable" };
    }

    const check = validateRequest({ action, model }, installed);
    if (!check.ok) return { ok: false, status: 400, reason: check.reason };

    const started = Date.now();
    try {
      const res = await fetchImpl(host + OLLAMA_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildActionBody({ action, model })),
        // Loading a large model from cold storage is genuinely slow; unloading
        // is immediate. A short timeout here would report failure on a load
        // that is actually progressing.
        signal: AbortSignal.timeout(action === "load" ? 300000 : 15000),
      });
      if (!res.ok) {
        return { ok: false, status: 502, reason: `Ollama refused: HTTP ${res.status}` };
      }
      await res.json().catch(() => null);
      return { ok: true, action, model, elapsedMs: Date.now() - started };
    } catch (err) {
      // Generic on purpose: an error string from a runtime can carry a
      // filesystem path, and this response crosses a boundary.
      return { ok: false, status: 502, reason: action === "load" ? "the model did not load" : "the model did not unload" };
    }
  }

  return {
    load: (model) => perform({ action: "load", model }),
    unload: (model) => perform({ action: "unload", model }),
    perform,
  };
}
