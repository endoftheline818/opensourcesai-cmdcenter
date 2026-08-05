import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ACTIONS, buildActionBody, createActions, validateRequest } from "../src/actions/ollama.js";
import { ACTION_PATHS, TOKEN_HEADER, authorize } from "../src/serve/security.js";
import { createServer } from "../src/serve/server.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN = "e".repeat(64);
const INSTALLED = ["qwen3:8b", "llama3.1:8b"];

// ===========================================================================
// THE BOUNDARY. Phase 2 opens exactly two actions. These tests exist to make
// widening that set impossible to do by accident.
// ===========================================================================

test("exactly two actions exist", () => {
  assert.deepEqual([...ACTIONS].sort(), ["load", "unload"]);
});

test("destructive and expensive operations are not reachable", () => {
  // Named individually rather than as a pattern, so adding one has to mean
  // deleting a line from this test.
  for (const forbidden of ["pull", "delete", "remove", "rm", "push", "create", "copy", "stop", "serve"]) {
    assert.equal(ACTIONS.includes(forbidden), false, `"${forbidden}" must not be an action`);
    assert.equal(
      validateRequest({ action: forbidden, model: "qwen3:8b" }, INSTALLED).ok,
      false,
      `"${forbidden}" must be refused by validation`,
    );
  }
});

test("the action layer touches only /api/generate, never a destructive endpoint", async () => {
  const source = await readFile(path.join(root, "src", "actions", "ollama.js"), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
  assert.match(code, /\/api\/generate/, "the one permitted endpoint must be present");
  for (const endpoint of ["/api/pull", "/api/delete", "/api/push", "/api/create", "/api/copy"]) {
    assert.ok(!code.includes(endpoint), `${endpoint} must not appear in the action layer`);
  }
});

test("an action can never carry a prompt, so it cannot run inference", () => {
  for (const action of ACTIONS) {
    const body = buildActionBody({ action, model: "qwen3:8b" });
    assert.equal(body.prompt, "", `${action} must send an empty prompt`);
    assert.equal(body.stream, false);
  }
  // keep_alive is ours, not the caller's: load keeps it warm, unload evicts.
  assert.equal(buildActionBody({ action: "load", model: "x" }).keep_alive, "5m");
  assert.equal(buildActionBody({ action: "unload", model: "x" }).keep_alive, 0);
});

test("a caller cannot inject keep_alive or extra fields", () => {
  const body = buildActionBody({ action: "load", model: "qwen3:8b", keep_alive: "999h", prompt: "leak this" });
  assert.equal(body.keep_alive, "5m", "keep_alive must come from the fixed set");
  assert.equal(body.prompt, "", "a caller-supplied prompt must be ignored");
  assert.deepEqual(Object.keys(body).sort(), ["keep_alive", "model", "prompt", "stream"]);
});

// ===========================================================================
// VALIDATION. The set of acceptable model names is enumerated by Ollama, so
// there is no string a caller can craft that reaches something unexpected.
// ===========================================================================

test("only an installed model may be named", () => {
  assert.equal(validateRequest({ action: "load", model: "qwen3:8b" }, INSTALLED).ok, true);

  const notInstalled = validateRequest({ action: "load", model: "llama3.3:70b" }, INSTALLED);
  assert.equal(notInstalled.ok, false);
  assert.match(notInstalled.reason, /not installed/);
});

test("hostile and malformed model names are refused", () => {
  for (const bad of [
    "", "   ", null, undefined, 42, {}, [],
    "qwen3:8b; rm -rf /",
    "../../etc/passwd",
    "qwen3:8b\n/api/delete",
    "q".repeat(500),
  ]) {
    assert.equal(validateRequest({ action: "load", model: bad }, INSTALLED).ok, false, `"${String(bad).slice(0, 30)}" must be refused`);
  }
});

test("validation never throws on bad input — it explains", () => {
  for (const input of [{}, { action: null }, { action: "load" }, { model: "x" }]) {
    assert.doesNotThrow(() => validateRequest(input, INSTALLED));
    assert.equal(validateRequest(input, INSTALLED).ok, false);
  }
});

// ===========================================================================
// TRANSPORT. POST is now reachable — but only for the two action paths.
// ===========================================================================

test("POST is refused everywhere except the action paths", () => {
  const req = (pathname) => ({ method: "POST", headers: { host: "127.0.0.1:7717", [TOKEN_HEADER]: TOKEN } });
  for (const pathname of ["/api/dashboard", "/api/live", "/api/report", "/api/capture", "/", "/app.js", "/api/actions", "/api/actions/pull"]) {
    const result = authorize(req(pathname), { token: TOKEN, port: 7717, pathname });
    assert.equal(result.ok, false, `POST ${pathname} must be refused`);
    assert.equal(result.status, 405);
  }
  for (const pathname of [...ACTION_PATHS]) {
    assert.equal(authorize(req(pathname), { token: TOKEN, port: 7717, pathname }).ok, true, `POST ${pathname} must be allowed`);
  }
});

test("an action always requires the token, even where assets would not", () => {
  const req = { method: "POST", headers: { host: "127.0.0.1:7717" } };
  // requireToken:false is the relaxation used for unauthenticated UI assets.
  // It must never extend to something that changes state.
  const result = authorize(req, { token: TOKEN, port: 7717, requireToken: false, pathname: "/api/actions/load" });
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
});

test("PUT, PATCH and DELETE remain refused on every path", () => {
  for (const method of ["PUT", "PATCH", "DELETE", "OPTIONS"]) {
    for (const pathname of ["/api/actions/load", "/api/dashboard"]) {
      const result = authorize({ method, headers: { host: "127.0.0.1:7717", [TOKEN_HEADER]: TOKEN } }, { token: TOKEN, port: 7717, pathname });
      assert.equal(result.ok, false, `${method} ${pathname} must be refused`);
      assert.equal(result.status, 405);
    }
  }
});

test("the authorizer's allowlist and the server's dispatch table agree", async () => {
  // Two places name these routes. If they drift, either a path authorizes but
  // does not dispatch (404 after passing auth) or dispatches without being
  // authorized — the second being the dangerous direction.
  const source = await readFile(path.join(root, "src", "serve", "server.js"), "utf8");
  for (const p of ACTION_PATHS) {
    assert.ok(source.includes('"' + p + '"'), `${p} is authorized but not dispatched`);
  }
  const dispatched = [...source.matchAll(/"(\/api\/actions\/[a-z]+)":/g)].map((m) => m[1]);
  for (const p of dispatched) {
    assert.ok(ACTION_PATHS.has(p), `${p} is dispatched but not in the authorizer's allowlist`);
  }
});

// ===========================================================================
// END TO END, against a stub Ollama — so the wire format is asserted without
// loading a real model.
// ===========================================================================

/**
 * @param {object} [options]
 * @param {() => string[]} [options.resident] What /api/ps reports, called per
 *   request so a test can change the answer between polls.
 * @param {number} [options.psStatus] Status for /api/ps, to simulate a check
 *   that cannot be read.
 */
function stubOllama({ resident = () => [], psStatus = 200 } = {}) {
  const seen = [];
  const server = http.createServer((req, res) => {
    if (req.url === "/api/tags") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ models: INSTALLED.map((name) => ({ name })) }));
      return;
    }
    if (req.url === "/api/ps") {
      seen.push({ url: req.url, method: req.method, body: null });
      res.writeHead(psStatus, { "content-type": "application/json" });
      res.end(JSON.stringify({ models: resident().map((name) => ({ name })) }));
      return;
    }
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      seen.push({ url: req.url, method: req.method, body: body ? JSON.parse(body) : null });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ done: true }));
    });
  });
  return { server, seen };
}

test("a load reaches Ollama as an empty-prompt generate, and nothing else", async () => {
  const { server, seen } = stubOllama();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const host = "http://127.0.0.1:" + server.address().port;
  try {
    const actions = createActions({ host });
    const result = await actions.load("qwen3:8b");

    assert.equal(result.ok, true);
    assert.equal(seen.length, 1, "exactly one request beyond the tags lookup");
    assert.equal(seen[0].url, "/api/generate");
    assert.equal(seen[0].method, "POST");
    assert.equal(seen[0].body.model, "qwen3:8b");
    assert.equal(seen[0].body.prompt, "");
    assert.equal(seen[0].body.keep_alive, "5m");
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("an unload sends keep_alive 0", async () => {
  const { server, seen } = stubOllama();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const host = "http://127.0.0.1:" + server.address().port;
  try {
    await createActions({ host }).unload("llama3.1:8b");
    assert.equal(seen[0].body.keep_alive, 0);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

// ===========================================================================
// POST-UNLOAD VERIFICATION.
//
// HTTP 200 from Ollama means "accepted", not "the model is gone". On the Linux
// rig those came apart: a background benchmark re-requested the model against
// OLLAMA_KEEP_ALIVE=24h, so a CORRECT unload looked like a broken button and
// cost real debugging time. The postcondition is now checked and reported.
// ===========================================================================

/** Never actually waits — the retry delay is injected. */
const noSleep = async () => {};

test("an unload confirms the model actually left memory", async () => {
  const { server, seen } = stubOllama({ resident: () => [] });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const host = "http://127.0.0.1:" + server.address().port;
  try {
    const result = await createActions({ host, sleep: noSleep }).unload("llama3.1:8b");

    assert.equal(result.ok, true);
    assert.equal(result.verified.state, "gone");
    // The confirmation must be a real observation, not an assumption.
    assert.ok(seen.some((r) => r.url === "/api/ps"), "the postcondition must actually be checked");
    // And it must be a GET — verification may not widen the mutation surface.
    assert.ok(
      seen.filter((r) => r.url === "/api/ps").every((r) => r.method === "GET"),
      "/api/ps must be read-only",
    );
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("an unload the machine immediately undoes is reported, not hidden", async () => {
  // Something else on the box keeps the model warm — the exact 2570server case.
  const { server } = stubOllama({ resident: () => ["llama3.1:8b"] });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const host = "http://127.0.0.1:" + server.address().port;
  try {
    const result = await createActions({ host, sleep: noSleep }).unload("llama3.1:8b");

    assert.equal(result.verified.state, "still-resident");
    // The ACTION succeeded — Ollama accepted it and released the model.
    // Something else reloading it afterwards is a fact about the machine, and
    // reporting it as a failed action would blame the wrong component.
    assert.equal(result.ok, true, "the action worked; the machine undid it");
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("a slow unload is given time before being called resident", async () => {
  // Present on the first poll, gone by the second: an unload in progress must
  // not be reported as one that failed to take effect.
  let polls = 0;
  const { server } = stubOllama({ resident: () => (++polls === 1 ? ["llama3.1:8b"] : []) });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const host = "http://127.0.0.1:" + server.address().port;
  try {
    const result = await createActions({ host, sleep: noSleep }).unload("llama3.1:8b");
    assert.equal(result.verified.state, "gone");
    assert.ok(polls > 1, "it must retry rather than judge on a single sample");
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("a verification that cannot be read is unknown, never a confirmed unload", async () => {
  // "I could not tell" and "it is gone" are different claims. Collapsing them
  // would let a failed check masquerade as a confirmed unload — the same
  // unavailable-is-not-zero rule the gauges follow.
  const { server } = stubOllama({ psStatus: 500 });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const host = "http://127.0.0.1:" + server.address().port;
  try {
    const result = await createActions({ host, sleep: noSleep }).unload("llama3.1:8b");
    assert.equal(result.verified.state, "unknown");
    assert.notEqual(result.verified.state, "gone", "an unreadable check is not a confirmation");
    assert.match(result.verified.reason, /could not read/);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("a load is not burdened with the unload's verification", async () => {
  // A load proves itself: it appears in the loaded list. Only the negative
  // needs proving, so a load must not pay for extra polls.
  const { server, seen } = stubOllama();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const host = "http://127.0.0.1:" + server.address().port;
  try {
    const result = await createActions({ host, sleep: noSleep }).load("qwen3:8b");
    assert.equal(result.verified, undefined);
    assert.equal(seen.filter((r) => r.url === "/api/ps").length, 0);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("an uninstalled model never reaches Ollama at all", async () => {
  const { server, seen } = stubOllama();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const host = "http://127.0.0.1:" + server.address().port;
  try {
    const result = await createActions({ host }).load("something-not-installed:70b");
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    // The point: validation happens BEFORE the request, so an unknown model
    // cannot provoke a pull or any other surprising server-side behaviour.
    assert.equal(seen.length, 0, "no request may be sent for an uninstalled model");
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("an unreachable Ollama fails safe", async () => {
  const result = await createActions({ host: "http://127.0.0.1:1" }).load("qwen3:8b");
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
  assert.match(result.reason, /not reachable/);
});

// ===========================================================================
// THE SERVER SURFACE.
// ===========================================================================

async function withServer(run, { actions } = {}) {
  const catalog = JSON.parse(await readFile(path.join(root, "data", "checker-models-snapshot.json"), "utf8"));
  const capture = JSON.parse(await readFile(path.join(root, "fixtures", "windows-rtx-4070-ti.json"), "utf8"));
  const { server } = createServer({
    collect: async () => capture,
    catalog,
    actions: actions ?? { load: async (m) => ({ ok: true, action: "load", model: m }), unload: async (m) => ({ ok: true, action: "unload", model: m }) },
    now: () => "2026-01-01T00:00:00.000Z",
    token: TOKEN,
    port: 0,
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    await run({ port: server.address().port });
  } finally {
    await new Promise((r) => server.close(r));
  }
}

const post = (port, p, body, headers = {}) =>
  fetch("http://127.0.0.1:" + port + p, {
    method: "POST",
    headers: { "content-type": "application/json", [TOKEN_HEADER]: TOKEN, ...headers },
    body: JSON.stringify(body),
  });

test("the action endpoints work over HTTP and refuse without a token", async () => {
  await withServer(async ({ port }) => {
    const ok = await post(port, "/api/actions/load", { model: "qwen3:8b" });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).ok, true);

    const noToken = await fetch("http://127.0.0.1:" + port + "/api/actions/load", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "qwen3:8b" }),
    });
    assert.equal(noToken.status, 401);
  });
});

test("a cross-site origin cannot trigger an action", async () => {
  await withServer(async ({ port }) => {
    const res = await post(port, "/api/actions/load", { model: "qwen3:8b" }, { origin: "http://evil.com" });
    assert.equal(res.status, 403, "CSRF against a state-changing endpoint must be refused");
  });
});

test("an oversized body is refused before being buffered", async () => {
  await withServer(async ({ port }) => {
    const res = await post(port, "/api/actions/load", { model: "x".repeat(10000) });
    assert.equal(res.status, 400);
    assert.match((await res.json()).reason, /too large/);
  });
});

test("malformed JSON is refused cleanly", async () => {
  await withServer(async ({ port }) => {
    const res = await fetch("http://127.0.0.1:" + port + "/api/actions/load", {
      method: "POST",
      headers: { "content-type": "application/json", [TOKEN_HEADER]: TOKEN },
      body: "{not json",
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).reason, /not valid JSON/);
  });
});

test("no action endpoint exists when actions are not configured", async () => {
  const catalog = JSON.parse(await readFile(path.join(root, "data", "checker-models-snapshot.json"), "utf8"));
  const { server } = createServer({
    collect: async () => ({}),
    catalog,
    // actions omitted — the read-only configuration must remain possible.
    now: () => "x",
    token: TOKEN,
    port: 0,
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const res = await post(server.address().port, "/api/actions/load", { model: "qwen3:8b" });
    assert.equal(res.status, 404, "without an actions dependency there must be nothing to dispatch to");
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("the mutation surface lives in exactly one directory", async () => {
  // Everything outside src/actions must remain free of write verbs, so the
  // blast radius of this phase stays one reviewable folder.
  const walk = async (dir) => {
    const entries = await readdir(dir, { withFileTypes: true });
    const nested = await Promise.all(entries.map(async (e) => {
      const full = path.join(dir, e.name);
      return e.isDirectory() ? walk(full) : [full];
    }));
    return nested.flat().filter((f) => f.endsWith(".js"));
  };

  for (const file of await walk(path.join(root, "src"))) {
    const relative = path.relative(root, file);
    if (relative.includes(path.join("src", "actions"))) continue;
    const source = await readFile(file, "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
    // ui.js is browser code posting to THIS server, not to Ollama — allowed,
    // and constrained by the same-origin rule asserted in package.test.js.
    if (relative.endsWith(path.join("serve", "ui.js"))) continue;
    assert.doesNotMatch(code, /method:\s*["']POST["']/i, `unexpected POST outside the action layer in ${relative}`);
  }
});
