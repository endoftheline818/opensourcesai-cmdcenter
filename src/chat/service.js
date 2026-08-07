// Chat orchestration: one send, from validated request to persisted exchange.
//
// ORDERING IS THE DESIGN. The user's text is persisted BEFORE the stream
// starts — a crash mid-generation must never lose what the user typed. The
// assistant's text and the measurement record are persisted after the stream
// closes, and a persistence failure is REPORTED in the final envelope rather
// than thrown into the stream: the reply already happened, and pretending it
// didn't because a disk write failed would be a lie in the other direction.
//
// WHAT THE CLIENT GETS BACK, per send: Ollama's own chunks relayed as-is,
// then one final envelope carrying the conversation id, honest stop/failure
// flags, persistence outcomes, and the measurement strip — built by
// derive/measurements.describeMeasurement, so every figure arrives as a
// value-or-reason pair and the browser renders what the server concluded,
// inventing nothing.
//
// The same validation gate as the action layer: the model must exactly match
// one Ollama reports as installed, checked against the live list before any
// request — an arbitrary string cannot reach the runtime.

import { randomBytes } from "node:crypto";
import { MEASUREMENT_SCHEMA_VERSION } from "../version.js";
import { appendMeasurement } from "../storage/measurements.js";
import {
  appendEvent,
  createConversation,
  deleteConversation,
  listConversations,
  readConversation,
} from "../storage/conversations.js";
import { readMeasurements } from "../storage/measurements.js";
import {
  compareToBaseline,
  conversationPhysics,
  describeMeasurement,
  expectationVersusObservation,
  machineBaseline,
} from "../derive/measurements.js";
import {
  buildGenerationRecord,
  messagesFromEvents,
  residencyAfter,
  streamGeneration,
} from "./ollama.js";
import { listOpenAiModels, streamOpenAiGeneration } from "./openai.js";

const MAX_USER_TEXT = 262_144; // matches the conversation store's event bound

async function installedModels(host) {
  const res = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error("could not list installed models");
  const body = await res.json();
  return body.models ?? [];
}

/**
 * @param {object} deps
 * @param {string} deps.host           Resolved loopback Ollama endpoint.
 * @param {string} deps.dataDir        Opened storage directory (openStore ran).
 * @param {() => {memoryBandwidthGBps: number|null, bandwidthSource: string|null}} [deps.bandwidth]
 *   Live ceiling-with-provenance thunk (see the parameter comment below).
 * @param {Map<string, number>} deps.weightsByModel name → on-disk bytes, from
 *   the bootstrap capture. A model installed after startup is simply absent —
 *   its utilization renders unavailable, which is the honest answer.
 * @param {string|null} deps.runtimeVersion
 * @param {string|null} deps.environmentHash
 * @param {() => string} deps.now       Injected clock (ISO), serve-layer style.
 * @param {() => string} [deps.newId]   Injected id source, for deterministic tests.
 */
export function createChatService({
  host,
  // Loopback endpoint of an OpenAI-compatible server (llama.cpp), built by the
  // CLI from a PORT — null when none was declared, and every openai-compat
  // send is then refused with the reason rather than probed hopefully.
  openAiHost = null,
  dataDir,
  // The ceiling as a LIVE thunk with its provenance: a manual figure entered
  // mid-session reaches the next reply's strip, and the strip can label a
  // manual ceiling as manual — the number never travels without its source.
  bandwidth = () => ({ memoryBandwidthGBps: null, bandwidthSource: null }),
  weightsByModel = new Map(),
  // name → fit grade from the SAME engine as the website's checker, resolved
  // once at startup. Null/absent for uncatalogued models — their expectation
  // panel honestly reads "nothing was predicted".
  gradeByModel = new Map(),
  runtimeVersion = null,
  environmentHash = null,
  now,
  newId = () => randomBytes(12).toString("hex"),
}) {
  // This conversation's records, in append order — the same order as its
  // assistant replies. One read serves both the physics trend and history.
  async function conversationRecords(id) {
    const all = await readMeasurements(dataDir);
    return all.records.filter((r) => r.conversationId === id);
  }
  async function send(
    { conversationId = null, runtime = "ollama", model, text, numCtx = null, systemPrompt = null },
    { writeLine, onUpstreamAbort },
  ) {
    // --- validation, before anything is written or requested -----------------
    if (typeof text !== "string" || text.trim().length === 0) {
      writeLine({ done: true, refused: "no message text given" });
      return;
    }
    if (text.length > MAX_USER_TEXT) {
      writeLine({ done: true, refused: "message is too long" });
      return;
    }
    // The first settable parameter, bounded exactly as the schema stores it —
    // a value that cannot be recorded must not reach a runtime either.
    if (numCtx !== null && !(Number.isInteger(numCtx) && numCtx >= 128 && numCtx <= 1_048_576)) {
      writeLine({ done: true, refused: "context size must be a whole number of tokens between 128 and 1048576" });
      return;
    }
    // The runtime is a closed choice, same as the measurement schema's enum:
    // an unknown runtime is an unknown meaning for every counter downstream.
    if (runtime !== "ollama" && runtime !== "openai-compat") {
      writeLine({ done: true, refused: "unknown runtime" });
      return;
    }
    if (runtime === "openai-compat" && openAiHost === null) {
      writeLine({ done: true, refused: "no OpenAI-compatible runtime is configured — start with --llamacpp-port" });
      return;
    }
    // The OpenAI-compatible protocol has no per-request context control —
    // llama.cpp sets its window at server launch (-c). Refusing is the honest
    // answer; silently dropping the request would run under conditions the
    // user did not ask for and record none of it.
    if (runtime === "openai-compat" && numCtx !== null) {
      writeLine({ done: true, refused: "this runtime sets its context window at server launch — per-request context size is an Ollama control" });
      return;
    }

    // The same gate for both runtimes: the model must exactly match one the
    // runtime itself reports as served, checked live — an arbitrary string
    // cannot reach either engine.
    let digest = null;
    if (runtime === "ollama") {
      let installed;
      try {
        installed = await installedModels(host);
      } catch {
        writeLine({ done: true, refused: "Ollama is not reachable" });
        return;
      }
      if (typeof model !== "string" || !installed.some((m) => m.name === model)) {
        writeLine({ done: true, refused: "that model is not installed on this machine" });
        return;
      }
      digest = installed.find((m) => m.name === model)?.digest?.slice(0, 64) ?? null;
    } else {
      const served = await listOpenAiModels(openAiHost);
      if (!served.available) {
        writeLine({ done: true, refused: "the OpenAI-compatible runtime is not reachable" });
        return;
      }
      if (typeof model !== "string" || !served.models.includes(model)) {
        writeLine({ done: true, refused: "that model is not served by the local runtime" });
        return;
      }
    }

    // --- conversation resolution, and the user's text persisted FIRST -------
    // A system prompt is set when a conversation STARTS and never after: the
    // replies already made were shaped by whatever prompt stood when they
    // happened, and swapping it mid-conversation would silently reinterpret
    // them. Continuations use the stored one.
    let id = conversationId;
    let priorEvents = [];
    let activeSystemPrompt = null;
    if (id === null) {
      if (systemPrompt !== null && (typeof systemPrompt !== "string" || systemPrompt.trim().length === 0 || systemPrompt.length > MAX_USER_TEXT)) {
        writeLine({ done: true, refused: "the system prompt must be non-empty bounded text" });
        return;
      }
      id = newId();
      const created = await createConversation(dataDir, { id, createdAt: now(), model, systemPrompt });
      if (!created.ok) {
        writeLine({ done: true, refused: `could not start a conversation: ${created.reason}` });
        return;
      }
      activeSystemPrompt = systemPrompt;
    } else {
      if (systemPrompt !== null) {
        writeLine({ done: true, refused: "a system prompt is set when a conversation starts, not changed mid-way" });
        return;
      }
      const read = await readConversation(dataDir, id);
      if (!read.ok) {
        writeLine({ done: true, refused: read.reason });
        return;
      }
      priorEvents = read.events;
      activeSystemPrompt = read.header.systemPrompt;
    }
    const userAppend = await appendEvent(dataDir, id, { type: "user", at: now(), text });
    if (!userAppend.ok) {
      writeLine({ done: true, refused: `could not record the message: ${userAppend.reason}` });
      return;
    }

    // --- the generation, relayed and measured --------------------------------
    const controller = new AbortController();
    onUpstreamAbort(() => controller.abort());
    // The same message shape works for both runtimes' protocols.
    const messages = [
      ...(activeSystemPrompt === null ? [] : [{ role: "system", content: activeSystemPrompt }]),
      ...messagesFromEvents(priorEvents),
      { role: "user", content: text },
    ];

    const result =
      runtime === "ollama"
        ? await streamGeneration({
            host,
            model,
            messages,
            numCtx,
            signal: controller.signal,
            onChunk: (chunk) => writeLine(chunk),
          })
        : await streamOpenAiGeneration({
            host: openAiHost,
            model,
            messages,
            signal: controller.signal,
            onChunk: (chunk) => writeLine(chunk),
          });

    // Outside the measured interval, and outside the failure path's way.
    // Ollama only: the OpenAI-compatible protocol has no /api/ps, so residency
    // after a reply is honestly unknowable there — null, and the expectation
    // panel answers "unknown" rather than pretending a probe existed.
    const residency = runtime === "ollama" ? await residencyAfter(host, model) : null;

    // --- persistence, honestly reported --------------------------------------
    const assistantAppend = await appendEvent(dataDir, id, {
      type: "assistant",
      at: now(),
      text: result.content,
      thinking: result.thinking,
      model,
      stopped: result.stopped || result.failure !== null,
    });

    // The standing best BEFORE this reply joins the history, so a new best is
    // detected against what stood when the reply began — gated by environment
    // hash, because a best set under different run conditions is not this
    // configuration's best.
    const priorAll = await readMeasurements(dataDir);
    const priorBaseline = machineBaseline(priorAll.records, { model, environmentHash, runtime });

    const record = buildGenerationRecord({
      schemaVersion: MEASUREMENT_SCHEMA_VERSION,
      recordedAt: now(),
      conversationId: id,
      modelName: model,
      modelDigest: digest,
      runtimeName: runtime,
      // The resolved version is OLLAMA's; the OpenAI-compatible protocol does
      // not report one, and null is the honest entry, not a borrowed string.
      runtimeVersion: runtime === "ollama" ? runtimeVersion : null,
      finalChunk: result.finalChunk,
      elapsedMs: result.elapsedMs,
      timeToFirstTokenMs: result.timeToFirstTokenMs,
      timeToFirstVisibleTokenMs: result.timeToFirstVisibleTokenMs,
      requestedNumCtx: numCtx,
      residency,
      environmentHash,
    });
    const measurementAppend = await appendMeasurement(dataDir, record);

    writeLine({
      done: true,
      conversationId: id,
      stopped: result.stopped,
      failure: result.failure,
      conversationPersisted: assistantAppend.ok,
      measurementRecorded: measurementAppend.ok,
      strip: describeMeasurement(record, {
        ...bandwidth(),
        weightsBytes: weightsByModel.get(model) ?? null,
      }),
      // What the engine predicted for this model, beside what just happened —
      // and the conversation's slowdown trend, spill distinguished from
      // physics. Both computed here, in the same pure code the tests pin.
      expectation: expectationVersusObservation(gradeByModel.get(model) ?? null, record),
      physics: conversationPhysics(await conversationRecords(id)),
      baseline: compareToBaseline(record, priorBaseline),
    });
  }

  return {
    send,
    list: () => listConversations(dataDir),
    // What the second runtime serves, for the model picker. Three honest
    // states: not configured (no --llamacpp-port), configured but unreachable
    // (with the reason), or the served list. Ollama's models arrive via the
    // dashboard payload as they always have — this route reports only what
    // the dashboard cannot know.
    async models() {
      if (openAiHost === null) {
        return { ok: true, openaiCompat: { configured: false, available: false, models: [] } };
      }
      const served = await listOpenAiModels(openAiHost);
      return {
        ok: true,
        openaiCompat: {
          configured: true,
          available: served.available,
          reason: served.available ? null : served.reason,
          models: served.models,
        },
      };
    },
    async history(id) {
      const read = await readConversation(dataDir, id);
      if (!read.ok) return { ok: false, status: 400, reason: read.reason };
      // The strip data for past exchanges: this conversation's records, in
      // append order — the same order as its assistant messages — plus the
      // per-record expectation verdicts and the conversation-level trend.
      const records = await conversationRecords(id);
      const ceiling = bandwidth();
      const strips = records.map((r) => describeMeasurement(r, {
        ...ceiling,
        weightsBytes: weightsByModel.get(r.model?.name) ?? null,
      }));
      const expectations = records.map((r) =>
        expectationVersusObservation(gradeByModel.get(r.model?.name) ?? null, r),
      );
      return {
        ok: true,
        header: read.header,
        events: read.events,
        strips,
        expectations,
        physics: conversationPhysics(records),
        tornTail: read.tornTail,
      };
    },
    async remove(id) {
      const result = await deleteConversation(dataDir, id);
      return result.ok ? { ok: true } : { ok: false, status: 400, reason: result.reason };
    },
    /**
     * Search the user's own conversations. Case-insensitive plain substring —
     * no regex, so a query is only ever text. POST-as-transport like history:
     * the query and the snippets are prose, and prose does not ride URLs.
     * Thinking text is deliberately NOT searched — it was the model's scratch
     * space for one reply, not part of the conversation the user had.
     */
    async search(query) {
      if (typeof query !== "string" || query.trim().length === 0) {
        return { ok: false, status: 400, reason: "no search text given" };
      }
      if (query.length > 256) {
        return { ok: false, status: 400, reason: "search text is too long" };
      }
      const needle = query.toLowerCase();
      const MAX_MATCHES = 50;
      const snippetOf = (text, at) => {
        const start = Math.max(0, at - 60);
        const end = Math.min(text.length, at + needle.length + 60);
        return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
      };

      const list = await listConversations(dataDir);
      if (!list.ok) return { ok: false, status: 400, reason: list.reason };

      const results = [];
      let matchCount = 0;
      for (const convo of list.conversations) {
        if (matchCount >= MAX_MATCHES) break;
        if (convo.unreadable) continue;
        const read = await readConversation(dataDir, convo.id);
        if (!read.ok) continue;

        const matches = [];
        if (read.header.systemPrompt) {
          const at = read.header.systemPrompt.toLowerCase().indexOf(needle);
          if (at !== -1 && matchCount < MAX_MATCHES) {
            matches.push({ where: "system", snippet: snippetOf(read.header.systemPrompt, at) });
            matchCount += 1;
          }
        }
        read.events.forEach((event, index) => {
          if (matchCount >= MAX_MATCHES) return;
          const at = (event.text ?? "").toLowerCase().indexOf(needle);
          if (at !== -1) {
            matches.push({ where: event.type, eventIndex: index, snippet: snippetOf(event.text, at) });
            matchCount += 1;
          }
        });
        if (matches.length > 0) {
          results.push({ id: convo.id, model: convo.model, lastAt: convo.lastAt, matches });
        }
      }
      // The cap is honest: a truncated search says so instead of presenting
      // fifty matches as everything there was.
      return { ok: true, results, truncated: matchCount >= MAX_MATCHES };
    },
  };
}
