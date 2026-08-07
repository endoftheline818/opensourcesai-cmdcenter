import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fsp from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  buildGenerationRecord,
  chunkHasToken,
  chunkHasVisibleToken,
  messagesFromEvents,
} from "../src/chat/ollama.js";
import {
  countersFromTimings,
  deltaHasToken,
  deltaHasVisibleToken,
  parseSseData,
} from "../src/chat/openai.js";
import { createChatService } from "../src/chat/service.js";
import { readConversation } from "../src/storage/conversations.js";
import { readMeasurements, validateMeasurement } from "../src/storage/measurements.js";
import { CHAT_PATHS, TOKEN_HEADER } from "../src/serve/security.js";
import { createServer } from "../src/serve/server.js";
import { MEASUREMENT_SCHEMA_VERSION } from "../src/version.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AT = "2026-08-08T10:00:00Z";
const TOKEN = "a".repeat(64);

// ---------------------------------------------------------------------------
// Pure parts
// ---------------------------------------------------------------------------

test("the thinking channel counts as a streamed token, content as a visible one", () => {
  // The bench protocol's finding, chat-shaped: a reasoning model streams into
  // message.thinking while content stays empty, and the two TTFTs answer
  // different questions.
  const thinkingOnly = { message: { role: "assistant", content: "", thinking: "hmm" } };
  assert.equal(chunkHasToken(thinkingOnly), true);
  assert.equal(chunkHasVisibleToken(thinkingOnly), false);

  const visible = { message: { role: "assistant", content: "Hi" } };
  assert.equal(chunkHasToken(visible), true);
  assert.equal(chunkHasVisibleToken(visible), true);

  const empty = { message: { role: "assistant", content: "" } };
  assert.equal(chunkHasToken(empty), false);
  assert.equal(chunkHasVisibleToken(empty), false);
});

test("history replay carries text but never thinking", () => {
  const messages = messagesFromEvents([
    { type: "user", at: AT, text: "question" },
    { type: "assistant", at: AT, text: "answer", thinking: "private scratch space", model: "m", stopped: false },
  ]);
  assert.deepEqual(messages, [
    { role: "user", content: "question" },
    { role: "assistant", content: "answer" },
  ]);
  assert.ok(!JSON.stringify(messages).includes("scratch"), "thinking was one reply's scratch space, not context");
});

test("a generation record built from a complete pass validates against the schema", () => {
  const record = buildGenerationRecord({
    schemaVersion: MEASUREMENT_SCHEMA_VERSION,
    recordedAt: AT,
    conversationId: "abc123def456",
    modelName: "llama3.1:8b",
    runtimeVersion: "0.32.6",
    finalChunk: {
      done: true,
      prompt_eval_count: 26, prompt_eval_duration: 120_000_000,
      eval_count: 298, eval_duration: 3_900_000_000,
      load_duration: 8_000_000, total_duration: 4_100_000_000,
    },
    elapsedMs: 4200,
    timeToFirstTokenMs: 180.5,
    timeToFirstVisibleTokenMs: 180.5,
    residency: { sizeBytes: 6_000_000_000, sizeVramBytes: 6_000_000_000 },
    environmentHash: "ab".repeat(32),
  });
  assert.deepEqual(validateMeasurement(record), { ok: true });
  assert.equal(record.reported.evalCount, 298);
});

test("a broken or stopped pass records what was observed and nulls the rest", () => {
  const record = buildGenerationRecord({
    schemaVersion: MEASUREMENT_SCHEMA_VERSION,
    recordedAt: AT,
    conversationId: "abc123def456",
    modelName: "llama3.1:8b",
    finalChunk: null, // the done-chunk never arrived
    elapsedMs: 950,
    timeToFirstTokenMs: 210,
    timeToFirstVisibleTokenMs: null,
  });
  assert.deepEqual(validateMeasurement(record), { ok: true });
  assert.equal(record.reported.evalCount, null, "unreported counters stay null, never zero");
  assert.equal(record.observed.elapsedMs, 950, "the wall time genuinely happened and is kept");
  assert.equal(record.residencyAfter, null);
});

// ---------------------------------------------------------------------------
// The stub Ollama — streams a fixed NDJSON generation like the real thing
// ---------------------------------------------------------------------------

function stubOllama({ modelName = "stub:1b", vramFraction = 1 } = {}) {
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/api/tags") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ models: [{ name: modelName, size: 1_000_000_000, digest: "ff".repeat(16) }] }));
      return;
    }
    if (req.method === "GET" && req.url === "/api/ps") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        models: [{ name: modelName, size: 1_200_000_000, size_vram: Math.round(1_200_000_000 * vramFraction) }],
      }));
      return;
    }
    if (req.method === "POST" && req.url === "/api/chat") {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        server.lastChatBody = JSON.parse(body);
        res.writeHead(200, { "content-type": "application/x-ndjson" });
        const line = (o) => res.write(`${JSON.stringify(o)}\n`);
        line({ model: modelName, message: { role: "assistant", content: "", thinking: "let me think" }, done: false });
        line({ model: modelName, message: { role: "assistant", content: "Hello " }, done: false });
        line({ model: modelName, message: { role: "assistant", content: "there." }, done: false });
        line({
          model: modelName, message: { role: "assistant", content: "" }, done: true,
          prompt_eval_count: 26, prompt_eval_duration: 120_000_000,
          eval_count: 4, eval_duration: 40_000_000,
          load_duration: 8_000_000, total_duration: 200_000_000,
        });
        res.end();
      });
      return;
    }
    res.writeHead(404); res.end();
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, host: `http://127.0.0.1:${server.address().port}` }));
  });
}

async function withTmpDir(fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "osai-chat-test-"));
  try {
    return await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// The service, end to end against the stub
// ---------------------------------------------------------------------------

test("one send: user text persisted first, chunks relayed, exchange and record stored", async () => {
  const { server, host } = await stubOllama();
  try {
    await withTmpDir(async (dir) => {
      let tick = 0;
      const chat = createChatService({
        host, dataDir: dir,
        bandwidth: () => ({ memoryBandwidthGBps: 504, bandwidthSource: "manufacturer-table" }),
        weightsByModel: new Map([["stub:1b", 1_000_000_000]]),
        gradeByModel: new Map([["stub:1b", { fit: "comfortable", quant: "q4_k_m", requiredVramGb: 2.5, sparseMoe: false }]]),
        runtimeVersion: "0.32.6", environmentHash: "cd".repeat(32),
        now: () => `2026-08-08T10:00:0${tick++}Z`,
        newId: () => "deadbeef0001",
      });

      const lines = [];
      await chat.send(
        { conversationId: null, model: "stub:1b", text: "say hello" },
        { writeLine: (l) => lines.push(l), onUpstreamAbort: () => {} },
      );

      const final = lines[lines.length - 1];
      assert.equal(final.done, true);
      assert.equal(final.conversationId, "deadbeef0001");
      assert.equal(final.failure, null);
      assert.equal(final.conversationPersisted, true);
      assert.equal(final.measurementRecorded, true);

      // The strip carries value-or-reason pairs the server derived.
      assert.equal(final.strip.generation.available, true);
      assert.equal(final.strip.generation.value, 100, "4 tokens in 40ms is 100 tok/s");
      assert.equal(final.strip.utilization.available, true);
      assert.equal(final.strip.timeToFirstTokenMs.available, true);

      // Relayed chunks arrived before the envelope, thinking channel included.
      assert.ok(lines.some((l) => l.message?.thinking === "let me think"));
      assert.ok(lines.some((l) => l.message?.content === "Hello "));

      // The conversation holds the prose...
      const read = await readConversation(dir, "deadbeef0001");
      assert.equal(read.events.length, 2);
      assert.equal(read.events[0].text, "say hello");
      assert.equal(read.events[1].text, "Hello there.");
      assert.equal(read.events[1].thinking, "let me think");
      assert.equal(read.events[1].stopped, false);

      // ...and the measurements log holds counters, linked by id, with NO prose.
      const measurements = await readMeasurements(dir);
      assert.equal(measurements.records.length, 1);
      const record = measurements.records[0];
      assert.equal(record.conversationId, "deadbeef0001");
      assert.equal(record.reported.evalCount, 4);
      assert.equal(record.residencyAfter.sizeVramBytes, 1_200_000_000);
      assert.ok(!JSON.stringify(record).includes("hello"), "no prose may reach the measurements log");

      // The expectation panel: the engine predicted a full fit, the stub
      // reports 100% resident — the promise was kept and the verdict says so.
      assert.equal(final.expectation.verdict, "agrees");
      assert.equal(final.expectation.observed.residencyPercent, 100);
      // One reply cannot make a trend, and the physics block says so.
      assert.equal(final.physics.available, false);

      // A second send continues the conversation, replaying history as context.
      const more = [];
      await chat.send(
        { conversationId: "deadbeef0001", model: "stub:1b", text: "and again" },
        { writeLine: (l) => more.push(l), onUpstreamAbort: () => {} },
      );
      assert.equal(more[more.length - 1].done, true);
      // Two measured replies make a trend; the stub's identical counters hold steady.
      const physics = more[more.length - 1].physics;
      assert.equal(physics.available, true);
      assert.equal(physics.points.length, 2);
      assert.match(physics.note, /held ~100\.0 tok\/s/);
      assert.match(physics.note, /tokens/, "cumulative context reconstructed from the counters");
      assert.deepEqual(
        server.lastChatBody.messages.map((m) => m.role),
        ["user", "assistant", "user"],
        "prior exchange replays as context",
      );
      assert.ok(!JSON.stringify(server.lastChatBody).includes("let me think"), "thinking is never replayed");
    });
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("refusals are honest and nothing is persisted for them", async () => {
  const { server, host } = await stubOllama();
  try {
    await withTmpDir(async (dir) => {
      const chat = createChatService({ host, dataDir: dir, now: () => AT, newId: () => "deadbeef0002" });

      const refusalOf = async (payload) => {
        const lines = [];
        await chat.send(payload, { writeLine: (l) => lines.push(l), onUpstreamAbort: () => {} });
        return lines[lines.length - 1].refused;
      };

      assert.match(await refusalOf({ model: "stub:1b", text: "   " }), /no message text/);
      assert.match(await refusalOf({ model: "not-installed:1b", text: "hi" }), /not installed/);
      assert.match(
        await refusalOf({ conversationId: "nosuchconvo1", model: "stub:1b", text: "hi" }),
        /no such conversation/,
      );

      const measurements = await readMeasurements(dir);
      assert.equal(measurements.exists, false, "a refused send leaves no trace");
    });
  } finally {
    await new Promise((r) => server.close(r));
  }
});

// ---------------------------------------------------------------------------
// Transport: the streaming route, auth, and the allowlist mirror
// ---------------------------------------------------------------------------

async function withChatServer(fn) {
  const { server: ollama, host } = await stubOllama();
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "osai-chat-http-"));
  let tick = 0;
  const chat = createChatService({
    host, dataDir: dir, now: () => `2026-08-08T11:00:0${tick++}Z`, newId: () => "deadbeef0003",
  });
  const { server } = createServer({
    collect: async () => ({}),
    catalog: { models: [] },
    chat,
    token: TOKEN,
    port: 0,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(base);
  } finally {
    await new Promise((r) => server.close(r));
    await new Promise((r) => ollama.close(r));
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

test("POST /api/chat/send streams NDJSON chunks then the measured envelope", async () => {
  await withChatServer(async (base) => {
    const res = await fetch(`${base}/api/chat/send`, {
      method: "POST",
      headers: { "content-type": "application/json", [TOKEN_HEADER]: TOKEN },
      body: JSON.stringify({ model: "stub:1b", text: "say hello" }),
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /x-ndjson/);

    const lines = (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
    assert.ok(lines.length >= 4, "chunks stream individually, not as one buffered blob");
    const final = lines[lines.length - 1];
    assert.equal(final.done, true);
    assert.equal(final.conversationId, "deadbeef0003");
    assert.equal(final.strip.generation.value, 100);

    // The rest of the surface: list, history with strips, delete.
    const list = await (await fetch(`${base}/api/chat/conversations`, { headers: { [TOKEN_HEADER]: TOKEN } })).json();
    assert.equal(list.conversations.length, 1);
    assert.equal(list.conversations[0].messageCount, 2);

    const history = await (await fetch(`${base}/api/chat/history`, {
      method: "POST",
      headers: { "content-type": "application/json", [TOKEN_HEADER]: TOKEN },
      body: JSON.stringify({ id: "deadbeef0003" }),
    })).json();
    assert.equal(history.ok, true);
    assert.equal(history.events.length, 2);
    assert.equal(history.strips.length, 1, "one strip per assistant reply, joined by conversation id");

    const removed = await (await fetch(`${base}/api/chat/delete`, {
      method: "POST",
      headers: { "content-type": "application/json", [TOKEN_HEADER]: TOKEN },
      body: JSON.stringify({ id: "deadbeef0003" }),
    })).json();
    assert.equal(removed.ok, true);
    const after = await (await fetch(`${base}/api/chat/conversations`, { headers: { [TOKEN_HEADER]: TOKEN } })).json();
    assert.equal(after.conversations.length, 0);
  });
});

test("chat routes require the session token, like everything that touches machine state", async () => {
  await withChatServer(async (base) => {
    for (const pathname of CHAT_PATHS) {
      const res = await fetch(`${base}${pathname}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      assert.equal(res.status, 401, `${pathname} must refuse without the token`);
    }
  });
});

test("a server configured without chat 404s the chat paths and reports the list honestly", async () => {
  const { server } = createServer({ collect: async () => ({}), catalog: { models: [] }, token: TOKEN, port: 0 });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const send = await fetch(`${base}/api/chat/send`, {
      method: "POST", headers: { "content-type": "application/json", [TOKEN_HEADER]: TOKEN }, body: "{}",
    });
    assert.equal(send.status, 404);
    const list = await (await fetch(`${base}/api/chat/conversations`, { headers: { [TOKEN_HEADER]: TOKEN } })).json();
    assert.equal(list.ok, false);
    assert.match(list.reason, /not configured/);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("the chat authorizer allowlist and the server's dispatch agree", async () => {
  const source = await readFile(path.join(root, "src", "serve", "server.js"), "utf8");
  for (const p of CHAT_PATHS) {
    assert.ok(source.includes(`"${p}"`), `${p} is authorized but not dispatched`);
  }
  const dispatched = [...source.matchAll(/"(\/api\/chat\/[a-z]+)"/g)].map((m) => m[1]);
  assert.ok(dispatched.length > 0, "expected dispatched chat routes — otherwise this guard is vacuous");
  for (const p of dispatched) {
    assert.ok(
      CHAT_PATHS.has(p) || p === "/api/chat/conversations",
      `${p} is dispatched but not authorized (conversations is GET and lives in the read-only table)`,
    );
  }
});

test("a spilled generation turns the expectation verdict against the grade", async () => {
  // The stub reports only 62% of the model resident after the reply — the
  // founding misconfiguration, reproduced end to end: the engine's promise was
  // "fits fully", and the envelope must say the machine broke it.
  const { server, host } = await stubOllama({ vramFraction: 0.62 });
  try {
    await withTmpDir(async (dir) => {
      const chat = createChatService({
        host, dataDir: dir,
        gradeByModel: new Map([["stub:1b", { fit: "comfortable", quant: "q4_k_m", requiredVramGb: 2.5, sparseMoe: false }]]),
        now: () => AT, newId: () => "deadbeef0009",
      });
      const lines = [];
      await chat.send(
        { conversationId: null, model: "stub:1b", text: "hello" },
        { writeLine: (l) => lines.push(l), onUpstreamAbort: () => {} },
      );
      const final = lines[lines.length - 1];
      assert.equal(final.expectation.verdict, "disagrees");
      assert.equal(final.expectation.observed.residencyPercent, 62);
      assert.match(final.expectation.note, /62% resident/);
      assert.match(final.expectation.note, /holding VRAM|constraining/);
    });
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("history carries expectations and physics alongside the strips", async () => {
  const { server, host } = await stubOllama();
  try {
    await withTmpDir(async (dir) => {
      let tick = 0;
      const chat = createChatService({
        host, dataDir: dir,
        gradeByModel: new Map([["stub:1b", { fit: "comfortable", quant: "q4_k_m", requiredVramGb: 2.5, sparseMoe: false }]]),
        now: () => `2026-08-08T12:00:0${tick++}Z`, newId: () => "deadbeef000a",
      });
      const sink = { writeLine: () => {}, onUpstreamAbort: () => {} };
      await chat.send({ conversationId: null, model: "stub:1b", text: "one" }, sink);
      await chat.send({ conversationId: "deadbeef000a", model: "stub:1b", text: "two" }, sink);

      const history = await chat.history("deadbeef000a");
      assert.equal(history.ok, true);
      assert.equal(history.expectations.length, 2, "one verdict per reply");
      assert.equal(history.expectations[0].verdict, "agrees");
      assert.equal(history.physics.available, true);
      assert.equal(history.physics.points.length, 2);
    });
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("the send envelope carries the environment-gated baseline verdict", async () => {
  const { server, host } = await stubOllama();
  try {
    await withTmpDir(async (dir) => {
      let tick = 0;
      const chat = createChatService({
        host, dataDir: dir, environmentHash: "ee".repeat(32),
        now: () => `2026-08-09T10:00:0${tick++}Z`, newId: () => "deadbeef000b",
      });
      const sink = (lines) => ({ writeLine: (l) => lines.push(l), onUpstreamAbort: () => {} });

      const first = [];
      await chat.send({ conversationId: null, model: "stub:1b", text: "one" }, sink(first));
      assert.equal(first[first.length - 1].baseline.isFirst, true, "nothing to compare on the first reply");

      const second = [];
      await chat.send({ conversationId: "deadbeef000b", model: "stub:1b", text: "two" }, sink(second));
      const verdict = second[second.length - 1].baseline;
      assert.equal(verdict.isFirst, false);
      // The stub's counters are identical every time (100 tok/s), so the
      // second reply ties the standing best rather than beating it.
      assert.equal(verdict.isNewBest, false);
      assert.match(verdict.note, /best on this machine: 100\.0 tok\/s over 1 comparable reply/);
    });
  } finally {
    await new Promise((r) => server.close(r));
  }
});

// ---------------------------------------------------------------------------
// The second runtime: OpenAI-compatible protocol (llama.cpp server)
// ---------------------------------------------------------------------------

test("SSE parsing: data frames, [DONE], and garbage each land in their own bucket", () => {
  assert.equal(parseSseData('data: {"choices":[]}').kind, "chunk");
  assert.equal(parseSseData("data: [DONE]").kind, "done");
  assert.equal(parseSseData("data: {broken").kind, "invalid");
  assert.equal(parseSseData(": keep-alive comment").kind, "not-data");
  assert.equal(parseSseData("").kind, "not-data");
});

test("reasoning_content counts as a streamed token, content as a visible one", () => {
  // The same two-channel finding as Ollama's thinking field, under this
  // protocol's name for it.
  const reasoningOnly = { reasoning_content: "hmm" };
  assert.equal(deltaHasToken(reasoningOnly), true);
  assert.equal(deltaHasVisibleToken(reasoningOnly), false);
  const visible = { content: "Hi" };
  assert.equal(deltaHasToken(visible), true);
  assert.equal(deltaHasVisibleToken(visible), true);
});

test("timings map to the shared counters; load and total stay null — this protocol does not report them", () => {
  const counters = countersFromTimings({ prompt_n: 26, prompt_ms: 120, predicted_n: 4, predicted_ms: 40 });
  assert.equal(counters.prompt_eval_count, 26);
  assert.equal(counters.prompt_eval_duration, 120_000_000, "milliseconds become the schema's nanoseconds");
  assert.equal(counters.eval_count, 4);
  assert.equal(counters.eval_duration, 40_000_000);
  assert.equal(counters.load_duration, null, "not reported by this protocol — null, never estimated");
  assert.equal(counters.total_duration, null);

  const partial = countersFromTimings({ predicted_n: 4 });
  assert.equal(partial.eval_count, 4);
  assert.equal(partial.prompt_eval_count, null, "absent fields stay null field by field");
  assert.equal(countersFromTimings(undefined).eval_count, null);
});

// Streams a fixed SSE generation the way llama.cpp's server does: delta
// chunks, a final chunk carrying `timings`, then [DONE].
function stubOpenAi({ modelName = "stub-gguf" } = {}) {
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/v1/models") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: [{ id: modelName, object: "model" }] }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        server.lastChatBody = JSON.parse(body);
        res.writeHead(200, { "content-type": "text/event-stream" });
        const frame = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
        frame({ choices: [{ delta: { reasoning_content: "let me think" } }] });
        frame({ choices: [{ delta: { content: "Hello " } }] });
        frame({
          choices: [{ delta: { content: "there." }, finish_reason: "stop" }],
          timings: { prompt_n: 26, prompt_ms: 120, predicted_n: 4, predicted_ms: 40 },
        });
        res.write("data: [DONE]\n\n");
        res.end();
      });
      return;
    }
    res.writeHead(404); res.end();
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, host: `http://127.0.0.1:${server.address().port}` }));
  });
}

test("an openai-compat send records v2 counters with honest nulls where the protocol is silent", async () => {
  const { server, host } = await stubOpenAi();
  try {
    await withTmpDir(async (dir) => {
      let tick = 0;
      const chat = createChatService({
        host: "http://127.0.0.1:1", // Ollama deliberately unreachable: it must not be consulted
        openAiHost: host,
        dataDir: dir,
        runtimeVersion: "0.32.6", // Ollama's version — must NOT leak onto this runtime's records
        environmentHash: "ee".repeat(32),
        now: () => `2026-08-09T11:00:0${tick++}Z`, newId: () => "deadbeef000c",
      });

      const lines = [];
      await chat.send(
        { conversationId: null, runtime: "openai-compat", model: "stub-gguf", text: "say hello" },
        { writeLine: (l) => lines.push(l), onUpstreamAbort: () => {} },
      );

      const final = lines[lines.length - 1];
      assert.equal(final.done, true);
      assert.equal(final.failure, null);
      assert.equal(final.measurementRecorded, true);
      assert.equal(final.strip.generation.available, true);
      assert.equal(final.strip.generation.value, 100, "4 tokens in 40ms of timings is 100 tok/s");

      // Chunks were relayed in the Ollama shape the browser renders, with the
      // reasoning channel mapped to thinking.
      assert.ok(lines.some((l) => l.message?.thinking === "let me think"));
      assert.ok(lines.some((l) => l.message?.content === "Hello "));

      const read = await readConversation(dir, "deadbeef000c");
      assert.equal(read.events[1].text, "Hello there.");
      assert.equal(read.events[1].thinking, "let me think");

      const record = (await readMeasurements(dir)).records[0];
      assert.equal(record.measurementSchemaVersion, MEASUREMENT_SCHEMA_VERSION);
      assert.equal(record.runtime.name, "openai-compat");
      assert.equal(record.runtime.version, null, "Ollama's version must not be borrowed");
      assert.equal(record.model.digest, null, "this protocol reports no digest");
      assert.equal(record.reported.evalCount, 4);
      assert.equal(record.reported.loadDurationNs, null, "unreported stays null, never zero");
      assert.equal(record.reported.totalDurationNs, null);
      assert.equal(record.residencyAfter, null, "no /api/ps exists on this protocol");

      // No residency probe means the fit prediction cannot be checked — and
      // with no grade for a non-Ollama artifact the panel says nothing at all.
      assert.equal(final.expectation.available, false);
    });
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("openai-compat refusals: unknown runtime, unconfigured runtime, unserved model", async () => {
  const { server, host } = await stubOpenAi();
  try {
    await withTmpDir(async (dir) => {
      const refusalOf = async (chat, payload) => {
        const lines = [];
        await chat.send(payload, { writeLine: (l) => lines.push(l), onUpstreamAbort: () => {} });
        return lines[lines.length - 1].refused;
      };

      const without = createChatService({ host: "http://127.0.0.1:1", dataDir: dir, now: () => AT });
      assert.match(await refusalOf(without, { runtime: "vllm", model: "m", text: "hi" }), /unknown runtime/);
      assert.match(
        await refusalOf(without, { runtime: "openai-compat", model: "stub-gguf", text: "hi" }),
        /--llamacpp-port/,
        "the refusal tells the user how to configure what is missing",
      );

      const withRuntime = createChatService({
        host: "http://127.0.0.1:1", openAiHost: host, dataDir: dir, now: () => AT,
      });
      assert.match(
        await refusalOf(withRuntime, { runtime: "openai-compat", model: "not-served", text: "hi" }),
        /not served/,
        "the model gate holds for the second runtime exactly as for Ollama",
      );
      assert.equal((await readMeasurements(dir)).exists, false, "refusals leave no trace");
    });
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("baselines never blend runtimes: same model name, different runtime, no comparison", async () => {
  const modelName = "stub:1b"; // deliberately identical to the Ollama stub's name
  const { server: ollama, host } = await stubOllama({ modelName });
  const { server: openai, host: openAiHost } = await stubOpenAi({ modelName });
  try {
    await withTmpDir(async (dir) => {
      let tick = 0;
      let idTick = 0;
      const chat = createChatService({
        host, openAiHost, dataDir: dir, environmentHash: "ee".repeat(32),
        // Two sends, two conversations — a repeated id would be refused by the
        // store's exclusive create.
        now: () => `2026-08-09T12:00:0${tick++}Z`, newId: () => `deadbeef000d${idTick++}`,
      });
      const sink = (lines) => ({ writeLine: (l) => lines.push(l), onUpstreamAbort: () => {} });

      const viaOllama = [];
      await chat.send({ conversationId: null, runtime: "ollama", model: modelName, text: "one" }, sink(viaOllama));
      assert.equal(viaOllama[viaOllama.length - 1].baseline.isFirst, true);

      // Same name via the other runtime: a different artifact, so it gets its
      // own first-measurement verdict rather than a comparison to Ollama's.
      const viaOpenAi = [];
      await chat.send({ conversationId: null, runtime: "openai-compat", model: modelName, text: "one" }, sink(viaOpenAi));
      assert.equal(viaOpenAi[viaOpenAi.length - 1].baseline.isFirst, true, "runtimes never share a baseline");
    });
  } finally {
    await new Promise((r) => ollama.close(r));
    await new Promise((r) => openai.close(r));
  }
});

test("GET /api/chat/models reports the second runtime's three honest states", async () => {
  // Not configured: the route says so rather than pretending an empty list.
  await withChatServer(async (base) => {
    const body = await (await fetch(`${base}/api/chat/models`, { headers: { [TOKEN_HEADER]: TOKEN } })).json();
    assert.equal(body.openaiCompat.configured, false);
  });

  // Configured and reachable: the served list, exactly as reported.
  const { server: openai, host: openAiHost } = await stubOpenAi();
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "osai-chat-models-"));
  const chat = createChatService({ host: "http://127.0.0.1:1", openAiHost, dataDir: dir, now: () => AT });
  try {
    const served = await chat.models();
    assert.deepEqual(served.openaiCompat.models, ["stub-gguf"]);
    assert.equal(served.openaiCompat.available, true);
  } finally {
    await new Promise((r) => openai.close(r));
    await fsp.rm(dir, { recursive: true, force: true });
  }

  // Configured but unreachable: available false, with the reason carried.
  const gone = createChatService({ host: "http://127.0.0.1:1", openAiHost: "http://127.0.0.1:1", dataDir: ".", now: () => AT });
  const unreachable = await gone.models();
  assert.equal(unreachable.openaiCompat.configured, true);
  assert.equal(unreachable.openaiCompat.available, false);
  assert.ok(unreachable.openaiCompat.reason, "the absence carries its reason");
});
