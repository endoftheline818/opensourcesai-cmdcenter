import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildDashboardPayload, resolveInstalledModels } from "../src/serve/routes.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const load = async (...p) => JSON.parse(await readFile(path.join(root, ...p), "utf8"));

// Real registry manifests, read 2026-10-27. `gemma3:4b` resolves to the same
// manifest as `gemma3:4b-it-q4_K_M`; `phi3:mini-128k` is a Q4_0 build whose
// manifest differs from the Q4_K_M tag the catalog names.
const GEMMA_Q4KM = "68ceab7e468a31c988b44d5a4984a0e21f58c4f7158c6ce29c1804babac38df7";
const PHI_Q4KM = "5a157c52afff4f48443319d4aa15956156b13b3069524d37bf2c474e45a414ce";
const PHI_MINI_128K_Q4_0 = "4f2222927938";

const catalog = {
  models: [
    { id: "gemma-3-4b", ollamaTag: "gemma3:4b-it-q4_K_M", ollamaManifests: { "gemma3:4b-it-q4_K_M": GEMMA_Q4KM } },
    { id: "phi-3-mini", ollamaTag: "phi3:3.8b-mini-128k-instruct-q4_K_M", ollamaManifests: { "phi3:3.8b-mini-128k-instruct-q4_K_M": PHI_Q4KM } },
  ],
};
const report = (names) => ({ ollama: { installedModelCount: names.length, installedModels: names } });
const join = (names, digests) => resolveInstalledModels(report(names), catalog, [], new Map(Object.entries(digests ?? {})));

test("a tag the catalog names joins by name, ahead of any digest", () => {
  const [entry] = join(["gemma3:4b-it-q4_K_M"], { "gemma3:4b-it-q4_K_M": "000000000000" });
  assert.equal(entry.status, "known");
  assert.equal(entry.catalogId, "gemma-3-4b");
  assert.equal(entry.matchedBy, "tag");
});

test("an alias that is the same manifest joins by digest", () => {
  const [entry] = join(["gemma3:4b"], { "gemma3:4b": GEMMA_Q4KM.slice(0, 12) });
  assert.equal(entry.status, "known");
  assert.equal(entry.catalogId, "gemma-3-4b");
  assert.equal(entry.matchedBy, "manifest");
});

test("a different manifest under a familiar name is not claimed", () => {
  const [entry] = join(["phi3:mini-128k"], { "phi3:mini-128k": PHI_MINI_128K_Q4_0 });
  assert.equal(entry.status, "unlisted");
  assert.equal(entry.catalogId, null);
});

test("a local build keeps its own status when its digest matches nothing", () => {
  const [entry] = join(["gemma3:4b-fast"], { "gemma3:4b-fast": "abcdefabcdef" });
  assert.equal(entry.status, "derived");
});

test("the collector's 12-character prefix and a full digest both join", () => {
  for (const digest of [GEMMA_Q4KM.slice(0, 12), GEMMA_Q4KM, GEMMA_Q4KM.toUpperCase()]) {
    const [entry] = join(["gemma3:4b"], { "gemma3:4b": digest });
    assert.equal(entry.catalogId, "gemma-3-4b", digest);
  }
});

test("without digests the join is by name only, as before", () => {
  const [byName, alias] = resolveInstalledModels(report(["gemma3:4b-it-q4_K_M", "gemma3:4b"]), catalog, []);
  assert.equal(byName.status, "known");
  assert.equal(alias.status, "unlisted");
});

test("the shipped snapshot carries a manifest digest for every tag it names", async () => {
  const snapshot = await load("data", "checker-models-snapshot.json");
  assert.match(snapshot.registryCheckedAt, /^\d{4}-\d{2}-\d{2}$/);
  let tags = 0;
  for (const model of snapshot.models) {
    for (const tag of [model.ollamaTag, model.ollamaTagQ8, model.ollamaTagFp16].filter(Boolean)) {
      tags += 1;
      assert.match(model.ollamaManifests?.[tag] ?? "", /^[0-9a-f]{64}$/, `${model.id} ${tag}`);
    }
  }
  assert.ok(tags > 0, "the snapshot names no tags at all");
});

// Captures from real machines, against the snapshot this package ships. Most
// people pull the short name (`qwen3:8b`), and the catalog names the explicit
// tag (`qwen3:8b-q4_K_M`). If this fails after a re-pin, a registry tag moved:
// look at what moved before touching the expectation.
test("real captures: short names pulled from the registry still join the catalog", async () => {
  const snapshot = await load("data", "checker-models-snapshot.json");
  const expected = {
    "windows-rtx-4070-ti.json": {
      "qwen3:4b": ["qwen3-4b", "tag"],
      "qwen3:8b": ["qwen3-8b", "manifest"],
      "qwen3:14b": ["qwen3-14b", "manifest"],
      "llama3.1:8b": ["llama-3-1-8b-instruct", "manifest"],
      "qwen2.5-coder:7b": ["qwen2-5-coder-7b", "manifest"],
    },
    "linux-rtx-3080.json": {
      "qwen3:8b": ["qwen3-8b", "manifest"],
      "qwen3:32b": ["qwen3-32b", "manifest"],
      "llama3.1:8b": ["llama-3-1-8b-instruct", "manifest"],
      "qwen3-coder:30b": ["qwen3-coder-30b-a3b", "manifest"],
      "qwen3:8b-q8_0": ["qwen3-8b", "tag"],
      // The original Qwen3-4B, a different model from the record's Thinking-2507.
      "qwen3:4b-fp16": [null, null],
      // A Q4_0 build; the catalog grades the Q4_K_M tag.
      "llama3:70b": [null, null],
      // Pulled in August, before the tag moved to its current manifest.
      "gemma4:31b": [null, null],
    },
  };
  for (const [file, names] of Object.entries(expected)) {
    const capture = await load("fixtures", file);
    const installed = new Map(buildDashboardPayload(capture, snapshot).installed.map((m) => [m.name, m]));
    for (const [name, [catalogId, matchedBy]] of Object.entries(names)) {
      const entry = installed.get(name);
      assert.ok(entry, `${file}: ${name} is not in the capture`);
      assert.equal(entry.catalogId, catalogId, `${file}: ${name}`);
      assert.equal(entry.matchedBy ?? null, matchedBy, `${file}: ${name}`);
    }
  }
});
