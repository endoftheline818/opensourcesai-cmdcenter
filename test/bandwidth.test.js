import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  GPU_MEMORY_BANDWIDTH_TABLE,
  resolveCaptureBandwidth,
  resolveGpuMemoryBandwidth,
} from "../src/derive/bandwidth.js";
import { __test } from "../src/derive/bench-gpu-bandwidth.generated.js";
import { rooflineUtilization } from "../src/derive/measurements.js";
import { readManualBandwidth } from "../src/storage/bandwidth.js";
import { SETTINGS_PATHS, TOKEN_HEADER, authorize } from "../src/serve/security.js";
import { createBandwidthSettings } from "../src/cli.js";
import { createServer } from "../src/serve/server.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const load = async (...p) => JSON.parse(await readFile(path.join(root, ...p), "utf8"));

const VERBATIM_MARKER = "// @generated:begin-verbatim\n";
const normalizeEol = (text) => text.replace(/\r\n/g, "\n");

async function digestOfCopy(...segments) {
  const copy = normalizeEol(await readFile(path.join(root, ...segments), "utf8"));
  assert.match(copy, /GENERATED FILE — DO NOT EDIT/, `${segments.join("/")} must announce what it is`);
  const at = copy.indexOf(VERBATIM_MARKER);
  assert.notEqual(at, -1, `${segments.join("/")} must carry the verbatim marker`);
  const body = copy.slice(at + VERBATIM_MARKER.length);
  assert.ok(body.length > 0, "an empty body would hash to a constant");
  return { body, sha256: createHash("sha256").update(body).digest("hex") };
}

// THE PRIMARY PINS — both halves of the pair, checked completely by digest.
test("the matcher and table copies are bench's files, unedited", async () => {
  const fixture = await load("fixtures", "bench-gpu-bandwidth-parity.json");

  const matcher = await digestOfCopy("src", "derive", "bench-gpu-bandwidth.generated.js");
  assert.equal(
    matcher.sha256,
    fixture.generatedCopies.matcher.sha256,
    "the matcher copy does not match its recorded digest — do not edit it by hand; " +
      "re-run: node scripts/sync-from-bench.mjs ../opensourcesai-bench",
  );

  const table = await digestOfCopy("data", "gpu-memory-bandwidth-v1.js");
  assert.equal(
    table.sha256,
    fixture.generatedCopies.table.sha256,
    "the table copy does not match its recorded digest — do not edit it by hand; " +
      "re-run: node scripts/sync-from-bench.mjs ../opensourcesai-bench",
  );
});

// THE PAIR RESOLVES BY CONSTRUCTION — asserted, not trusted. The matcher's one
// import specifier is read out of its body and checked to land on the copied
// table, so a future relocation of either file fails here with a message
// instead of at import time with a stack trace.
test("the matcher's import specifier resolves to the copied table", async () => {
  const { body } = await digestOfCopy("src", "derive", "bench-gpu-bandwidth.generated.js");
  const imports = body.match(/^\s*import\s.+$/gm) ?? [];
  assert.equal(imports.length, 1, "the matcher must import exactly one module — its table");

  const specifier = /from\s+["']([^"']+)["']/.exec(imports[0])?.[1];
  assert.equal(specifier, "../../data/gpu-memory-bandwidth-v1.js");

  const resolved = path.resolve(root, "src", "derive", specifier);
  assert.equal(resolved, path.resolve(root, "data", "gpu-memory-bandwidth-v1.js"));
  await readFile(resolved, "utf8"); // throws if the table is not actually there
});

// THE PROVENANCE BAR, held on this side of the boundary too: every entry in
// the copied table must clear bench's own durable-source check. If bench ever
// ships an entry without a manufacturer source and archive snapshot, the
// re-pin fails HERE as well as there — the bar is part of what was copied.
test("every table entry clears the durable-manufacturer-source bar", async () => {
  const fixture = await load("fixtures", "bench-gpu-bandwidth-parity.json");
  assert.ok(GPU_MEMORY_BANDWIDTH_TABLE.entries.length > 0, "an empty table would make this vacuous");
  assert.deepEqual(GPU_MEMORY_BANDWIDTH_TABLE.entries.map((e) => e.id), fixture.entryIds);

  for (const entry of GPU_MEMORY_BANDWIDTH_TABLE.entries) {
    assert.equal(__test.hasDurableManufacturerSource(entry), true, `${entry.id} lacks a durable source`);
  }
});

// THE FAÇADE SEAM — executed samples from bench's own module, replayed against
// the copy this package actually runs.
test("resolution matches bench's own module on every pinned sample", async () => {
  const fixture = await load("fixtures", "bench-gpu-bandwidth-parity.json");
  const MIB = 1024 ** 2;
  const CASES = {
    "rtx-3080-nominal": { model: "NVIDIA GeForce RTX 3080", totalVramBytes: 10240 * MIB },
    "rtx-4070-ti-real-vram": { model: "NVIDIA GeForce RTX 4070 Ti", totalVramBytes: 12282 * MIB },
    "rtx-3080-wrong-vram": { model: "NVIDIA GeForce RTX 3080", totalVramBytes: 12288 * MIB },
    "name-normalized": { model: "  nvidia   geforce rtx 3080 ", totalVramBytes: 10240 * MIB },
    "unknown-gpu": { model: "Radeon RX 7900 XTX", totalVramBytes: 24576 * MIB },
    "no-gpu": { model: null, totalVramBytes: null },
    "manual-override-wins": { manualGBps: 999.5, model: "NVIDIA GeForce RTX 3080", totalVramBytes: 10240 * MIB },
  };

  assert.deepEqual(Object.keys(CASES).sort(), Object.keys(fixture.resolutions).sort());
  for (const [name, inputs] of Object.entries(CASES)) {
    assert.deepEqual(resolveGpuMemoryBandwidth(inputs), fixture.resolutions[name], `resolution drifted: ${name}`);
  }

  // The rules the samples encode, stated as meaning rather than as diffs:
  assert.equal(fixture.resolutions["rtx-3080-wrong-vram"].memoryBandwidthGBps, null, "a VRAM mismatch must refuse, not fuzzy-match");
  assert.equal(fixture.resolutions["manual-override-wins"].source, "manual", "a manual figure carries its own provenance");
  assert.equal(fixture.resolutions["manual-override-wins"].entryId, null, "a manual figure never borrows a table entry's identity");
});

// END TO END ACROSS THE REAL CAPTURES: both owned rigs resolve to their table
// entries from the raw bytes their vendor tools actually reported, and the
// machine with no discrete GPU resolves to honestly-unavailable.
test("the committed machine captures resolve to their table entries", async () => {
  const windows = resolveCaptureBandwidth(await load("fixtures", "windows-rtx-4070-ti.json"));
  assert.equal(windows.entryId, "nvidia-geforce-rtx-4070-ti-12gb");
  assert.equal(windows.memoryBandwidthGBps, 504);
  assert.equal(windows.source, "manufacturer-table");
  assert.equal(windows.gpu.source, "nvidia-smi");

  const linux = resolveCaptureBandwidth(await load("fixtures", "linux-rtx-3080.json"));
  assert.equal(linux.entryId, "nvidia-geforce-rtx-3080-10gb");
  assert.equal(linux.memoryBandwidthGBps, 760);

  const macos = resolveCaptureBandwidth(await load("fixtures", "macos-m1-8gb.json"));
  assert.equal(macos.memoryBandwidthGBps, null, "no table entry means unavailable, not a guess");
  assert.equal(macos.gpu, null, "Apple Silicon has no discrete GPU to resolve against");

  // The join the whole item exists for: a real capture's ceiling feeding the
  // measurement layer. 112.93 tok/s on the 3080's 760 GB/s over 4.9 GB weights
  // reads ~73% — the founding example, now derivable end to end from committed
  // artifacts alone.
  const utilization = rooflineUtilization(
    {
      measurementSchemaVersion: 1,
      reported: { evalCount: 512, evalDurationNs: 4_534_000_000 },
    },
    { memoryBandwidthGBps: linux.memoryBandwidthGBps, weightsBytes: 4.9e9 },
  );
  assert.equal(utilization.available, true);
  assert.ok(Math.abs(utilization.value - 0.728) < 0.005);
});

test("a manual figure wins for a capture too, without inventing a GPU", async () => {
  const macos = resolveCaptureBandwidth(await load("fixtures", "macos-m1-8gb.json"), { manualGBps: 100 });
  assert.equal(macos.memoryBandwidthGBps, 100);
  assert.equal(macos.source, "manual");
  assert.equal(macos.gpu, null, "the manual path supplies a number, never a hardware claim");
});

// The caveats travel with the ceiling. Any surface rendering a utilization
// figure renders these; this test keeps the artifact present, well-formed, and
// in agreement with the parity fixture's record of where it came from.
test("the roofline caveats are committed, non-empty, and provenance-stamped", async () => {
  const limits = await load("data", "bench-roofline-limits.json");
  assert.ok(Array.isArray(limits.limits) && limits.limits.length >= 3);
  assert.ok(limits.limits.every((l) => typeof l === "string" && l.length > 0));
  assert.match(limits.limits.join(" "), /generation only/i, "the generation-only caveat is the load-bearing one");
  assert.equal(limits.source.repository, "opensourcesai-bench");
  assert.match(limits.source.protocolVersion, /^osai-bench\//);

  const fixture = await load("fixtures", "bench-gpu-bandwidth-parity.json");
  assert.equal(fixture.rooflineLimitsFile, "data/bench-roofline-limits.json");
});

// ---------------------------------------------------------------------------
// The manual-entry surface — persistence and gating around the copied resolver
// ---------------------------------------------------------------------------

const AT = "2026-08-10T10:00:00Z";
const TOKEN = "a".repeat(64);

async function withTmpDir(fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "osai-bandwidth-test-"));
  try {
    return await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

/** The real Windows capture with its GPU renamed to something the table cannot know. */
async function unlistedCapture() {
  const fixture = await load("fixtures", "windows-rtx-4070-ti.json");
  return JSON.parse(
    JSON.stringify(fixture).replaceAll("NVIDIA GeForce RTX 4070 Ti", "Prototype GPU 9000"),
  );
}

test("an unlisted GPU takes a manual figure, labelled manual, tied to that GPU", async () => {
  await withTmpDir(async (dir) => {
    const settings = createBandwidthSettings({
      dataDir: dir, capture: await unlistedCapture(), now: () => AT,
    });
    await settings.load();

    // Before entry: honest absence, with the GPU named so the UI can say so.
    let status = await settings.status();
    assert.equal(status.resolution.memoryBandwidthGBps, null);
    assert.equal(status.gpu.name, "Prototype GPU 9000");
    assert.equal(status.manual.exists, false);
    assert.deepEqual(settings.effectiveCeiling(), { memoryBandwidthGBps: null, bandwidthSource: null });

    // Absurdity is refused and nothing lands on disk.
    const refused = await settings.set({ memoryBandwidthGBps: -5 });
    assert.equal(refused.ok, false);
    assert.equal((await readManualBandwidth(dir)).exists, false);

    // A sane figure persists, stamped with the CURRENT gpu server-side.
    status = await settings.set({ memoryBandwidthGBps: 800 });
    assert.equal(status.ok, true);
    assert.equal(status.resolution.memoryBandwidthGBps, 800);
    assert.equal(status.resolution.source, "manual");
    assert.equal(status.manual.applied, true);
    assert.equal(status.overridesTable, null, "nothing was overridden — the table had no figure");
    const stored = await readManualBandwidth(dir);
    assert.equal(stored.entry.gpuName, "Prototype GPU 9000");
    assert.equal(stored.entry.enteredAt, AT);
    assert.deepEqual(settings.effectiveCeiling(), { memoryBandwidthGBps: 800, bandwidthSource: "manual" });

    // Clearing returns to the honest absence.
    status = await settings.clear();
    assert.equal(status.resolution.memoryBandwidthGBps, null);
    assert.equal((await readManualBandwidth(dir)).exists, false);
  });
});

test("a manual figure over a LISTED gpu wins but names what it overrode", async () => {
  await withTmpDir(async (dir) => {
    const settings = createBandwidthSettings({
      dataDir: dir, capture: await load("fixtures", "windows-rtx-4070-ti.json"), now: () => AT,
    });
    await settings.load();
    const status = await settings.set({ memoryBandwidthGBps: 600 });
    assert.equal(status.resolution.source, "manual");
    assert.equal(status.resolution.memoryBandwidthGBps, 600);
    assert.deepEqual(status.overridesTable, {
      memoryBandwidthGBps: 504,
      entryId: "nvidia-geforce-rtx-4070-ti-12gb",
    }, "the displaced manufacturer figure stays visible");
  });
});

test("a stored figure for a DIFFERENT gpu is ignored with its reason, never borrowed", async () => {
  await withTmpDir(async (dir) => {
    // Entered on the prototype card…
    const before = createBandwidthSettings({
      dataDir: dir, capture: await unlistedCapture(), now: () => AT,
    });
    await before.load();
    await before.set({ memoryBandwidthGBps: 800 });

    // …then the machine boots with the 4070 Ti as primary.
    const after = createBandwidthSettings({
      dataDir: dir, capture: await load("fixtures", "windows-rtx-4070-ti.json"), now: () => AT,
    });
    await after.load();
    const status = await after.status();
    assert.equal(status.manual.exists, true);
    assert.equal(status.manual.applied, false);
    assert.match(status.manual.ignoredReason, /Prototype GPU 9000/);
    assert.equal(status.resolution.source, "manufacturer-table", "the table figure stands; the stale figure is not borrowed");
    assert.equal(status.resolution.memoryBandwidthGBps, 504);
  });
});

test("without persistence the display half still works and saving refuses with the reason", async () => {
  const settings = createBandwidthSettings({
    dataDir: null,
    persistenceUnavailableReason: "the store is from a newer version",
    capture: await load("fixtures", "windows-rtx-4070-ti.json"),
    now: () => AT,
  });
  await settings.load();
  const status = await settings.status();
  assert.equal(status.resolution.memoryBandwidthGBps, 504, "provenance display needs no storage");
  assert.equal(status.persistence.available, false);
  const refused = await settings.set({ memoryBandwidthGBps: 800 });
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /newer version/);
});

// ---------------------------------------------------------------------------
// Transport: the settings pair under the same allowlist discipline
// ---------------------------------------------------------------------------

test("POST to a settings path authorizes; the mirror with the dispatch table holds", async () => {
  const req = { method: "POST", headers: { host: "127.0.0.1:7717", [TOKEN_HEADER]: TOKEN } };
  for (const pathname of SETTINGS_PATHS) {
    assert.equal(authorize(req, { token: TOKEN, port: 7717, pathname }).ok, true, `POST ${pathname} must be allowed`);
  }
  assert.equal(authorize(req, { token: TOKEN, port: 7717, pathname: "/api/settings/other" }).ok, false);

  const source = await readFile(path.join(root, "src", "serve", "server.js"), "utf8");
  for (const p of SETTINGS_PATHS) {
    assert.ok(source.includes(`"${p}"`), `${p} is authorized but not dispatched`);
  }
  const dispatched = [...source.matchAll(/"(\/api\/settings\/[a-z/]+)":/g)].map((m) => m[1]);
  assert.ok(dispatched.length > 0, "expected dispatched settings routes — otherwise this guard is vacuous");
  for (const p of dispatched) {
    assert.ok(SETTINGS_PATHS.has(p), `${p} is dispatched but not in the authorizer's allowlist`);
  }
});

test("the settings routes work end to end, and their absence answers honestly", async () => {
  await withTmpDir(async (dir) => {
    const settings = createBandwidthSettings({
      dataDir: dir, capture: await unlistedCapture(), now: () => AT,
    });
    await settings.load();
    const { server } = createServer({
      collect: async () => ({}),
      catalog: { models: [] },
      settings,
      token: TOKEN,
      port: 0,
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const before = await (await fetch(`${base}/api/settings/bandwidth`, { headers: { [TOKEN_HEADER]: TOKEN } })).json();
      assert.equal(before.resolution.memoryBandwidthGBps, null);

      const noToken = await fetch(`${base}/api/settings/bandwidth/set`, {
        method: "POST", headers: { "content-type": "application/json" }, body: "{}",
      });
      assert.equal(noToken.status, 401, "settings writes require the session token");

      const saved = await (await fetch(`${base}/api/settings/bandwidth/set`, {
        method: "POST",
        headers: { "content-type": "application/json", [TOKEN_HEADER]: TOKEN },
        body: JSON.stringify({ memoryBandwidthGBps: 800 }),
      })).json();
      assert.equal(saved.resolution.source, "manual");

      const bad = await fetch(`${base}/api/settings/bandwidth/set`, {
        method: "POST",
        headers: { "content-type": "application/json", [TOKEN_HEADER]: TOKEN },
        body: JSON.stringify({ memoryBandwidthGBps: "fast" }),
      });
      assert.equal(bad.status, 400);

      const cleared = await (await fetch(`${base}/api/settings/bandwidth/clear`, {
        method: "POST",
        headers: { "content-type": "application/json", [TOKEN_HEADER]: TOKEN },
        body: "{}",
      })).json();
      assert.equal(cleared.resolution.memoryBandwidthGBps, null);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  // A server wired without settings: GET says so, POST is a 404 — the same
  // honest-absence shape chat and inspection already follow.
  const { server } = createServer({ collect: async () => ({}), catalog: { models: [] }, token: TOKEN, port: 0 });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const absent = await (await fetch(`${base}/api/settings/bandwidth`, { headers: { [TOKEN_HEADER]: TOKEN } })).json();
    assert.equal(absent.ok, false);
    const post = await fetch(`${base}/api/settings/bandwidth/set`, {
      method: "POST", headers: { "content-type": "application/json", [TOKEN_HEADER]: TOKEN }, body: "{}",
    });
    assert.equal(post.status, 404);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
