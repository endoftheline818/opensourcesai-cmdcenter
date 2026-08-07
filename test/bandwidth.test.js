import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  GPU_MEMORY_BANDWIDTH_TABLE,
  resolveCaptureBandwidth,
  resolveGpuMemoryBandwidth,
} from "../src/derive/bandwidth.js";
import { __test } from "../src/derive/bench-gpu-bandwidth.generated.js";
import { rooflineUtilization } from "../src/derive/measurements.js";

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
