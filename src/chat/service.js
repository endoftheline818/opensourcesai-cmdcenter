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
 * @param {number|null} deps.memoryBandwidthGBps Resolved ceiling input, or null.
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
  dataDir,
  memoryBandwidthGBps = null,
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
  async function send({ conversationId = null, model, text }, { writeLine, onUpstreamAbort }) {
    // --- validation, before anything is written or requested -----------------
    if (typeof text !== "string" || text.trim().length === 0) {
      writeLine({ done: true, refused: "no message text given" });
      return;
    }
    if (text.length > MAX_USER_TEXT) {
      writeLine({ done: true, refused: "message is too long" });
      return;
    }
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

    // --- conversation resolution, and the user's text persisted FIRST -------
    let id = conversationId;
    let priorEvents = [];
    if (id === null) {
      id = newId();
      const created = await createConversation(dataDir, { id, createdAt: now(), model });
      if (!created.ok) {
        writeLine({ done: true, refused: `could not start a conversation: ${created.reason}` });
        return;
      }
    } else {
      const read = await readConversation(dataDir, id);
      if (!read.ok) {
        writeLine({ done: true, refused: read.reason });
        return;
      }
      priorEvents = read.events;
    }
    const userAppend = await appendEvent(dataDir, id, { type: "user", at: now(), text });
    if (!userAppend.ok) {
      writeLine({ done: true, refused: `could not record the message: ${userAppend.reason}` });
      return;
    }

    // --- the generation, relayed and measured --------------------------------
    const controller = new AbortController();
    onUpstreamAbort(() => controller.abort());
    const messages = [...messagesFromEvents(priorEvents), { role: "user", content: text }];

    const result = await streamGeneration({
      host,
      model,
      messages,
      signal: controller.signal,
      onChunk: (chunk) => writeLine(chunk),
    });

    // Outside the measured interval, and outside the failure path's way.
    const residency = await residencyAfter(host, model);

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
    const priorBaseline = machineBaseline(priorAll.records, { model, environmentHash });

    const record = buildGenerationRecord({
      schemaVersion: MEASUREMENT_SCHEMA_VERSION,
      recordedAt: now(),
      conversationId: id,
      modelName: model,
      modelDigest: installed.find((m) => m.name === model)?.digest?.slice(0, 64) ?? null,
      runtimeVersion,
      finalChunk: result.finalChunk,
      elapsedMs: result.elapsedMs,
      timeToFirstTokenMs: result.timeToFirstTokenMs,
      timeToFirstVisibleTokenMs: result.timeToFirstVisibleTokenMs,
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
        memoryBandwidthGBps,
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
    async history(id) {
      const read = await readConversation(dataDir, id);
      if (!read.ok) return { ok: false, status: 400, reason: read.reason };
      // The strip data for past exchanges: this conversation's records, in
      // append order — the same order as its assistant messages — plus the
      // per-record expectation verdicts and the conversation-level trend.
      const records = await conversationRecords(id);
      const strips = records.map((r) => describeMeasurement(r, {
        memoryBandwidthGBps,
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
  };
}
