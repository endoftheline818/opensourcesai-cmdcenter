import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  ACCEPTED_PROTOCOL_VERSIONS,
  compareBenchResults,
  inspectBenchResult,
} from "../src/derive/bench-results.js";
import { INSPECT_PATHS, TOKEN_HEADER, authorize } from "../src/serve/security.js";
import { createInspect, loadRooflineLimits } from "../src/cli.js";
import { createServer } from "../src/serve/server.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const load = async (...p) => JSON.parse(await readFile(path.join(root, ...p), "utf8"));

// The two committed results are REAL runs from the Windows rig, captured with
// the actual osai-bench CLI against this repo's own Ollama — not synthetic
// shapes. Both were (honestly) recorded under --quality-override, because a
// desktop GPU never idles below the protocol's 10% precondition — which makes
// them exactly the fixtures the quality-marking rules need.
const llama = () => load("fixtures", "bench-result-rtx-4070-ti-llama31-8b.json");
const coder = () => load("fixtures", "bench-result-rtx-4070-ti-qwen25-coder-15b.json");

// ---------------------------------------------------------------------------
// Inspection
// ---------------------------------------------------------------------------

test("a real result inspects into a faithful view model", async () => {
  const result = inspectBenchResult(await llama());
  assert.equal(result.ok, true);
  const view = result.view;

  assert.equal(view.protocolVersion, "osai-bench/1.3");
  assert.equal(view.model.identifier, "llama3.1:8b");
  assert.equal(view.quality.qualityOverride, true, "the override must surface");
  assert.equal(view.quality.cohortEligible, false, "an overridden run is cohort-ineligible for life");
  // Two conditions, both real: the desktop GPU baseline, and the previous
  // fixture's model still resident when this run started. The override list
  // is the run's honest rap sheet and every entry must surface.
  assert.deepEqual(view.quality.conditions, ["gpu-utilization", "different-model-loaded"]);

  const generation = view.metrics.generationTokensPerSecond;
  assert.ok(generation.median > 50 && generation.median < 150, "a real 8B rate on this rig");
  assert.equal(generation.samples, 5);
  assert.ok(generation.coefficientOfVariation < 0.05, "the run was stable");

  assert.ok(view.roofline.utilization > 0.5 && view.roofline.utilization < 1);
  assert.equal(view.roofline.bandwidthSource, "manufacturer-table");
  assert.equal(view.placement.vramResidentFraction, 1, "fully resident");

  const ids = view.diagnostics.map((d) => d.id);
  assert.ok(ids.includes("context-vram-headroom"), "the permanently-unavailable diagnostic must not be hidden");
  assert.equal(view.diagnostics.find((d) => d.id === "context-vram-headroom").status, "unavailable");

  assert.ok(view.environment.declaredNonDefault.includes("OLLAMA_KV_CACHE_TYPE"));
  assert.equal(view.environment.authoritative, false, "a declaration must never claim authority");
});

test("a result with unavailable metrics stays unavailable — null, never zero", async () => {
  // The coder model exits before its token budget, so every W2/W4 pass fails
  // eval-count-mismatch and the generation median is legitimately absent.
  // That is the protocol refusing to count a truncated generation.
  const view = inspectBenchResult(await coder()).view;
  assert.equal(view.metrics.generationTokensPerSecond.median, null);
  assert.equal(view.roofline.utilization, null, "no throughput, no utilization — nothing is held against the ceiling");
  assert.ok(view.metrics.passFailurePercent > 0, "the failure rate tells the story instead");
});

test("unknown or malformed inputs are refused with actionable reasons", async () => {
  assert.match(inspectBenchResult(null).reason, /not a JSON object/);
  assert.match(inspectBenchResult({ hello: "world" }).reason, /no protocolVersion/);

  const future = inspectBenchResult({ protocolVersion: "osai-bench/9.9", derived: {} });
  assert.equal(future.ok, false);
  assert.match(future.reason, /osai-bench\/9\.9/, "must name the foreign protocol");
  assert.match(future.reason, new RegExp(ACCEPTED_PROTOCOL_VERSIONS[0].replace("/", "\\/")), "must name its own");

  const truncated = inspectBenchResult({ protocolVersion: "osai-bench/1.3" });
  assert.match(truncated.reason, /no derived block/);
});

// ---------------------------------------------------------------------------
// Comparison gating — every gate, in order
// ---------------------------------------------------------------------------

test("comparison without the same-machine attestation is refused, always", async () => {
  const result = await llama();
  const verdict = compareBenchResults(result, result, {});
  assert.equal(verdict.allowed, false);
  assert.match(verdict.reason, /cross-machine comparison does not exist/i);
});

test("different subjects are refused even when attested", async () => {
  const verdict = compareBenchResults(await llama(), await coder(), { sameMachineAttested: true });
  assert.equal(verdict.allowed, false);
  assert.match(verdict.reason, /different subjects/);
  assert.match(verdict.reason, /llama3\.1:8b/);
});

test("same name with different weights is refused by digest", async () => {
  const a = await llama();
  const b = JSON.parse(JSON.stringify(a));
  b.model.digest = "0".repeat(64);
  const verdict = compareBenchResults(a, b, { sameMachineAttested: true });
  assert.equal(verdict.allowed, false);
  assert.match(verdict.reason, /different weights/);
});

test("a blocking environment difference is refused in bench's own words", async () => {
  const a = await llama();
  const b = JSON.parse(JSON.stringify(a));
  b.runtime.environment.declared.OLLAMA_KV_CACHE_TYPE = "f16";
  const verdict = compareBenchResults(a, b, { sameMachineAttested: true });
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.environmentVerdict, "incomparable");
  assert.match(verdict.reason, /must not be compared/, "the refusal is bench's message, not a paraphrase");
});

test("a missing declaration compares as unknown, which is not comparable", async () => {
  const a = await llama();
  const b = JSON.parse(JSON.stringify(a));
  delete b.runtime.environment;
  const verdict = compareBenchResults(a, b, { sameMachineAttested: true });
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.environmentVerdict, "unknown");
});

test("an advisory difference is allowed, listed, and annotated", async () => {
  const a = await llama();
  const b = JSON.parse(JSON.stringify(a));
  b.runtime.environment.declared.OLLAMA_KEEP_ALIVE = "24h";
  b.runtime.environment.declaredNonDefault.push("OLLAMA_KEEP_ALIVE");
  b.runtime.version = "0.99.0";

  const verdict = compareBenchResults(a, b, { sameMachineAttested: true });
  assert.equal(verdict.allowed, true);
  assert.equal(verdict.environmentVerdict, "advisory");
  assert.equal(verdict.environmentDifferences.length, 1);
  assert.equal(verdict.environmentDifferences[0].variable, "OLLAMA_KEEP_ALIVE");
  assert.ok(verdict.notes.some((n) => /different runtime versions/.test(n)));
  assert.ok(verdict.notes.some((n) => /quality-override/.test(n)), "the override travels into the comparison");
});

test("a result compared against itself, attested, is comparable", async () => {
  const result = await llama();
  const verdict = compareBenchResults(result, result, { sameMachineAttested: true });
  assert.equal(verdict.allowed, true);
  assert.equal(verdict.environmentVerdict, "comparable");
  assert.equal(verdict.left.model.identifier, "llama3.1:8b");
});

// ---------------------------------------------------------------------------
// Transport — the inspection endpoints, end to end
// ---------------------------------------------------------------------------

const TOKEN = "a".repeat(64);

async function withServer(fn) {
  const { server, port } = createServer({
    collect: async () => ({}),
    catalog: { models: [], modelCount: 0 },
    inspect: createInspect(await loadRooflineLimits()),
    token: TOKEN,
    port: 0,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const post = (base, pathname, body, headers = {}) =>
  fetch(base + pathname, {
    method: "POST",
    headers: { "content-type": "application/json", [TOKEN_HEADER]: TOKEN, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

test("POST /api/bench/inspect validates and returns the view with the caveats", async () => {
  await withServer(async (base) => {
    const good = await post(base, "/api/bench/inspect", await llama());
    assert.equal(good.status, 200);
    const payload = await good.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.view.model.identifier, "llama3.1:8b");
    assert.ok(Array.isArray(payload.rooflineLimits) && payload.rooflineLimits.length >= 3,
      "the caveats ship with every inspected result — a utilization figure never travels without them");

    const bad = await post(base, "/api/bench/inspect", { protocolVersion: "osai-bench/9.9" });
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).reason, /osai-bench\/9\.9/);
  });
});

test("POST /api/bench/compare enforces the gates server-side", async () => {
  await withServer(async (base) => {
    const result = await llama();
    const refused = await post(base, "/api/bench/compare", { left: result, right: result });
    assert.equal(refused.status, 200, "a refused comparison is a successful evaluation whose answer is no");
    const refusedPayload = await refused.json();
    assert.equal(refusedPayload.comparison.allowed, false);
    assert.match(refusedPayload.comparison.reason, /cross-machine/i);

    const allowed = await post(base, "/api/bench/compare", {
      left: result, right: result, sameMachineAttested: true,
    });
    assert.equal((await allowed.json()).comparison.allowed, true);
  });
});

test("the inspection endpoints still require the session token", async () => {
  await withServer(async (base) => {
    const res = await fetch(base + "/api/bench/inspect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(res.status, 401);
  });
});

test("an oversized inspect body is refused while reading, not buffered", async () => {
  await withServer(async (base) => {
    const res = await post(base, "/api/bench/inspect", `{"pad":"${"x".repeat(2 * 1024 * 1024 + 64)}"}`);
    assert.equal(res.status, 400);
    assert.match((await res.json()).reason, /too large/);
  });
});

test("a server configured without inspection 404s the paths it authorized", async () => {
  const { server } = createServer({
    collect: async () => ({}),
    catalog: { models: [] },
    token: TOKEN,
    port: 0,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const res = await post(base, "/api/bench/inspect", {});
    assert.equal(res.status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// ---------------------------------------------------------------------------
// The allowlist discipline, extended to the inspect paths
// ---------------------------------------------------------------------------

test("POST to an inspect path authorizes; POST anywhere unlisted still refuses", () => {
  const req = { method: "POST", headers: { host: "127.0.0.1:7717", [TOKEN_HEADER]: TOKEN } };
  for (const pathname of INSPECT_PATHS) {
    assert.equal(authorize(req, { token: TOKEN, port: 7717, pathname }).ok, true, `POST ${pathname} must be allowed`);
  }
  const refused = authorize(req, { token: TOKEN, port: 7717, pathname: "/api/bench/store" });
  assert.equal(refused.ok, false);
  assert.equal(refused.status, 405);
});

test("the inspect authorizer allowlist and the server's dispatch table agree", async () => {
  // The same mirror discipline the action paths live under: two places name
  // these routes, and neither may grow without the other.
  const source = await readFile(path.join(root, "src", "serve", "server.js"), "utf8");
  for (const p of INSPECT_PATHS) {
    assert.ok(source.includes(`"${p}"`), `${p} is authorized but not dispatched`);
  }
  const dispatched = [...source.matchAll(/"(\/api\/bench\/[a-z]+)":/g)].map((m) => m[1]);
  assert.ok(dispatched.length > 0, "expected dispatched inspect routes — otherwise this guard is vacuous");
  for (const p of dispatched) {
    assert.ok(INSPECT_PATHS.has(p), `${p} is dispatched but not in the authorizer's allowlist`);
  }
});
