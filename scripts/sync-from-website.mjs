#!/usr/bin/env node
//
// Regenerate everything this package copies from opensourcesai.com:
//
//   src/derive/checker-engine.generated.js — the fit engine itself, copied verbatim
//   fixtures/website-engine-parity.json    — pins that copy, and the façade over it
//   fixtures/website-bands-parity.json     — pins src/derive/bands.js to the real bands
//   data/checker-models-snapshot.json      — the catalog the dashboard grades against
//   fixtures/website-design-tokens.json    — pins the site colours in src/serve/ui.js
//   fixtures/website-social-palette.json   — pins the HUD palette in src/serve/ui.js
//
// Run it from a machine that has BOTH repositories checked out. It executes or
// parses the website's own modules rather than transcribing their values, which
// is the whole point: a transcribed pin drifts silently, an executed one cannot.
//
//   node scripts/sync-from-website.mjs ../opensourcesai.com
//
// WHY THE ENGINE IS COPIED HERE RATHER THAN PORTED BY HAND
// Because the hand step is where it broke. Website #520 (2026-08-05) changed fit
// grading to charge weights PLUS runtime overhead. Re-running this script that
// morning would have regenerated the parity fixture — but a human still had to
// carry the change into src/derive/fit.js themselves, and for six hours this
// package graded against the pre-fix rule with a fully green suite. A fixture
// proves a copy is IDENTICAL wherever it samples; it cannot prove that anyone
// remembered to copy. So the engine is now written by this script, and the only
// remaining human act is running it.
//
// WHY A SNAPSHOT AND NOT A FETCH
// Discovery-spec §8 decision 3 — whether the website publishes a fetchable data
// manifest — is OPEN, because a fetchable endpoint is a de facto public API and
// that collides with a standing non-goal. Until it is decided, this package
// carries a committed snapshot with its provenance stamped, and the dashboard
// shows how old it is. Do not replace this with a network call without that
// decision being recorded.

import { createHash } from "node:crypto";
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

/** The website module this package runs as its fit engine. */
const ENGINE_MODULE = "lib/checker-engine.js";
const ENGINE_TARGET = path.join("src", "derive", "checker-engine.generated.js");

/**
 * Separates this repo's provenance header from the upstream bytes. Everything
 * after this line is the website's file and nothing else, which is what lets a
 * digest mean something a reader can check by hand: strip the header, hash the
 * rest, compare against the website file.
 */
const VERBATIM_MARKER = "// @generated:begin-verbatim";

/**
 * Line endings are normalized to LF before hashing, and the digest is only ever
 * computed over normalized text.
 *
 * `.gitattributes` commits LF and checks out LF, so today both sides agree — but
 * a digest is exactly the kind of check that fails by platform if it can, and
 * this package's CI runs Windows, Linux and macOS. A clone predating
 * `.gitattributes`, or one with a local `core.autocrlf`, would otherwise
 * recompute a different hash from identical code and fail one CI leg only.
 */
const normalizeEol = (text) => text.replace(/\r\n/g, "\n");

/**
 * Copy the website's fit engine into this package, verbatim.
 *
 * Verbatim is load-bearing, not stylistic: it means the copy can be verified by
 * `diff` against the source, so no reviewer has to judge whether a transcription
 * was faithful. That is only possible because `lib/checker-engine.js` imports
 * nothing — it is self-contained pure ESM by its own first line ("pure, no
 * react/side-effects so it runs client or server"), so it crosses the repo
 * boundary without dragging the website's module graph behind it. If that ever
 * stops being true, this script must fail loudly rather than copy a file whose
 * imports cannot resolve here.
 */
async function syncCheckerEngine() {
  const source = normalizeEol(await readFile(path.join(websiteRoot, ENGINE_MODULE), "utf8"));

  // Refuse rather than emit something whose header/body split is ambiguous.
  if (source.includes(VERBATIM_MARKER)) {
    throw new Error(`${ENGINE_MODULE} contains the verbatim marker; the split would be ambiguous`);
  }
  // The copy must stay standalone. An `import` upstream is not a thing to work
  // around silently — it is a signal that the shared-engine arrangement itself
  // needs revisiting (discovery-spec §8 decision 4).
  const imports = source.match(/^\s*import\s.+$/gm);
  if (imports) {
    throw new Error(
      `${ENGINE_MODULE} now imports (${imports.length}): a verbatim copy would not resolve here. ` +
        "Revisit how the engine is shared before re-running this script.",
    );
  }

  const sha256 = createHash("sha256").update(source).digest("hex");
  const copiedAt = new Date().toISOString().slice(0, 10);

  const header = `// GENERATED FILE — DO NOT EDIT. Re-run the sync script instead.
//
// A byte-exact copy of opensourcesai.com's ${ENGINE_MODULE}. This package keeps
// a hard boundary with that repository and never imports across it; the engine
// is copied instead, and this file is that copy.
//
// WHY GENERATED RATHER THAN HAND-PORTED
// It was hand-ported until 2026-08-06, and the hand step is where it failed.
// Website #520 fixed grading to charge weights PLUS runtime overhead; the parity
// fixture beside this file was regenerated the same morning, but carrying the
// change into src/derive/fit.js was a separate human act. For six hours this
// package graded with the pre-fix rule and its whole suite stayed green. A
// fixture proves a copy is IDENTICAL where it samples; it cannot prove someone
// remembered to copy. Nothing here is written by hand any more.
//
//   source      opensourcesai.com ${ENGINE_MODULE}
//   sha256      ${sha256}
//   copied      ${copiedAt}
//   regenerate  node scripts/sync-from-website.mjs ../opensourcesai.com
//
// The digest covers everything below the marker — the upstream bytes, LF-normalized —
// and test/fit.test.js recomputes it, so an edit here fails the suite instead of
// quietly forking the engine.
//
// NOT EVERYTHING BELOW IS USED. \`scoreModel\` and \`buildRationale\` arrive because
// the file arrives whole, and src/derive/fit.js deliberately does not re-export
// either. See the note there; test/package.test.js asserts they stay unreachable.
${VERBATIM_MARKER}
`;

  await writeFile(path.join(here, ENGINE_TARGET), header + source);
  return { module: ENGINE_MODULE, file: ENGINE_TARGET.replace(/\\/g, "/"), sha256, copiedAt };
}

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

/**
 * Pin the engine's behaviour by executing the website's own module.
 *
 * WHAT THIS FIXTURE IS FOR NOW THAT THE ENGINE IS COPIED VERBATIM. It no longer
 * has to prove the copy matches the original — the digest does that, completely,
 * rather than at sampled points. What it still proves is that the layer ABOVE the
 * copy behaves: that src/derive/fit.js delegates to the engine instead of quietly
 * reimplementing a piece of it, and that this package's own grading composes the
 * engine's parts the way the engine intends. That is the seam a digest cannot see.
 *
 * @param {{module: string, file: string, sha256: string}} copy
 */
async function syncEngineParity(copy) {
  const engine = await importFromWebsite(ENGINE_MODULE);

  // Cases chosen to straddle every grading boundary rather than to look tidy:
  // exactly-at-threshold, one below, and the RAM-offload fallback path.
  const fitCases = [
    [12, 5.6, 32], [12, 10, 32], [12, 10.5, 32], [12, 12, 32],
    [10, 9.5, 32], [10, 20, 32], [0, 5.6, 32], [0, 5.6, 4],
    [8, 6, 0], [6, 5.6, 8], [24, 17, 64], [48, 41, 128],
  ];

  // gradeModelFit takes CATALOG weights, where gradeVramFit takes an already-built
  // requirement. It is the engine's own answer to the defect #520 fixed, and
  // src/derive/fit.js calls it rather than reassembling its four arguments — so it
  // is sampled here directly. The cases sit in the band that #520 moved: VRAM
  // between bare weights and weights + RUNTIME_OVERHEAD_GB, where the pre-fix rule
  // said "tight" and the fixed rule says the model does not fit in VRAM at all.
  const modelFitCases = [
    [10, 9.5, 32], [10, 8.5, 32], [12, 10.5, 32], [12, 9, 32],
    [8, 6, 0], [6, 5.6, 8], [0, 5.6, 32], [24, 20, 64],
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
    ...stamp({ modules: [ENGINE_MODULE] }),
    // Provenance for the verbatim copy. The digest is the real pin; everything
    // below it in this file pins the façade over that copy.
    generatedCopy: {
      file: copy.file,
      sourceModule: copy.module,
      algorithm: "sha256",
      sha256: copy.sha256,
      note:
        "Digest of the upstream file, LF-normalized — i.e. of everything below the " +
        "@generated:begin-verbatim marker in the copy. Recomputed by test/fit.test.js.",
    },
    RUNTIME_OVERHEAD_GB: engine.RUNTIME_OVERHEAD_GB,
    COMFORTABLE_HEADROOM_GB: engine.COMFORTABLE_HEADROOM_GB,
    RAM_OFFLOAD_MULTIPLIER: engine.RAM_OFFLOAD_MULTIPLIER,
    gradeVramFit: Object.fromEntries(
      fitCases.map(([v, r, ram]) => [`${v}|${r}|${ram}`, engine.gradeVramFit(v, r, ram)]),
    ),
    gradeModelFit: Object.fromEntries(
      modelFitCases.map(([v, w, ram]) => [`${v}|${w}|${ram}`, engine.gradeModelFit(v, w, ram)]),
    ),
    fitRequirementGb: Object.fromEntries(
      // Includes the non-numeric passthrough, which exists so a null requirement
      // is not silently turned into 1.5 GB and made to look like a fit.
      [5.6, 9.5, 0, -1, null].map((w) => [String(w), engine.fitRequirementGb(w)]),
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
 * Pin the design tokens this package copies from the site's stylesheets.
 *
 * PARSED from src/index.css (colours, structure) and src/motion.css (the two
 * motion tokens the live-metric flash shares) rather than transcribed, for the
 * same reason the other fixtures are executed rather than retyped: a hand-copied
 * colour drifts silently the moment the site is restyled, and "close enough"
 * branding is exactly the failure this is meant to prevent.
 *
 * THE NAME LISTS BELOW ARE THE CONTRACT. The website's own gate
 * (scripts/assert-css-tokens.js) checks the same names in the same order, and
 * docs/design-tokens-contract.md over there is the human-readable record. Add
 * a name in all three places or in none.
 */
async function syncDesignTokens() {
  const raw = await readFile(path.join(websiteRoot, "src", "index.css"), "utf8");
  const motionRaw = await readFile(path.join(websiteRoot, "src", "motion.css"), "utf8");

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
    // The instrument channel (site phase 4, L4): signal cyan, the bounded
    // hardware/data orange, warn amber + its text ink, the one status green,
    // the hairline grid. This dashboard renders the dark half of these.
    "brand-cyan", "data-orange", "color-warn", "color-warn-ink", "status-green", "grid-line",
  ];
  const read = (source, name) => {
    const match = new RegExp(`--${name}\\s*:\\s*([^;]+);`).exec(source);
    return match ? match[1].trim() : null;
  };
  const pick = (source) => Object.fromEntries(names.map((n) => [n, read(source, n)]));

  const structural = ["radius-card", "radius-frame", "content", "font-body", "font-mono"];

  // Motion lives in its own file, in one theme-invariant :root block — no
  // light/dark split to honour, only comments to strip.
  const motionCss = motionRaw.replace(/\/\*[\s\S]*?\*\//g, "");
  const motion = ["dur-data", "ease-out"];

  const out = {
    ...stamp({ modules: ["src/index.css", "src/motion.css"] }),
    note:
      "Design tokens copied into src/serve/ui.js so the dashboard reads as part of " +
      "the platform. Parsed from the site's stylesheets, never transcribed. The name " +
      "lists are shared with the site's verify:css-tokens gate and recorded in its " +
      "docs/design-tokens-contract.md.",
    light: pick(lightSource),
    dark: pick(darkSource),
    structural: Object.fromEntries(structural.map((n) => [n, read(lightSource, n)])),
    motion: Object.fromEntries(motion.map((n) => [n, read(motionCss, n)])),
  };

  await writeFile(path.join(here, "fixtures", "website-design-tokens.json"), `${JSON.stringify(out, null, 2)}\n`);
  return "fixtures/website-design-tokens.json";
}

/**
 * Pin the social-image HUD palette.
 *
 * PARSED from the style guide's own colour table, for the same reason every
 * other fixture here is generated rather than typed: the dashboard is adopting
 * a documented brand surface, and a hand-copied hex drifts the moment that
 * surface is restyled. The guide's table rows look like:
 *   | `accentCyan` | `#38bdf8` | Primary cyan accent … |
 */
async function syncSocialPalette() {
  const guide = await readFile(
    path.join(websiteRoot, "docs", "social-image-system", "social-image-style-guide.md"),
    "utf8",
  );

  const palette = {};
  for (const match of guide.matchAll(/^\|\s*`([A-Za-z][A-Za-z0-9]*)`\s*\|\s*`(#[0-9a-fA-F]{6})`\s*\|/gm)) {
    palette[match[1]] = match[2].toLowerCase();
  }

  const required = [
    "backgroundDeep", "backgroundNavy", "panel",
    "accentCyan", "accentCyanGlow", "headline", "bodyText", "mutedText",
  ];
  const missing = required.filter((k) => !palette[k]);
  if (missing.length) {
    throw new Error(`social palette parse found no value for: ${missing.join(", ")}`);
  }

  const out = {
    ...stamp({ modules: ["docs/social-image-system/social-image-style-guide.md"] }),
    note:
      "HUD palette copied into src/serve/ui.js so the dashboard reads as the same " +
      "product as the social surfaces. Parsed from the style guide, never transcribed.",
    palette: Object.fromEntries(required.map((k) => [k, palette[k]])),
  };

  await writeFile(path.join(here, "fixtures", "website-social-palette.json"), `${JSON.stringify(out, null, 2)}\n`);
  return "fixtures/website-social-palette.json";
}

// The engine copy runs FIRST and its provenance is threaded into the parity
// fixture, so the two can never describe different revisions of the same file.
const engineCopy = await syncCheckerEngine();

const written = [
  `${engineCopy.file} (verbatim ${engineCopy.module}, sha256 ${engineCopy.sha256.slice(0, 12)}…)`,
  await syncBandsParity(),
  await syncEngineParity(engineCopy),
  await syncCatalogSnapshot(),
  await syncDesignTokens(),
  await syncSocialPalette(),
];
for (const line of written) process.stdout.write(`wrote ${line}\n`);
