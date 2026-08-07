// The second local runtime: anything speaking the OpenAI-compatible
// /v1/chat/completions protocol on loopback — llama.cpp's server first among
// them. Same shape as the Ollama adapter, different wire format, and the
// differences are treated with the package's UNAVAILABLE-FIELD DISCIPLINE:
// what this protocol does not report stays null with its honest reason,
// never estimated. llama.cpp's server reports a `timings` block
// (prompt_n/prompt_ms, predicted_n/predicted_ms) on its final chunk — mapped
// to the same counter fields Ollama's nanosecond durations fill. It reports
// NO load duration and NO total duration (their strip lines read "not
// reported by the runtime"), and it has no /api/ps — residency after a reply
// is unknowable here, so the expectation panel honestly answers "unknown"
// for this runtime rather than pretending a probe existed.
//
// LOOPBACK BY CONSTRUCTION. The endpoint is built from a PORT, never a host:
// the CLI accepts --llamacpp-port and nothing else, exactly as the dashboard
// bind address works — there is no address to mistype, no way to point this
// at another machine, and the package-wide URL guard holds because no URL
// literal exists here at all.
//
// Reasoning models on this protocol stream their scratch space as
// `reasoning_content` deltas beside `content` — the same two-channel finding
// the bench protocol made for Ollama, arriving under a different field name.
// Both TTFTs are measured here too.

import { performance } from "node:perf_hooks";

/** One SSE delta carries a token when either channel has text. PURE. */
export function deltaHasToken(delta) {
  return (
    (typeof delta?.content === "string" && delta.content.length > 0) ||
    (typeof delta?.reasoning_content === "string" && delta.reasoning_content.length > 0)
  );
}

/** Content only — what a user actually sees appear. PURE. */
export function deltaHasVisibleToken(delta) {
  return typeof delta?.content === "string" && delta.content.length > 0;
}

/**
 * Parse one SSE frame's data payload. Returns null for [DONE] and for
 * unparseable frames (counted by the caller). PURE.
 */
export function parseSseData(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return { kind: "not-data" };
  const payload = trimmed.slice("data:".length).trim();
  if (payload === "[DONE]") return { kind: "done" };
  try {
    return { kind: "chunk", chunk: JSON.parse(payload) };
  } catch {
    return { kind: "invalid" };
  }
}

/**
 * Map llama.cpp's timings block to the shared counter fields. PURE, and
 * deliberately partial: load and total durations do not exist on this
 * protocol and stay null — the discipline, applied at the exact seam where
 * inventing them would be easiest.
 */
export function countersFromTimings(timings) {
  const ms = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v * 1e6) : null);
  const count = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
  return {
    prompt_eval_count: count(timings?.prompt_n),
    prompt_eval_duration: ms(timings?.prompt_ms),
    eval_count: count(timings?.predicted_n),
    eval_duration: ms(timings?.predicted_ms),
    load_duration: null,
    total_duration: null,
  };
}

/** Models this endpoint serves — /v1/models, ids only. */
export async function listOpenAiModels(host) {
  try {
    const res = await fetch(`${host}/v1/models`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return { available: false, reason: `http ${res.status}`, models: [] };
    const body = await res.json();
    return {
      available: true,
      models: (body.data ?? []).map((m) => m.id).filter((id) => typeof id === "string"),
    };
  } catch (err) {
    return { available: false, reason: String(err.message).slice(0, 120), models: [] };
  }
}

/**
 * Run one generation against an OpenAI-compatible server, streaming parsed
 * chunks to `onChunk` in the OLLAMA chunk shape — the relay downstream of
 * here neither knows nor cares which protocol produced a token.
 */
export async function streamOpenAiGeneration({ host, model, messages, onChunk, signal }) {
  const dispatchAt = performance.now();
  let firstTokenAt = null;
  let firstVisibleTokenAt = null;
  let finalChunk = null;
  let content = "";
  let thinking = "";
  let failure = null;
  let stopped = false;

  try {
    const res = await fetch(`${host}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, messages, stream: true }),
      signal,
    });
    if (!res.ok) {
      failure = `the runtime refused: HTTP ${res.status}`;
    } else {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let lastTimings = null;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
          const parsed = parseSseData(line);
          if (parsed.kind !== "chunk") continue;
          const chunk = parsed.chunk;
          const delta = chunk?.choices?.[0]?.delta ?? {};
          if (firstTokenAt === null && deltaHasToken(delta)) firstTokenAt = performance.now();
          if (firstVisibleTokenAt === null && deltaHasVisibleToken(delta)) firstVisibleTokenAt = performance.now();
          if (typeof delta.content === "string") content += delta.content;
          if (typeof delta.reasoning_content === "string") thinking += delta.reasoning_content;
          if (chunk.timings) lastTimings = chunk.timings;
          // Relay in the Ollama chunk shape the browser already renders.
          onChunk({ message: { role: "assistant", content: delta.content ?? "", thinking: delta.reasoning_content ?? undefined }, done: false });
        }
      }
      if (lastTimings) finalChunk = { done: true, ...countersFromTimings(lastTimings) };
    }
  } catch (err) {
    if (err?.name === "AbortError") stopped = true;
    else failure = "the generation did not complete";
  }
  const elapsedMs = performance.now() - dispatchAt;

  return {
    content,
    thinking: thinking.length > 0 ? thinking : null,
    stopped,
    failure,
    finalChunk,
    elapsedMs,
    timeToFirstTokenMs: firstTokenAt === null ? null : firstTokenAt - dispatchAt,
    timeToFirstVisibleTokenMs: firstVisibleTokenAt === null ? null : firstVisibleTokenAt - dispatchAt,
  };
}
