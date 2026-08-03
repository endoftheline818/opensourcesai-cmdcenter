#!/usr/bin/env node
//
// Regenerate the two artifacts this package copies from opensourcesai.com:
//
//   fixtures/website-engine-parity.json  — pins src/derive/fit.js to the real engine
//   fixtures/website-bands-parity.json   — pins src/derive/bands.js to the real bands
//   data/checker-models-snapshot.json    — the catalog the dashboard grades against
//
// Run it from a machine that has BOTH repositories checked out. It executes the
// website's own modules rather than transcribing their values, which is the
// whole point: a transcribed pin drifts silently, an executed one cannot.
//
//   node scripts/sync-from-website.mjs ../opensourcesai.com
//
// WHY A SNAPSHOT AND NOT A FETCH
// Discovery-spec §8 decision 3 — whether the website publishes a fetchable data
// manifest — is OPEN, because a fetchable endpoint is a de facto public API and
// that collides with a standing non-goal. Until it is decided, this package
// carries a committed snapshot with its provenance stamped, and the dashboard
// shows how old it is. Do not replace this with a network call without that
// decision being recorded.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const websiteRoot = path.resolve(process.argv[2] ?? "../opensourcesai.com");
const here = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");

const importFromWebsite = (relative) =>
  import(pathToFileURL(path.join(websiteRoot, relative)).href);

const stamp = (extra) => ({
  source: {
    repository: "opensourcesai.com",
    generatedBy: "scripts/sync-from-website.mjs",
    generatedAt: new Date().toISOString().slice(0, 10),
    ...extra,
  },
});

async function syncBandsParity() {
  const telemetry = await importFromWebsite("src/lib/hardwareTelemetry.js");
  const apple = await importFromWebsite("src/lib/appleMemory.js");

  const probes = [0, 1, 7.9, 8, 11.9, 12, 15.9, 16, 23.9, 24, 31.9, 32, 47.9, 48, 64, 128];
  const vendors = [
    "NVIDIA GeForce RTX 4070 Ti",
    "Radeon RX 7900 XTX",
    "Apple M1",
    "Intel(R) UHD Graphics 770",
    "Some Unknown Part",
    "",
    null,
  ];

  const out = {
    ...stamp({ modules: ["src/lib/hardwareTelemetry.js", "src/lib/appleMemory.js"] }),
    GPU_VENDORS: telemetry.GPU_VENDORS,
    MEMORY_BANDS: telemetry.MEMORY_BANDS,
    APPLE_USABLE_MEMORY_FRACTION: apple.APPLE_USABLE_MEMORY_FRACTION,
    memoryBand: Object.fromEntries(probes.map((p) => [String(p), telemetry.memoryBand(p)])),
    appleUsableMemoryGb: Object.fromEntries(
      [8, 16, 24, 32, 36, 48, 64, 128].map((p) => [String(p), apple.appleUsableMemoryGb(p)]),
    ),
    gpuVendorClass: Object.fromEntries(
      vendors.map((v) => [String(v), telemetry.gpuVendorClass(v)]),
    ),
  };

  await writeFile(path.join(here, "fixtures", "website-bands-parity.json"), `${JSON.stringify(out, null, 2)}\n`);
  return "fixtures/website-bands-parity.json";
}

async function syncEngineParity() {
  const engine = await importFromWebsite("lib/checker-engine.js");

  // Cases chosen to straddle every grading boundary rather than to look tidy:
  // exactly-at-threshold, one below, and the RAM-offload fallback path.
  const fitCases = [
    [12, 5.6, 32], [12, 10, 32], [12, 10.5, 32], [12, 12, 32],
    [10, 9.5, 32], [10, 20, 32], [0, 5.6, 32], [0, 5.6, 4],
    [8, 6, 0], [6, 5.6, 8], [24, 17, 64], [48, 41, 128],
  ];

  const model = {
    name: "Test 8B",
    parametersBillions: 8,
    quantizations: { q4_k_m: { vramGb: 5.6 }, q8_0: { vramGb: 9.5 }, fp16: { vramGb: 16 } },
    ollamaTag: "test:8b",
    ollamaTagQ8: "test:8b-q8_0",
    ollamaTagFp16: "test:8b-fp16",
  };
  const noVariantTags = { ...model, ollamaTagQ8: undefined, ollamaTagFp16: undefined };

  const out = {
    ...stamp({ modules: ["lib/checker-engine.js"] }),
    RUNTIME_OVERHEAD_GB: engine.RUNTIME_OVERHEAD_GB,
    COMFORTABLE_HEADROOM_GB: engine.COMFORTABLE_HEADROOM_GB,
    RAM_OFFLOAD_MULTIPLIER: engine.RAM_OFFLOAD_MULTIPLIER,
    gradeVramFit: Object.fromEntries(
      fitCases.map(([v, r, ram]) => [`${v}|${r}|${ram}`, engine.gradeVramFit(v, r, ram)]),
    ),
    pickBestQuantization: Object.fromEntries(
      [[12, 32], [10, 32], [16, 32], [6, 32], [0, 32], [0, 4], [4, 0]].map(([v, ram]) => [
        `${v}|${ram}`,
        engine.pickBestQuantization(model, v, ram),
      ]),
    ),
    estimateTotalVram: Object.fromEntries(
      [["q4_k_m", 8], ["q8_0", 8], ["fp16", 8], ["q4_k_m", 70], ["unknown_quant", 8]].map(
        ([q, p]) => [`${p}|${q}`, engine.estimateTotalVram(p, q)],
      ),
    ),
    ollamaRunCommand: {
      "q4_k_m": engine.ollamaRunCommand(model, "q4_k_m"),
      "q8_0": engine.ollamaRunCommand(model, "q8_0"),
      "fp16": engine.ollamaRunCommand(model, "fp16"),
      "q8_0|no-variant-tag": engine.ollamaRunCommand(noVariantTags, "q8_0"),
      "fp16|no-variant-tag": engine.ollamaRunCommand(noVariantTags, "fp16"),
    },
  };

  await writeFile(path.join(here, "fixtures", "website-engine-parity.json"), `${JSON.stringify(out, null, 2)}\n`);
  return "fixtures/website-engine-parity.json";
}

async function syncCatalogSnapshot() {
  const raw = JSON.parse(
    await readFile(path.join(websiteRoot, "src", "data", "checker-models.json"), "utf8"),
  );

  // Project only the fields the dashboard grades on. A trimmed projection keeps
  // this a derived snapshot rather than a second copy of the source of truth —
  // and makes an accidental divergence obvious instead of subtle.
  const models = raw
    .filter((m) => m.showInChecker === true)
    .map((m) => ({
      id: m.id,
      name: m.name,
      family: m.family,
      parametersBillions: m.parametersBillions,
      ...(m.activeParametersBillions !== undefined
        ? { activeParametersBillions: m.activeParametersBillions }
        : {}),
      contextWindowTokens: m.contextWindowTokens,
      license: m.license,
      quantizations: m.quantizations,
      ollamaTag: m.ollamaTag,
      ...(m.ollamaTagQ8 ? { ollamaTagQ8: m.ollamaTagQ8 } : {}),
      ...(m.ollamaTagFp16 ? { ollamaTagFp16: m.ollamaTagFp16 } : {}),
      checkerOrder: m.checkerOrder,
    }))
    .sort((a, b) => a.checkerOrder - b.checkerOrder);

  const out = {
    ...stamp({ modules: ["src/data/checker-models.json"] }),
    snapshotVersion: 1,
    note:
      "Committed snapshot, not live data. Discovery-spec §8 decision 3 (a fetchable " +
      "data manifest) is open; until it is decided this file is refreshed by rerunning " +
      "scripts/sync-from-website.mjs. The dashboard displays its age.",
    modelCount: models.length,
    models,
  };

  await writeFile(path.join(here, "data", "checker-models-snapshot.json"), `${JSON.stringify(out, null, 2)}\n`);
  return `data/checker-models-snapshot.json (${models.length} checker-visible models)`;
}

/**
 * Pin the design tokens this package copies from the site's stylesheet.
 *
 * PARSED from src/index.css rather than transcribed, for the same reason the
 * other fixtures are executed rather than retyped: a hand-copied colour drifts
 * silently the moment the site is restyled, and "close enough" branding is
 * exactly the failure this is meant to prevent.
 */
async function syncDesignTokens() {
  const raw = await readFile(path.join(websiteRoot, "src", "index.css"), "utf8");

  // Strip CSS comments BEFORE splitting. The stylesheet's header comment
  // literally contains the words "@media (prefers-color-scheme: dark)", so
  // searching the raw text matches that prose at line 5 and dumps the entire
  // file into the dark bucket — which silently pinned the LIGHT primary as the
  // dark one. Parse code, never prose.
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");

  // The light values are declared on :root; the dark ones inside the
  // prefers-color-scheme block. Split on that boundary and read each half.
  const darkAt = css.search(/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{/);
  const lightSource = darkAt === -1 ? css : css.slice(0, darkAt);
  const darkSource = darkAt === -1 ? "" : css.slice(darkAt);

  const names = [
    "color-bg", "color-surface", "color-surface-soft", "color-border",
    "color-text", "color-text-muted", "color-primary", "color-primary-hover",
    "color-success", "color-error",
  ];
  const read = (source, name) => {
    const match = new RegExp(`--${name}\\s*:\\s*([^;]+);`).exec(source);
    return match ? match[1].trim() : null;
  };
  const pick = (source) => Object.fromEntries(names.map((n) => [n, read(source, n)]));

  const structural = ["radius-card", "radius-frame", "content", "font-body", "font-mono"];

  const out = {
    ...stamp({ modules: ["src/index.css"] }),
    note:
      "Design tokens copied into src/serve/ui.js so the dashboard reads as part of " +
      "the platform. Parsed from the site's stylesheet, never transcribed.",
    light: pick(lightSource),
    dark: pick(darkSource),
    structural: Object.fromEntries(structural.map((n) => [n, read(lightSource, n)])),
  };

  await writeFile(path.join(here, "fixtures", "website-design-tokens.json"), `${JSON.stringify(out, null, 2)}\n`);
  return "fixtures/website-design-tokens.json";
}

const written = [
  await syncBandsParity(),
  await syncEngineParity(),
  await syncCatalogSnapshot(),
  await syncDesignTokens(),
];
for (const line of written) process.stdout.write(`wrote ${line}\n`);
