import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fsp from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { DATA_DIR_NAME, MEASUREMENTS_FILE, META_FILE, dataDirectory } from "../src/storage/paths.js";
import { appendRecord, parseJsonlText, readRecords } from "../src/storage/jsonl.js";
import {
  MEASUREMENT_SOURCES,
  appendMeasurement,
  clearMeasurements,
  emptyMeasurement,
  readMeasurements,
  validateMeasurement,
} from "../src/storage/measurements.js";
import { openStore } from "../src/storage/store.js";
import { MEASUREMENT_SCHEMA_VERSION, STORAGE_SCHEMA_VERSION } from "../src/version.js";

const AT = "2026-08-07T10:00:00Z";

/** Every filesystem test runs in its own temp directory, never the real store. */
async function withTmpDir(fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "osai-storage-test-"));
  try {
    return await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

const valid = () => emptyMeasurement({ recordedAt: AT, source: "load-action", modelName: "llama3.1:8b" });

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

test("the data directory is a platform data dir under the user's own tree", () => {
  const win = dataDirectory({ platform: "win32", home: "C:\\Users\\u", env: { LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" } });
  assert.equal(win, path.join("C:\\Users\\u\\AppData\\Local", DATA_DIR_NAME));

  // Without LOCALAPPDATA the Windows path is derived from home, same fallback
  // shape collect/tools.js uses for APPDATA.
  const winNoEnv = dataDirectory({ platform: "win32", home: "C:\\Users\\u", env: {} });
  assert.equal(winNoEnv, path.join("C:\\Users\\u", "AppData", "Local", DATA_DIR_NAME));

  const mac = dataDirectory({ platform: "darwin", home: "/Users/u", env: {} });
  assert.equal(mac, path.join("/Users/u", "Library", "Application Support", DATA_DIR_NAME));

  const linux = dataDirectory({ platform: "linux", home: "/home/u", env: {} });
  assert.equal(linux, path.join("/home/u", ".local", "share", DATA_DIR_NAME));

  const xdg = dataDirectory({ platform: "linux", home: "/home/u", env: { XDG_DATA_HOME: "/data" } });
  assert.equal(xdg, path.join("/data", DATA_DIR_NAME));
});

test("the data directory is never inside the package clone", () => {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  for (const platform of ["win32", "darwin", "linux"]) {
    const dir = dataDirectory({ platform, home: os.homedir(), env: process.env });
    assert.ok(
      !path.resolve(dir).startsWith(packageRoot + path.sep),
      `data dir must not live in the checkout (${platform}: ${dir})`,
    );
  }
});

// ---------------------------------------------------------------------------
// JSONL recovery rules
// ---------------------------------------------------------------------------

test("a torn tail is recovered as data-plus-flag, never silently dropped", () => {
  const clean = parseJsonlText('{"a":1}\n{"a":2}\n');
  assert.deepEqual(clean.records, [{ a: 1 }, { a: 2 }]);
  assert.equal(clean.tornTail, false);
  assert.equal(clean.invalidLines, 0);

  // The exact shape an interrupted append leaves: final line, mid-JSON, no newline.
  const torn = parseJsonlText('{"a":1}\n{"a":2}\n{"a":3,"trunca');
  assert.deepEqual(torn.records, [{ a: 1 }, { a: 2 }], "complete lines survive the crash");
  assert.equal(torn.tornTail, true, "the torn tail is reported, not hidden");
  assert.equal(torn.invalidLines, 0, "a crash artifact is not counted as corruption");
});

test("corruption mid-file is counted separately from a crash artifact", () => {
  // A crash cannot damage a middle line — only an editor or a bug can. The two
  // must not be conflated, because they call for different responses.
  const parsed = parseJsonlText('{"a":1}\nnot json at all\n{"a":3}\n');
  assert.deepEqual(parsed.records, [{ a: 1 }, { a: 3 }]);
  assert.equal(parsed.invalidLines, 1);
  assert.equal(parsed.tornTail, false);
});

test("a complete final line missing only its newline is kept, not discarded", () => {
  const parsed = parseJsonlText('{"a":1}\n{"a":2}');
  assert.deepEqual(parsed.records, [{ a: 1 }, { a: 2 }]);
  assert.equal(parsed.tornTail, false);
});

test("an absent file reads as an empty store, not an error", async () => {
  await withTmpDir(async (dir) => {
    const read = await readRecords(path.join(dir, "never-written.jsonl"));
    assert.equal(read.exists, false);
    assert.deepEqual(read.records, []);
  });
});

test("append/read round-trips through a real file", async () => {
  await withTmpDir(async (dir) => {
    const file = path.join(dir, "roundtrip.jsonl");
    await appendRecord(file, { n: 1 });
    await appendRecord(file, { n: 2 });
    const read = await readRecords(file);
    assert.deepEqual(read.records, [{ n: 1 }, { n: 2 }]);
  });
});

// ---------------------------------------------------------------------------
// The measurement schema — the no-prose property, tested with sentinels
// ---------------------------------------------------------------------------

test("a minimal valid record validates, and null means unknown throughout", () => {
  const record = valid();
  assert.deepEqual(validateMeasurement(record), { ok: true });
  // Unknown-vs-zero is a meaning distinction, and the schema must allow the
  // honest one everywhere a probe can come back empty.
  assert.equal(record.reported.loadDurationNs, null);
  assert.equal(record.observed.elapsedMs, null);
  assert.equal(record.residencyAfter, null);
});

// THE DAY-ONE RULE FROM THE STORAGE DECISION: a measurement record may carry
// counters and metadata, never the text of a prompt or a response. Not "we
// don't put any there" — there is no field that can carry it. The sentinels are
// the text-bearing field names of Ollama's own API payloads, plus the generic
// names prose plausibly arrives under: exactly what a careless spread of a
// response object into a record would smuggle in.
test("no text-bearing field of an inference payload can enter the measurement log", () => {
  const PROSE_SENTINELS = ["text", "content", "prompt", "messages", "response", "thinking", "title", "notes"];
  for (const field of PROSE_SENTINELS) {
    const smuggledTop = { ...valid(), [field]: "the user's words" };
    const top = validateMeasurement(smuggledTop);
    assert.equal(top.ok, false, `top-level ${field} must be refused`);
    assert.match(top.reason, /unknown field/, `refusal must name the unknown field class (${field})`);

    const smuggledNested = valid();
    smuggledNested.model = { ...smuggledNested.model, [field]: "the user's words" };
    const nested = validateMeasurement(smuggledNested);
    assert.equal(nested.ok, false, `nested model.${field} must be refused`);
  }
});

test("the refusal reason names the field, never the value", () => {
  const sentinel = "SENTINEL-this-string-must-not-appear-in-any-output";
  const verdict = validateMeasurement({ ...valid(), leaked: sentinel });
  assert.equal(verdict.ok, false);
  assert.ok(!verdict.reason.includes(sentinel), "a refusal must not echo the refused value");
});

test("every permitted string is capped, so prose cannot hide in an allowed field", () => {
  const longText = "x".repeat(201);
  const overlongName = valid();
  overlongName.model = { name: longText, digest: null };
  assert.equal(validateMeasurement(overlongName).ok, false, "model.name is capped at 200");

  const overlongVersion = valid();
  overlongVersion.runtime = { name: "ollama", version: "v".repeat(65) };
  assert.equal(validateMeasurement(overlongVersion).ok, false, "runtime.version is capped at 64");

  const proseHash = { ...valid(), environmentHash: "not hex, just words padded out" };
  assert.equal(validateMeasurement(proseHash).ok, false, "environmentHash must be hex");
});

test("fabricated shapes no real probe produces are refused", () => {
  const negative = valid();
  negative.reported = { ...negative.reported, evalCount: -1 };
  assert.equal(validateMeasurement(negative).ok, false);

  const infinite = valid();
  infinite.observed = { ...infinite.observed, elapsedMs: Infinity };
  assert.equal(validateMeasurement(infinite).ok, false);

  const stringCounter = valid();
  stringCounter.reported = { ...stringCounter.reported, evalCount: "42" };
  assert.equal(validateMeasurement(stringCounter).ok, false);

  const badSource = { ...valid(), source: "made-up-source" };
  assert.equal(validateMeasurement(badSource).ok, false);
  assert.ok(MEASUREMENT_SOURCES.length > 0, "the source enum must not be empty");

  const badTimestamp = { ...valid(), recordedAt: "yesterday-ish" };
  assert.equal(validateMeasurement(badTimestamp).ok, false);

  const wrongVersion = { ...valid(), measurementSchemaVersion: MEASUREMENT_SCHEMA_VERSION + 1 };
  assert.equal(validateMeasurement(wrongVersion).ok, false, "appends carry the current version only");
});

// ---------------------------------------------------------------------------
// The measurements log on disk
// ---------------------------------------------------------------------------

test("an invalid record is refused before it touches the disk", async () => {
  await withTmpDir(async (dir) => {
    const refused = await appendMeasurement(dir, { ...valid(), smuggled: "words" });
    assert.equal(refused.ok, false);
    const read = await readMeasurements(dir);
    assert.equal(read.exists, false, "a refused append must not even create the file");
  });
});

test("valid records round-trip; foreign material is bucketed honestly on read", async () => {
  await withTmpDir(async (dir) => {
    assert.deepEqual(await appendMeasurement(dir, valid()), { ok: true });

    const file = path.join(dir, MEASUREMENTS_FILE);
    // A record from a future schema version, a hand-edited invalid record, and
    // a torn tail — each must land in its own bucket, none may crash the read.
    await fsp.appendFile(file, `${JSON.stringify({ measurementSchemaVersion: MEASUREMENT_SCHEMA_VERSION + 1, from: "the future" })}\n`);
    await fsp.appendFile(file, `${JSON.stringify({ hand: "edited" })}\n`);
    await fsp.appendFile(file, '{"torn":tr');

    const read = await readMeasurements(dir);
    assert.equal(read.records.length, 1, "only the valid v1 record is interpreted");
    assert.equal(read.newerSchema, 1, "future records are counted, not guessed at");
    assert.equal(read.invalidRecords, 1);
    assert.equal(read.tornTail, true);
  });
});

test("clearing history deletes exactly the measurements file and nothing beside it", async () => {
  await withTmpDir(async (dir) => {
    const opened = await openStore(dir, { createdAt: AT });
    assert.equal(opened.ok, true);
    await appendMeasurement(dir, valid());

    // A neighbouring file stands in for "anything else on disk".
    const bystander = path.join(dir, "bystander.txt");
    await fsp.writeFile(bystander, "untouched");

    const cleared = await clearMeasurements(dir);
    assert.deepEqual(cleared, { ok: true, existed: true });

    assert.equal((await readMeasurements(dir)).exists, false, "the history is gone");
    assert.equal(await fsp.readFile(bystander, "utf8"), "untouched", "neighbours survive");
    assert.equal(JSON.parse(await fsp.readFile(path.join(dir, META_FILE), "utf8")).storageSchemaVersion, STORAGE_SCHEMA_VERSION, "meta survives");

    const again = await clearMeasurements(dir);
    assert.deepEqual(again, { ok: true, existed: false }, "clearing nothing is a no-op, not an error");

    assert.deepEqual(await appendMeasurement(dir, valid()), { ok: true }, "the store keeps working after a clear");
  });
});

// ---------------------------------------------------------------------------
// Opening the store — version discipline
// ---------------------------------------------------------------------------

test("first open creates the store; reopening finds it", async () => {
  await withTmpDir(async (dir) => {
    const store = path.join(dir, "store");
    const first = await openStore(store, { createdAt: AT });
    assert.equal(first.ok, true);
    assert.equal(first.created, true);
    assert.equal(first.meta.storageSchemaVersion, STORAGE_SCHEMA_VERSION);
    assert.equal(first.meta.createdAt, AT);

    const second = await openStore(store, { createdAt: "2027-01-01T00:00:00Z" });
    assert.equal(second.ok, true);
    assert.equal(second.created, false);
    assert.equal(second.meta.createdAt, AT, "reopening never restamps creation");
  });
});

test("a store created by a newer schema version is refused, naming both versions", async () => {
  await withTmpDir(async (dir) => {
    await fsp.writeFile(
      path.join(dir, META_FILE),
      JSON.stringify({ storageSchemaVersion: STORAGE_SCHEMA_VERSION + 1, createdAt: AT }),
    );
    const opened = await openStore(dir, { createdAt: AT });
    assert.equal(opened.ok, false);
    assert.match(opened.reason, new RegExp(`v${STORAGE_SCHEMA_VERSION + 1}`), "must name the on-disk version");
    assert.match(opened.reason, new RegExp(`v${STORAGE_SCHEMA_VERSION}`), "must name this client's version");
  });
});

test("a corrupt meta.json refuses to open and is left exactly as found", async () => {
  await withTmpDir(async (dir) => {
    const metaPath = path.join(dir, META_FILE);
    await fsp.writeFile(metaPath, "{ definitely not json");
    const opened = await openStore(dir, { createdAt: AT });
    assert.equal(opened.ok, false);
    assert.match(opened.reason, /refusing to open or overwrite/);
    assert.equal(await fsp.readFile(metaPath, "utf8"), "{ definitely not json", "evidence is preserved, not repaired");
  });
});

test("openStore refuses a missing or malformed createdAt rather than reading a clock", async () => {
  await withTmpDir(async (dir) => {
    const missing = await openStore(dir, {});
    assert.equal(missing.ok, false);
    const malformed = await openStore(dir, { createdAt: "today" });
    assert.equal(malformed.ok, false);
  });
});
