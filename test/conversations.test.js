import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fsp from "node:fs/promises";
import {
  CONVERSATIONS_DIR,
  CONVERSATION_SCHEMA_VERSION,
  appendEvent,
  createConversation,
  deleteConversation,
  listConversations,
  readConversation,
  validConversationId,
  validateEvent,
} from "../src/storage/conversations.js";
import { appendMeasurement, emptyMeasurement, readMeasurements } from "../src/storage/measurements.js";

const AT = "2026-08-08T10:00:00Z";
const ID = "abc123def456";

async function withTmpDir(fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "osai-conv-test-"));
  try {
    return await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Ids — the deletion module's whole safety story
// ---------------------------------------------------------------------------

test("conversation ids are a closed alphabet, and everything else is refused", () => {
  assert.equal(validConversationId(ID), true);
  assert.equal(validConversationId("a".repeat(64)), true);

  // The attacks a deletion path must be structurally immune to. ("measurements"
  // is deliberately NOT here: it is a well-formed id that maps harmlessly to
  // conversations/measurements.jsonl — a different directory from the
  // measurements log — which is the containment doing its job.)
  for (const attack of [
    "../meta", "..", ".", "a/b", "a\\b", "a.jsonl", "id.", "..id",
    "C:\\anything", "/etc/passwd", "", null, undefined, 42,
    "UPPER123CASE", "short", "a".repeat(65), "with space", "id\n.jsonl",
  ]) {
    assert.equal(validConversationId(attack), false, `${String(attack)} must be refused`);
  }
});

test("create, append, read: the whole life of a conversation round-trips", async () => {
  await withTmpDir(async (dir) => {
    const created = await createConversation(dir, { id: ID, createdAt: AT, model: "llama3.1:8b" });
    assert.deepEqual(created, { ok: true, id: ID });

    const again = await createConversation(dir, { id: ID, createdAt: AT, model: "llama3.1:8b" });
    assert.equal(again.ok, false, "an existing id is refused, never overwritten");
    assert.match(again.reason, /already exists/);

    assert.deepEqual(await appendEvent(dir, ID, { type: "user", at: AT, text: "hello" }), { ok: true });
    assert.deepEqual(
      await appendEvent(dir, ID, {
        type: "assistant", at: AT, text: "hi there", thinking: null, model: "llama3.1:8b", stopped: false,
      }),
      { ok: true },
    );

    const read = await readConversation(dir, ID);
    assert.equal(read.ok, true);
    assert.equal(read.header.model, "llama3.1:8b");
    assert.equal(read.header.systemPrompt, null, "no prompt set reads as the honest null");
    assert.equal(read.events.length, 2);
    assert.equal(read.events[0].text, "hello");
    assert.equal(read.events[1].type, "assistant");
    assert.equal(read.tornTail, false);
  });
});

test("a system prompt is set at creation, bounded, and read back verbatim", async () => {
  await withTmpDir(async (dir) => {
    const created = await createConversation(dir, {
      id: ID, createdAt: AT, model: "llama3.1:8b", systemPrompt: "You are terse.",
    });
    assert.equal(created.ok, true);
    const read = await readConversation(dir, ID);
    assert.equal(read.header.conversationSchemaVersion, CONVERSATION_SCHEMA_VERSION);
    assert.equal(read.header.systemPrompt, "You are terse.");

    // Bounds: empty and unbounded prompts are refused at the gate.
    for (const bad of ["", "x".repeat(262_145), 42]) {
      const refused = await createConversation(dir, {
        id: "feedbead0001", createdAt: AT, model: "m", systemPrompt: bad,
      });
      assert.equal(refused.ok, false, `must refuse systemPrompt=${String(bad).slice(0, 20)}`);
    }
  });
});

test("a v1 conversation (pre-systemPrompt) still reads, with the honest null", async () => {
  await withTmpDir(async (dir) => {
    // A file exactly as the v1 writer produced it.
    const base = path.join(dir, CONVERSATIONS_DIR);
    await fsp.mkdir(base, { recursive: true });
    await fsp.writeFile(
      path.join(base, `${ID}.jsonl`),
      `${JSON.stringify({ conversationSchemaVersion: 1, id: ID, createdAt: AT, model: "llama3.1:8b" })}\n` +
        `${JSON.stringify({ type: "user", at: AT, text: "old words" })}\n`,
      "utf8",
    );
    const read = await readConversation(dir, ID);
    assert.equal(read.ok, true, "a supported older version is readable, not refused");
    assert.equal(read.header.systemPrompt, null);
    assert.equal(read.events[0].text, "old words");
  });
});

test("events are a closed vocabulary with bounded shapes", () => {
  assert.equal(validateEvent({ type: "user", at: AT, text: "hi" }).ok, true);

  const smuggled = validateEvent({ type: "user", at: AT, text: "hi", extra: "field" });
  assert.equal(smuggled.ok, false, "unknown fields on a user event are refused");

  const unknownType = validateEvent({ type: "system", at: AT, text: "hi" });
  assert.equal(unknownType.ok, false);
  assert.match(unknownType.reason, /unknown event type/);

  const noClock = validateEvent({ type: "user", at: "just now", text: "hi" });
  assert.equal(noClock.ok, false, "timestamps are caller-supplied ISO-8601, always");

  const runaway = validateEvent({ type: "user", at: AT, text: "x".repeat(262_145) });
  assert.equal(runaway.ok, false, "a runaway stream must not append an unbounded line");

  const assistantMissingModel = validateEvent({ type: "assistant", at: AT, text: "y", thinking: null, stopped: false });
  assert.equal(assistantMissingModel.ok, false, "an assistant event must name its model");
});

test("appending to a conversation that does not exist is refused, not created", async () => {
  await withTmpDir(async (dir) => {
    const result = await appendEvent(dir, "feedbeef9999", { type: "user", at: AT, text: "hello" });
    assert.equal(result.ok, false);
    assert.match(result.reason, /no such conversation/);
  });
});

// ---------------------------------------------------------------------------
// The list surface carries no prose
// ---------------------------------------------------------------------------

test("the conversation list contains ids and metadata, never message text", async () => {
  await withTmpDir(async (dir) => {
    const sentinel = "SENTINEL-the-users-words-must-not-appear-in-the-list";
    // The system prompt is prose too — it must not ride the list either.
    const promptSentinel = "SENTINEL-system-prompt-is-prose-and-stays-out-of-the-list";
    await createConversation(dir, { id: ID, createdAt: AT, model: "llama3.1:8b", systemPrompt: promptSentinel });
    await appendEvent(dir, ID, { type: "user", at: "2026-08-08T11:00:00Z", text: sentinel });

    const list = await listConversations(dir);
    assert.equal(list.ok, true);
    assert.equal(list.conversations.length, 1);
    assert.equal(list.conversations[0].id, ID);
    assert.equal(list.conversations[0].messageCount, 1);
    assert.equal(list.conversations[0].lastAt, "2026-08-08T11:00:00Z");
    assert.ok(
      !JSON.stringify(list).includes(sentinel),
      "the list surface is the privacy boundary — prose requires asking for the conversation itself",
    );
    assert.ok(
      !JSON.stringify(list).includes("SENTINEL-system-prompt"),
      "the system prompt is prose and must not appear in the list",
    );
  });
});

test("an empty store lists as empty, not as an error", async () => {
  await withTmpDir(async (dir) => {
    assert.deepEqual(await listConversations(dir), { ok: true, conversations: [] });
  });
});

// ---------------------------------------------------------------------------
// Deletion — contained, and measurement history survives it
// ---------------------------------------------------------------------------

test("deletion removes exactly the named conversation and nothing beside it", async () => {
  await withTmpDir(async (dir) => {
    await createConversation(dir, { id: ID, createdAt: AT, model: "m:1b" });
    await createConversation(dir, { id: "bystander0001", createdAt: AT, model: "m:1b" });

    // A neighbouring non-conversation file in the same directory.
    const stray = path.join(dir, CONVERSATIONS_DIR, "not-a-conversation.txt");
    await fsp.writeFile(stray, "untouched");

    assert.deepEqual(await deleteConversation(dir, ID), { ok: true });
    assert.equal((await readConversation(dir, ID)).ok, false);
    assert.equal((await readConversation(dir, "bystander0001")).ok, true, "neighbours survive");
    assert.equal(await fsp.readFile(stray, "utf8"), "untouched");

    const missing = await deleteConversation(dir, ID);
    assert.equal(missing.ok, false, "deleting nothing reports honestly");
  });
});

test("deletion refuses every id-shaped attack without touching the disk", async () => {
  await withTmpDir(async (dir) => {
    await createConversation(dir, { id: ID, createdAt: AT, model: "m:1b" });
    const metaPath = path.join(dir, "meta-sentinel.json");
    await fsp.writeFile(metaPath, "must survive");

    for (const attack of ["../meta-sentinel", "..", "a/b", "C:\\x", "/etc/passwd", "", null]) {
      const result = await deleteConversation(dir, attack);
      assert.equal(result.ok, false, `${String(attack)} must be refused`);
      assert.match(result.reason, /invalid conversation id/);
    }
    assert.equal(await fsp.readFile(metaPath, "utf8"), "must survive");
  });
});

test("measurement history outlives a deleted conversation, by design", async () => {
  await withTmpDir(async (dir) => {
    await createConversation(dir, { id: ID, createdAt: AT, model: "llama3.1:8b" });
    const record = emptyMeasurement({
      recordedAt: AT, source: "chat-generation", modelName: "llama3.1:8b", conversationId: ID,
    });
    assert.deepEqual(await appendMeasurement(dir, record), { ok: true });

    await deleteConversation(dir, ID);

    const measurements = await readMeasurements(dir);
    assert.equal(measurements.records.length, 1, "counters carry no prose and survive the prose's deletion");
    assert.equal(measurements.records[0].conversationId, ID, "the id now refers to nothing, which is fine");
  });
});

// ---------------------------------------------------------------------------
// Version discipline, same as everywhere else
// ---------------------------------------------------------------------------

test("a conversation from a future schema version is refused, naming both versions", async () => {
  await withTmpDir(async (dir) => {
    const future = CONVERSATION_SCHEMA_VERSION + 1;
    await fsp.mkdir(path.join(dir, CONVERSATIONS_DIR), { recursive: true });
    await fsp.writeFile(
      path.join(dir, CONVERSATIONS_DIR, `${ID}.jsonl`),
      `${JSON.stringify({ conversationSchemaVersion: future, id: ID, createdAt: AT, model: "m" })}\n`,
    );
    const read = await readConversation(dir, ID);
    assert.equal(read.ok, false);
    assert.match(read.reason, new RegExp(`v${future}`));
    assert.match(read.reason, new RegExp(`v${CONVERSATION_SCHEMA_VERSION}\\b`));
  });
});
