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

function stubOllama({ modelName = "stub:1b" } = {}) {
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/api/tags") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ models: [{ name: modelName, size: 1_000_000_000, digest: "ff".repeat(16) }] }));
      return;
    }
    if (req.method === "GET" && req.url === "/api/ps") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ models: [{ name: modelName, size: 1_200_000_000, size_vram: 1_200_000_000 }] }));
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
        memoryBandwidthGBps: 504, weightsByModel: new Map([["stub:1b", 1_000_000_000]]),
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

      // A second send continues the conversation, replaying history as context.
      const more = [];
      await chat.send(
        { conversationId: "deadbeef0001", model: "stub:1b", text: "and again" },
        { writeLine: (l) => more.push(l), onUpstreamAbort: () => {} },
      );
      assert.equal(more[more.length - 1].done, true);
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
