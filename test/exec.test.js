import test from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/collect/exec.js";

// exec.js is the only place this package spawns a process, and its failure
// vocabulary is load-bearing: collect/tools.js turns "not-found" and
// "timed-out" into null — probe-did-not-answer — while anything else is read
// as the child answering. These tests pin the vocabulary with real children;
// the honesty mapping built on top of it is pinned in tools.test.js.

test("a child killed by the hard timeout reports timed-out, never an answer-shaped error", async () => {
  // The child would sleep for 30s; the budget is a fraction of that. What
  // Node hands back for the kill differs by platform (exit code 1 and no
  // signal on Windows, SIGTERM on POSIX), which is exactly why run() must
  // classify it rather than leave callers a message to parse.
  const res = await run(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { timeout: 500 });
  assert.equal(res.ok, false);
  assert.equal(res.error, "timed-out");
  assert.ok(res.durationMs < 15000, "the hard timeout must actually cut the child short");
});

test("a missing binary reports not-found", async () => {
  const res = await run("definitely-not-a-real-binary-xyz", ["--version"]);
  assert.equal(res.ok, false);
  assert.equal(res.error, "not-found");
});

test("a child that ran and failed keeps its message — that IS an answer", async () => {
  const res = await run(process.execPath, ["-e", "process.exit(3)"]);
  assert.equal(res.ok, false);
  assert.notEqual(res.error, "timed-out");
  assert.notEqual(res.error, "not-found");
});
