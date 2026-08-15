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
  assert.equal(report.ollama.apiAuthRequired, false, "a dead endpoint makes no auth claim");
  assert.equal(report.exportable.vram_band, "unknown");
  assert.ok(report.limits.length >= 2, "an empty machine has several things to disclaim");
  assert.doesNotThrow(() => renderReport(report));
});

// AN AUTH-DEMANDING ENDPOINT IS A FINDING, NOT A FLAVOUR OF "UNREACHABLE".
// Bare Ollama's local API never asks for credentials; a 401 means the thing
// answering is a gateway or reverse proxy in front of it — and gateways hand
// their clients configs that set OLLAMA_HOST to the proxy port, so on such a
// machine this is the LIKELY misconfiguration. "Not detected" would send the
// user to reinstall a service that is running fine; the report must name the
// wrong-endpoint state, and the limits must say why it matters (a proxy can
// route to a different machine, so nothing measured through one is a fact
// about this hardware).
test("an auth-demanding endpoint is named as not-bare-Ollama, with the reason", () => {
  const behindGateway = {
    captureSchemaVersion: CAPTURE_SCHEMA_VERSION,
    platform: {},
    system: {},
    gpu: {},
    ollama: { apiReachable: false, apiError: "http 401" },
  };
  const report = buildReport(behindGateway);

  assert.equal(report.ollama.installed, false);
  assert.equal(report.ollama.apiAuthRequired, true);
  assert.ok(
    report.limits.some((l) => /demands authentication/.test(l) && /gateway or proxy/.test(l)),
    "the limits must explain the wrong-endpoint state",
  );
  assert.ok(
    report.limits.some((l) => /different machine/.test(l)),
    "the provenance hazard is the reason this matters — it must be stated",
  );

  const text = renderReport(report);
  assert.match(text, /endpoint demands authentication/, "the status line must name the state");
  assert.doesNotMatch(text, /status\s*:?\s*not detected/i, "a running gateway must not read as 'not detected'");

  // A dead endpoint (connection refused — no HTTP status at all) keeps the
  // plain unreachable wording: no status, no auth claim.
  const dead = buildReport({
    captureSchemaVersion: CAPTURE_SCHEMA_VERSION,
    platform: {},
    system: {},
    gpu: {},
    ollama: { apiReachable: false, apiError: "fetch failed" },
  });
  assert.equal(dead.ollama.apiAuthRequired, false);
  assert.match(renderReport(dead), /not detected \(API unreachable\)/);
});

// The context a model was loaded with, and its quantified spill, must survive
// derive and reach the text report — the same real A/B captures as the
// telemetry suite: one model, one card, two context lengths, two verdicts.
test("loaded context and quantified spill reach the report and its rendering", () => {
  const capture = {
    captureSchemaVersion: CAPTURE_SCHEMA_VERSION,
    platform: {},
    system: {},
    gpu: {},
    ollama: {
      apiReachable: true,
      apiVersion: "0.11.0",
      installedModels: [],
      loadedModels: [
        { name: "qwen3:8b", sizeBytes: 10_999_792_925, sizeVramBytes: 8_949_166_243, contextLength: 36_864, expiresAt: null },
        { name: "qwen3:8b", sizeBytes: 6_295_440_588, sizeVramBytes: 6_295_440_588, contextLength: 8_192, expiresAt: null },
      ],
    },
  };
  const report = buildReport(capture);
  const [large, small] = report.ollama.loadedModels;

  assert.equal(large.contextLength, 36_864);
  assert.equal(large.spilledGb, 2.05);
  assert.equal(large.vramResidentPercent, 81);
  assert.equal(small.contextLength, 8_192);
  assert.equal(small.spilledGb, null, "fully resident spills nothing — null, not 0");

  const text = renderReport(report);
  assert.match(text, /81% resident, 36864 ctx, 2\.05 GB on CPU/);
  assert.match(text, /100% resident, 8192 ctx/);

  // A capture without the field (older Ollama) renders the line it always
  // rendered — no "null ctx", no "0 ctx".
  const older = buildReport({
    ...capture,
    ollama: {
      ...capture.ollama,
      loadedModels: [{ name: "old:7b", sizeBytes: 5_000_000_000, sizeVramBytes: 5_000_000_000, expiresAt: null }],
    },
  });
  assert.equal(older.ollama.loadedModels[0].contextLength, null);
  const olderText = renderReport(older);
  assert.match(olderText, /100% resident\)/);
  assert.doesNotMatch(olderText, /null ctx|0 ctx|undefined/);
});
