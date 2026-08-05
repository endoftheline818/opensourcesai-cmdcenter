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

// POST-UNLOAD VERIFICATION.
//
// HTTP 200 from Ollama means "I accepted the unload", not "the model is gone".
// Those come apart in practice: anything else on the machine that requests the
// model — an editor plugin, a benchmark run, a chat client — reloads it
// immediately. On a machine with OLLAMA_KEEP_ALIVE set long, it then STAYS
// loaded, so a working unload looks like a broken button.
//
// That exact confusion cost real debugging time on the Linux rig, where the
// unload was correct all along and a background benchmark was re-requesting the
// model against a 24-hour keep-alive. The tool reported success and showed the
// model still resident, with nothing to reconcile the two.
//
// /api/ps is a GET. This adds no mutation surface — it only checks the
// postcondition of one that already existed.
const VERIFY_ATTEMPTS = 3;
const VERIFY_DELAY_MS = 400;

/**
 * Names Ollama currently reports as resident, or NULL when that could not be
 * read. Null and [] are deliberately different: "nothing is loaded" and "I
 * could not tell" are different claims, and collapsing them would let a failed
 * check masquerade as a confirmed unload.
 */
async function residentModelNames(host, fetchImpl) {
  try {
    const res = await fetchImpl(host + "/api/ps", { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const body = await res.json();
    return (body.models ?? []).map((m) => m.name);
  } catch {
    return null;
  }
}

/**
 * Confirm a model actually left memory.
 *
 * Checks immediately — the common case, where the unload simply worked — and
 * only then pays for retries, so a successful unload stays fast.
 */
async function confirmUnloaded({ host, model, fetchImpl, sleep }) {
  let everChecked = false;

  for (let attempt = 0; attempt < VERIFY_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await sleep(VERIFY_DELAY_MS);
    const resident = await residentModelNames(host, fetchImpl);
    if (resident === null) continue;
    everChecked = true;
    if (!resident.includes(model)) return { state: "gone" };
  }

  return everChecked
    ? { state: "still-resident" }
    : { state: "unknown", reason: "could not read what is resident" };
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
export function createActions({
  host,
  fetchImpl = fetch,
  // Injected so the verification retries do not make the suite wait in real
  // time. Timers are fine here: this is the action layer, not derive/.
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
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
      const elapsedMs = Date.now() - started;

      // A load already proves itself — the caller sees it appear in the loaded
      // list. An unload has to prove a NEGATIVE, which is why only it is
      // verified here.
      //
      // Note this stays ok:true when the model is resident again. The action
      // did succeed; Ollama accepted it and released the model. Something else
      // reloading it afterwards is a separate fact about the machine, and
      // reporting it as a failed action would blame the wrong thing.
      if (action === "unload") {
        return { ok: true, action, model, elapsedMs, verified: await confirmUnloaded({ host, model, fetchImpl, sleep }) };
      }
      return { ok: true, action, model, elapsedMs };
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
