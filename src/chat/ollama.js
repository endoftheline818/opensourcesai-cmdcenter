// The inference surface — the module MAINTAINING §4b authorizes, built under
// its rules and no others.
//
// WHAT THIS IS. A thin relay: the browser POSTs a message, this module streams
// it to Ollama's /api/chat on loopback and streams Ollama's NDJSON back
// unmodified — and BECAUSE it sits in the middle, it is the measurement point.
// Timestamps are taken here, server-side, so the browser's rendering never
// contaminates a time-to-first-token figure; the final chunk's counters are
// Ollama's own; and one /api/ps read after the stream closes (~2 ms, outside
// the measured interval) records where the model was actually resident. The
// generation itself is the probe — nothing extra runs while tokens flow.
//
// THE RULES, RESTATED FROM §4b BECAUSE THIS FILE IS WHERE THEY BIND:
//   - Loopback only. The host arrives from resolveHost() like every other
//     Ollama caller; the package-wide URL guard proves no other address can
//     exist. Cloud endpoints are permanently out.
//   - This module, not src/actions/, is where prompts carry text. The action
//     layer's always-empty-prompt property is untouched and still tested.
//   - Storage is written only through src/storage's validated appends: the
//     conversation gets the prose, the measurements log gets counters and
//     NEVER prose — enforced by the log's closed schema, not by care.
//   - Honest partials: a stopped or broken stream still records what was
//     truly observed (wall time, maybe a first-token time), with the
//     runtime-reported counters null — unknown is not zero.
//
// TTFT FOLLOWS THE BENCH PROTOCOL'S DISCIPLINE, chat-shaped: a reasoning
// model streams into message.thinking while message.content stays empty, so
// "first streamed token" counts EITHER channel, and "first visible token"
// counts content only. The two can differ by orders of magnitude and answer
// different questions; both are recorded.

import { performance } from "node:perf_hooks";

/** A streamed chat chunk carries a token when either channel has text. */
export function chunkHasToken(chunk) {
  const message = chunk?.message;
  return (
    (typeof message?.content === "string" && message.content.length > 0) ||
    (typeof message?.thinking === "string" && message.thinking.length > 0)
  );
}

/** Content only — what a user actually sees appear. */
export function chunkHasVisibleToken(chunk) {
  const message = chunk?.message;
  return typeof message?.content === "string" && message.content.length > 0;
}

/**
 * Rebuild the Ollama messages array from stored conversation events. PURE.
 * Thinking text is deliberately NOT replayed into context: it was the model's
 * scratch space for one reply, Ollama's own CLI does not resend it, and
 * replaying it would grow context with text the user never composed.
 */
export function messagesFromEvents(events) {
  const messages = [];
  for (const event of events ?? []) {
    if (event.type === "user") messages.push({ role: "user", content: event.text });
    else if (event.type === "assistant") messages.push({ role: "assistant", content: event.text });
  }
  return messages;
}

/**
 * Shape one measurement record from what a relay pass observed. PURE, so the
 * record construction is testable without a stream. Counters come from the
 * final done-chunk when one arrived; observed times come from the relay's own
 * clock; absences stay null.
 */
export function buildGenerationRecord({
  schemaVersion,
  recordedAt,
  conversationId,
  modelName,
  modelDigest = null,
  runtimeVersion = null,
  finalChunk = null,
  elapsedMs = null,
  timeToFirstTokenMs = null,
  timeToFirstVisibleTokenMs = null,
  residency = null,
  environmentHash = null,
}) {
  const reported = (field) => {
    const value = finalChunk?.[field];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };
  return {
    measurementSchemaVersion: schemaVersion,
    recordedAt,
    source: "chat-generation",
    conversationId,
    model: { name: modelName, digest: modelDigest },
    runtime: { name: "ollama", version: runtimeVersion },
    reported: {
      promptEvalCount: reported("prompt_eval_count"),
      promptEvalDurationNs: reported("prompt_eval_duration"),
      evalCount: reported("eval_count"),
      evalDurationNs: reported("eval_duration"),
      loadDurationNs: reported("load_duration"),
      totalDurationNs: reported("total_duration"),
    },
    observed: { elapsedMs, timeToFirstTokenMs, timeToFirstVisibleTokenMs },
    residencyAfter: residency,
    environmentHash,
  };
}

/**
 * Run one generation against Ollama, streaming chunks to `onChunk` and
 * returning everything the caller needs to persist and to render the strip.
 *
 * @param {object} options
 * @param {string} options.host      Resolved loopback Ollama endpoint.
 * @param {string} options.model     Installed model name (caller-verified).
 * @param {Array}  options.messages  Ollama-format message history.
 * @param {(chunk: object) => void} options.onChunk Called per parsed chunk.
 * @param {AbortSignal} [options.signal] Aborting stops the upstream request;
 *   Ollama halts generation on disconnect.
 */
export async function streamGeneration({ host, model, messages, onChunk, signal }) {
  const dispatchAt = performance.now();
  let firstTokenAt = null;
  let firstVisibleTokenAt = null;
  let finalChunk = null;
  let content = "";
  let thinking = "";
  let failure = null;
  let stopped = false;

  try {
    const res = await fetch(`${host}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, messages, stream: true }),
      signal,
    });
    if (!res.ok) {
      failure = `Ollama refused: HTTP ${res.status}`;
    } else {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
          if (line.trim().length === 0) continue;
          let chunk;
          try {
            chunk = JSON.parse(line);
          } catch {
            failure = "Ollama stream returned invalid NDJSON";
            break;
          }
          if (firstTokenAt === null && chunkHasToken(chunk)) firstTokenAt = performance.now();
          if (firstVisibleTokenAt === null && chunkHasVisibleToken(chunk)) firstVisibleTokenAt = performance.now();
          if (typeof chunk?.message?.content === "string") content += chunk.message.content;
          if (typeof chunk?.message?.thinking === "string") thinking += chunk.message.thinking;
          if (chunk.done === true) finalChunk = chunk;
          onChunk(chunk);
        }
        if (failure) break;
      }
    }
  } catch (err) {
    if (err?.name === "AbortError") stopped = true;
    else failure = "the generation did not complete";
  }
  const elapsedMs = performance.now() - dispatchAt;

  return {
    // The prose, for the conversation file.
    content,
    thinking: thinking.length > 0 ? thinking : null,
    stopped,
    // Generic on purpose where it crosses to a client — an upstream error
    // string can carry paths; the specific cause goes to stderr by the caller.
    failure,
    // The numbers, for the measurement record. Null when never observed.
    finalChunk,
    elapsedMs,
    timeToFirstTokenMs: firstTokenAt === null ? null : firstTokenAt - dispatchAt,
    timeToFirstVisibleTokenMs: firstVisibleTokenAt === null ? null : firstVisibleTokenAt - dispatchAt,
  };
}

/** Residency snapshot after a stream closes — the same /api/ps pair everything else trusts. */
export async function residencyAfter(host, model) {
  try {
    const res = await fetch(`${host}/api/ps`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const body = await res.json();
    const entry = (body.models ?? []).find((m) => m.name === model);
    if (!entry || typeof entry.size !== "number" || entry.size <= 0) return null;
    return { sizeBytes: entry.size, sizeVramBytes: typeof entry.size_vram === "number" ? entry.size_vram : 0 };
  } catch {
    return null;
  }
}
