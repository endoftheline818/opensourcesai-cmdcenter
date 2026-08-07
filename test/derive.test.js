import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildReport } from "../src/derive/report.js";
import { renderReport } from "../src/derive/render.js";
import { CAPTURE_SCHEMA_VERSION } from "../src/version.js";
import { MEMORY_BANDS, GPU_VENDORS } from "../src/derive/bands.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = async (name) =>
  JSON.parse(await readFile(path.join(root, "fixtures", `${name}.json`), "utf8"));

// These fixtures are REAL CAPTURES from the three machines Phase 0 was
// validated on, not hand-written data. That is what makes this suite able to
// exercise Windows, Linux and macOS reporting on a CI runner that has none of
// that hardware — the property the collect/derive split exists to buy.

test("windows: the saturating source is contradicted, not believed", async () => {
  const report = buildReport(await fixture("windows-rtx-4070-ti"));

  // Win32_VideoController.AdapterRAM reports ~4 GiB for this 12 GiB card.
  // The report must neither select it nor hide the contradiction.
  assert.notEqual(report.gpu.selectedSource, "Win32_VideoController.AdapterRAM");
  assert.equal(report.gpu.selectedSource, "nvidia-smi");
  assert.equal(report.gpu.nameplateGb, 12);

  assert.ok(report.disagreements.length > 0, "the 3x spread must be surfaced");
  const flagged = report.disagreements[0].claims.filter((c) => c.knownUnreliable);
  assert.equal(flagged.length, 1);
  assert.match(flagged[0].source, /AdapterRAM/);

  // THE BAND-BOUNDARY REGRESSION, end to end on real data: this card must not
  // land in 8-11 just because its raw GiB reads 11.99.
  assert.equal(report.exportable.vram_band, "12-15");
});

test("linux: a single-source figure is reported as exactly that", async () => {
  const report = buildReport(await fixture("linux-rtx-3080"));

  assert.equal(report.platform.os, "linux");
  assert.equal(report.gpu.selectedSource, "nvidia-smi");
  assert.equal(report.gpu.nameplateGb, 10);
  assert.equal(report.exportable.vram_band, "8-11");

  // NVIDIA-on-Linux exposes no second source (mem_info_vram_total is an amdgpu
  // node), so there is nothing to disagree with — and the report must say so
  // rather than let one uncorroborated number read as confirmed.
  assert.equal(report.disagreements.length, 0);
  assert.equal(report.vramSources.independentSources, 1);
  assert.ok(
    report.limits.some((l) => /one independent source/.test(l)),
    "single-source VRAM must be declared as a limit",
  );
});

test("macos: capacity is banded from usable memory, not the sticker total", async () => {
  const report = buildReport(await fixture("macos-m1-8gb"));

  assert.equal(report.platform.os, "darwin");
  assert.equal(report.gpu, null, "Apple Silicon has no discrete GPU to report");

  assert.equal(report.appleMemory.totalMemoryGb, 8);
  assert.equal(report.appleMemory.usableModelMemoryGb, 6);
  assert.equal(report.appleMemory.sourcesAgree, true);

  // The finding this encodes: banding the 8 GB total would give "8-11" and
  // overstate what the machine can actually load. macOS withholds ~25%, so the
  // honest band is a full tier lower.
  assert.equal(report.exportable.vram_band, "lt-8");
  assert.notEqual(report.exportable.vram_band, "8-11");
  assert.equal(report.exportable.gpu_vendor, "apple");
});

test("every fixture produces a contract-valid, privacy-safe report", async () => {
  // Selected by SHAPE, not by filename prefix: a capture declares its own
  // captureSchemaVersion, parity pins (website-*, bench-*) declare a source
  // block instead. A prefix list here would be the third copy of that
  // convention, and the second copy already drifted once — this test failed
  // the day a bench parity fixture appeared, because its inline filter only
  // knew about the website prefix.
  const all = (await readdir(path.join(root, "fixtures")))
    .filter((n) => n.endsWith(".json"))
    .map((n) => n.replace(/\.json$/, ""));
  const captures = [];
  for (const name of all) {
    const parsed = await fixture(name);
    if ("captureSchemaVersion" in parsed) captures.push([name, parsed]);
  }

  assert.ok(captures.length >= 3, "all three validated platforms must be represented");

  for (const [name, capture] of captures) {
    assert.equal(capture.captureSchemaVersion, CAPTURE_SCHEMA_VERSION, `${name} schema drifted`);

    const report = buildReport(capture);
    assert.equal(report.reportContractVersion, 1);

    // INVARIANT 1 (privacy): the exportable block is closed-vocabulary only.
    assert.deepEqual(Object.keys(report.exportable).sort(), ["gpu_vendor", "ram_band", "vram_band"]);
    assert.ok(GPU_VENDORS.includes(report.exportable.gpu_vendor), `${name} leaked a vendor value`);
    assert.ok(MEMORY_BANDS.includes(report.exportable.vram_band), `${name} leaked a vram value`);
    assert.ok(MEMORY_BANDS.includes(report.exportable.ram_band), `${name} leaked a ram value`);

    // No exact figure may appear in the shareable block.
    const serialized = JSON.stringify(report.exportable);
    assert.doesNotMatch(serialized, /\d+\.\d+/, `${name} exported a precise number`);

    assert.doesNotThrow(() => renderReport(report), `${name} failed to render`);
  }
});

// INVARIANT 2 (determinism): same capture in, same report out. If anything in
// derive reached for a clock or a random source this would flake.
test("report construction is deterministic", async () => {
  for (const name of ["windows-rtx-4070-ti", "linux-rtx-3080", "macos-m1-8gb"]) {
    const capture = await fixture(name);
    const a = buildReport(capture, { generatedAt: "2026-01-01T00:00:00.000Z" });
    const b = buildReport(capture, { generatedAt: "2026-01-01T00:00:00.000Z" });
    assert.deepEqual(a, b, `${name} is not deterministic`);
  }
});

test("generatedAt is caller-supplied and never invented", async () => {
  const capture = await fixture("linux-rtx-3080");
  assert.equal(buildReport(capture).generatedAt, null);
  assert.equal(
    buildReport(capture, { generatedAt: "2026-05-05T12:00:00.000Z" }).generatedAt,
    "2026-05-05T12:00:00.000Z",
  );
});

test("a capture from a machine with nothing installed still reports honestly", () => {
  // Degradation matters: the tool runs on machines with no GPU and no Ollama,
  // and must produce a usable report there rather than throwing.
  const empty = { captureSchemaVersion: CAPTURE_SCHEMA_VERSION, platform: {}, system: {}, gpu: {}, ollama: {} };
  const report = buildReport(empty);

  assert.equal(report.gpu, null);
  assert.equal(report.appleMemory, null);
  assert.equal(report.ollama.installed, false);
  assert.equal(report.exportable.vram_band, "unknown");
  assert.ok(report.limits.length >= 2, "an empty machine has several things to disclaim");
  assert.doesNotThrow(() => renderReport(report));
});
