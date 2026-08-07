#!/usr/bin/env node
//
// Regenerate everything this package copies from opensourcesai-bench:
//
//   src/derive/bench-environment.generated.js   — the runtime-environment
//     declaration module, copied verbatim
//   src/derive/bench-gpu-bandwidth.generated.js — the bandwidth matcher,
//     copied verbatim (see THE PAIR below)
//   data/gpu-memory-bandwidth-v1.js             — the manufacturer-sourced
//     bandwidth table the matcher imports; the filename is LOAD-BEARING
//   data/bench-roofline-limits.json             — the roofline's caveats,
//     executed out of bench's protocol module
//   fixtures/bench-environment-parity.json      — digest + executed samples
//   fixtures/bench-gpu-bandwidth-parity.json    — digests + executed samples
//
// Run it from a machine that has BOTH repositories checked out:
//
//   node scripts/sync-from-bench.mjs ../opensourcesai-bench
//
// THE PAIR. Bench's matcher module imports its table by a fixed relative path —
// `../../data/gpu-memory-bandwidth-v1.js` — so the two are copied TOGETHER,
// preserving both the matcher's depth (src/derive/, two levels below the repo
// root, same as bench's src/derivation/) and the table's exact filename under
// data/. That is what lets the matcher stay byte-exact: its import resolves in
// this repository BY CONSTRUCTION, with no rewriting — and a structural test
// asserts the resolution rather than trusting this comment. The table carries
// citation URLs (manufacturer spec pages, archive snapshots): provenance DATA,
// never fetched. It lives under data/, and the no-transmission guards police
// src/, where code that could fetch lives.
//
// WHY A VERBATIM GENERATED COPY (the sync-from-website.mjs mechanism, applied
// to the second companion repo). The engine-drift episode proved that the
// weak link in a fixture-pinned copy is the HAND-PORT step: the fixture
// regenerates mechanically, but carrying the change into the copy was a
// separate human act, and for six hours nobody did. Bench's environment
// module is the same class of shared truth — its variable allowlist and
// comparability rules decide which measurements may ever sit side by side —
// so it gets the same treatment from day one rather than after its own
// incident. The digest is the pin; the only human act is running this script.
//
// The two sync scripts deliberately share their mechanism by CONVENTION, not
// by a shared helper: each is a self-contained ~page a reviewer can read top
// to bottom, and the digest/marker/normalize logic is small enough that a
// shared module would cost more indirection than it saves. If the mechanism
// itself ever changes, change BOTH — the parity tests will catch a miss.

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const benchRoot = path.resolve(process.argv[2] ?? "../opensourcesai-bench");
const here = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");

const importFromBench = (relative) =>
  import(pathToFileURL(path.join(benchRoot, relative)).href);

/** The bench module this package runs as its environment-declaration engine. */
const ENVIRONMENT_MODULE = "src/derivation/environment.js";
const ENVIRONMENT_TARGET = path.join("src", "derive", "bench-environment.generated.js");

/** Same marker and normalization contract as sync-from-website.mjs. */
const VERBATIM_MARKER = "// @generated:begin-verbatim";
const normalizeEol = (text) => text.replace(/\r\n/g, "\n");

async function benchVersion() {
  const pkg = JSON.parse(await readFile(path.join(benchRoot, "package.json"), "utf8"));
  return pkg.version ?? null;
}

async function syncEnvironmentModule() {
  const source = normalizeEol(await readFile(path.join(benchRoot, ENVIRONMENT_MODULE), "utf8"));

  if (source.includes(VERBATIM_MARKER)) {
    throw new Error(`${ENVIRONMENT_MODULE} contains the verbatim marker; the split would be ambiguous`);
  }
  // The copy must stay standalone — same rule, same reason as the checker
  // engine: an import upstream means the sharing arrangement needs revisiting,
  // not working around.
  const imports = source.match(/^\s*import\s.+$/gm);
  if (imports) {
    throw new Error(
      `${ENVIRONMENT_MODULE} now imports (${imports.length}): a verbatim copy would not resolve here. ` +
        "Revisit how the module is shared before re-running this script.",
    );
  }

  const sha256 = createHash("sha256").update(source).digest("hex");
  const copiedAt = new Date().toISOString().slice(0, 10);
  const version = await benchVersion();

  const header = `// GENERATED FILE — DO NOT EDIT. Re-run the sync script instead.
//
// A byte-exact copy of opensourcesai-bench's ${ENVIRONMENT_MODULE}. This
// package keeps a hard boundary with the bench repository and never imports
// across it; the module is copied instead, and this file is that copy.
//
// WHAT THIS MODULE IS, AND WHY IT IS SHARED VERBATIM
// It is the single definition of which Ollama server settings change what a
// measurement MEANS: the allowlisted variables, whether each is captured by
// value or by presence (§9 of the bench protocol — path-like and address-like
// values never leave the machine), and the comparability verdict two runs get
// (comparable / advisory / incomparable / unknown). Command Center uses it to
// stamp its own measurement records and to refuse side-by-side rendering of
// results whose run conditions differ. Two repos re-deriving those rules
// independently would eventually disagree about which comparisons are honest —
// the exact failure class the verbatim-copy mechanism exists to close.
//
//   source      opensourcesai-bench ${ENVIRONMENT_MODULE} (client ${version ?? "unknown"})
//   sha256      ${sha256}
//   copied      ${copiedAt}
//   regenerate  node scripts/sync-from-bench.mjs ../opensourcesai-bench
//
// The digest covers everything below the marker — the upstream bytes,
// LF-normalized — and test/environment.test.js recomputes it, so an edit here
// fails the suite instead of quietly forking the rules.
${VERBATIM_MARKER}
`;

  await writeFile(path.join(here, ENVIRONMENT_TARGET), header + source);
  return { module: ENVIRONMENT_MODULE, file: ENVIRONMENT_TARGET.replace(/\\/g, "/"), sha256, copiedAt, version };
}

/**
 * Pin behaviour by executing bench's own module — the same dual-role fixture
 * arrangement as website-engine-parity.json: the digest proves the copy is the
 * file; the executed samples prove the FAÇADE (src/derive/environment.js)
 * delegates to it rather than quietly reimplementing a piece.
 */
async function syncEnvironmentParity(copy) {
  const env = await importFromBench(ENVIRONMENT_MODULE);

  // Synthetic environments chosen to exercise every capture rule: a value
  // variable, a presence-only variable (whose value must NEVER appear), an
  // empty string (normalizes to unset), and untouched defaults.
  const ENVIRONMENTS = {
    "empty": {},
    "kv-q8": { OLLAMA_KV_CACHE_TYPE: "q8_0" },
    "kv-f16-flash": { OLLAMA_KV_CACHE_TYPE: "f16", OLLAMA_FLASH_ATTENTION: "true" },
    "models-path-set": { OLLAMA_MODELS: "/somewhere/that/must/not/leak" },
    "models-path-other": { OLLAMA_MODELS: "/a/different/private/path" },
    "empty-string-unsets": { OLLAMA_KV_CACHE_TYPE: "   " },
    "advisory-only": { OLLAMA_KEEP_ALIVE: "24h" },
  };

  const declarations = Object.fromEntries(
    Object.entries(ENVIRONMENTS).map(([name, raw]) => [name, env.deriveRuntimeEnvironment(raw)]),
  );

  // Verdict matrix over the interesting pairs — one of each outcome, including
  // the presence-only property: two different private paths must compare as
  // COMPARABLE because only presence was ever captured.
  const PAIRS = [
    ["empty", "empty"],
    ["empty", "kv-q8"],
    ["kv-q8", "kv-f16-flash"],
    ["models-path-set", "models-path-other"],
    ["empty", "advisory-only"],
    ["empty", "empty-string-unsets"],
  ];
  const verdicts = Object.fromEntries(
    PAIRS.map(([a, b]) => {
      const result = env.compareRuntimeEnvironments(declarations[a], declarations[b]);
      return [`${a}|${b}`, { verdict: result.verdict, comparable: result.comparable, differences: result.differences.length }];
    }),
  );
  // The unknown branch: a record with no declaration at all.
  const unknown = env.compareRuntimeEnvironments(null, declarations.empty);
  verdicts["null|empty"] = { verdict: unknown.verdict, comparable: unknown.comparable, differences: unknown.differences.length };

  const out = {
    source: {
      repository: "opensourcesai-bench",
      generatedBy: "scripts/sync-from-bench.mjs",
      generatedAt: new Date().toISOString().slice(0, 10),
      modules: [ENVIRONMENT_MODULE],
      benchClientVersion: copy.version,
    },
    generatedCopy: {
      file: copy.file,
      sourceModule: ENVIRONMENT_MODULE,
      algorithm: "sha256",
      sha256: copy.sha256,
      note:
        "Digest of the upstream file, LF-normalized — i.e. of everything below the " +
        "@generated:begin-verbatim marker in the copy. Recomputed by test/environment.test.js.",
    },
    ENVIRONMENT_DECLARATION_SOURCE: env.ENVIRONMENT_DECLARATION_SOURCE,
    variableCount: env.OLLAMA_ENVIRONMENT_VARIABLES.length,
    variableNames: env.OLLAMA_ENVIRONMENT_VARIABLES.map((v) => v.name),
    presenceOnlyVariables: env.OLLAMA_ENVIRONMENT_VARIABLES
      .filter((v) => v.capture === "presence")
      .map((v) => v.name),
    blockingVariables: env.OLLAMA_ENVIRONMENT_VARIABLES
      .filter((v) => v.comparability === "blocking")
      .map((v) => v.name),
    declarations,
    verdicts,
  };

  await writeFile(
    path.join(here, "fixtures", "bench-environment-parity.json"),
    `${JSON.stringify(out, null, 2)}\n`,
  );
  return "fixtures/bench-environment-parity.json";
}

// --- the bandwidth pair + roofline limits ------------------------------------

const MATCHER_MODULE = "src/derivation/gpu-bandwidth.js";
const MATCHER_TARGET = path.join("src", "derive", "bench-gpu-bandwidth.generated.js");
/** The matcher's own import specifier — the reason this filename cannot change. */
const TABLE_IMPORT_SPECIFIER = "../../data/gpu-memory-bandwidth-v1.js";
const TABLE_MODULE = "data/gpu-memory-bandwidth-v1.js";
const TABLE_TARGET = path.join("data", "gpu-memory-bandwidth-v1.js");
const PROTOCOL_MODULE = "src/protocol.js";

/**
 * Copy the matcher/table pair. Verbatim both, with the pair-specific guard:
 * the matcher is allowed EXACTLY ONE import — the table, by the specifier that
 * resolves here by construction. Any other import upstream means the sharing
 * arrangement needs revisiting, not working around.
 */
async function syncBandwidthPair() {
  const version = await benchVersion();
  const copiedAt = new Date().toISOString().slice(0, 10);

  const matcherSource = normalizeEol(await readFile(path.join(benchRoot, MATCHER_MODULE), "utf8"));
  const tableSource = normalizeEol(await readFile(path.join(benchRoot, TABLE_MODULE), "utf8"));

  for (const [name, source] of [[MATCHER_MODULE, matcherSource], [TABLE_MODULE, tableSource]]) {
    if (source.includes(VERBATIM_MARKER)) {
      throw new Error(`${name} contains the verbatim marker; the split would be ambiguous`);
    }
  }
  const matcherImports = matcherSource.match(/^\s*import\s.+$/gm) ?? [];
  const onlyTableImport =
    matcherImports.length === 1 && matcherImports[0].includes(`"${TABLE_IMPORT_SPECIFIER}"`);
  if (!onlyTableImport) {
    throw new Error(
      `${MATCHER_MODULE} no longer imports exactly ["${TABLE_IMPORT_SPECIFIER}"]: ` +
        `found ${JSON.stringify(matcherImports)}. The pair copy resolves by construction only ` +
        "for that one specifier — revisit how the matcher is shared before re-running.",
    );
  }
  if (tableSource.match(/^\s*import\s.+$/gm)) {
    throw new Error(`${TABLE_MODULE} now imports: a verbatim copy would not resolve here.`);
  }

  const matcherSha = createHash("sha256").update(matcherSource).digest("hex");
  const tableSha = createHash("sha256").update(tableSource).digest("hex");

  const matcherHeader = `// GENERATED FILE — DO NOT EDIT. Re-run the sync script instead.
//
// A byte-exact copy of opensourcesai-bench's ${MATCHER_MODULE}. Its one import
// — "${TABLE_IMPORT_SPECIFIER}" — resolves in this repository by construction,
// because the table is copied alongside it under the same filename at the same
// relative depth. That is what lets this file stay verbatim: nothing is
// rewritten, so it can be verified by \`diff\` against the source.
//
// WHAT THIS MODULE IS. The single definition of how a detected GPU resolves to
// a manufacturer-sourced bandwidth figure: name normalization, VRAM-tolerance
// matching, ambiguity-is-unavailable, and the provenance bar an entry must
// clear before it may ever be used (manufacturer source + archive snapshot).
// It also carries the manual-override path — a caller-supplied figure wins and
// is recorded as source: "manual", never laundered into a table match. Bench
// and Command Center resolving bandwidth differently would mean the same GPU
// gets two different ceilings; sharing the module verbatim closes that.
//
//   source      opensourcesai-bench ${MATCHER_MODULE} (client ${version ?? "unknown"})
//   sha256      ${matcherSha}
//   copied      ${copiedAt}
//   regenerate  node scripts/sync-from-bench.mjs ../opensourcesai-bench
//
// The digest covers everything below the marker — the upstream bytes,
// LF-normalized — and test/bandwidth.test.js recomputes it.
${VERBATIM_MARKER}
`;

  const tableHeader = `// GENERATED FILE — DO NOT EDIT. Re-run the sync script instead.
// (Yes, even though this file is not named *.generated.js — the matcher module
// imports it by exactly this name, so the name is load-bearing and stays.)
//
// A byte-exact copy of opensourcesai-bench's ${TABLE_MODULE}: the
// manufacturer-sourced GPU memory-bandwidth table, provenance rules included.
// Entries exist only where a manufacturer source with an archive snapshot
// exists — an absent entry deliberately makes roofline utilization read
// "unavailable" rather than inviting a guess, and figures from memory,
// secondary databases, or bus-width arithmetic are refused upstream by policy.
//
// The citation URLs below are PROVENANCE DATA, never fetched. Nothing in this
// package makes an outbound call — the no-transmission guards over src/ are
// unaffected by data that merely records where a number came from.
//
//   source      opensourcesai-bench ${TABLE_MODULE} (client ${version ?? "unknown"})
//   sha256      ${tableSha}
//   copied      ${copiedAt}
//   regenerate  node scripts/sync-from-bench.mjs ../opensourcesai-bench
//
// The digest covers everything below the marker — the upstream bytes,
// LF-normalized — and test/bandwidth.test.js recomputes it.
${VERBATIM_MARKER}
`;

  await writeFile(path.join(here, MATCHER_TARGET), matcherHeader + matcherSource);
  await writeFile(path.join(here, TABLE_TARGET), tableHeader + tableSource);
  return {
    version,
    copiedAt,
    matcher: { module: MATCHER_MODULE, file: MATCHER_TARGET.replace(/\\/g, "/"), sha256: matcherSha },
    table: { module: TABLE_MODULE, file: TABLE_TARGET.replace(/\\/g, "/"), sha256: tableSha },
  };
}

/**
 * The roofline's caveats, executed out of bench's protocol module and committed
 * as a data snapshot (the checker-catalog arrangement: provenance-stamped,
 * refreshed by rerunning this script). They are not optional decoration — a
 * utilization figure shown without them overclaims, so the UI that renders one
 * renders these.
 */
async function syncRooflineLimits(pair) {
  const protocol = await importFromBench(PROTOCOL_MODULE);
  const limits = protocol.ROOFLINE_LIMITS;
  if (!Array.isArray(limits) || limits.length === 0 || !limits.every((l) => typeof l === "string")) {
    throw new Error("bench ROOFLINE_LIMITS is not a non-empty array of strings; refusing to snapshot it");
  }
  const out = {
    source: {
      repository: "opensourcesai-bench",
      generatedBy: "scripts/sync-from-bench.mjs",
      generatedAt: new Date().toISOString().slice(0, 10),
      modules: [PROTOCOL_MODULE],
      benchClientVersion: pair.version,
      protocolVersion: protocol.PROTOCOL_VERSION,
    },
    note:
      "Committed snapshot of bench's ROOFLINE_LIMITS. A roofline-utilization figure " +
      "rendered without these caveats overclaims; any surface that shows one shows these.",
    limits,
  };
  await writeFile(path.join(here, "data", "bench-roofline-limits.json"), `${JSON.stringify(out, null, 2)}\n`);
  return "data/bench-roofline-limits.json";
}

/**
 * Pin the pair's behaviour by executing bench's own matcher — digests prove
 * the copies are the files; these samples prove the façade delegates.
 */
async function syncBandwidthParity(pair, rooflineFile) {
  const bandwidth = await importFromBench(MATCHER_MODULE);
  const MIB = 1024 ** 2;

  // Samples chosen to exercise every resolution rule: both owned rigs (one at
  // nominal VRAM, one at the real under-reported figure inside tolerance), a
  // VRAM mismatch that must refuse, name normalization, an unknown GPU, and
  // the manual override beating a matchable table entry.
  const CASES = {
    "rtx-3080-nominal": { model: "NVIDIA GeForce RTX 3080", totalVramBytes: 10240 * MIB },
    "rtx-4070-ti-real-vram": { model: "NVIDIA GeForce RTX 4070 Ti", totalVramBytes: 12282 * MIB },
    "rtx-3080-wrong-vram": { model: "NVIDIA GeForce RTX 3080", totalVramBytes: 12288 * MIB },
    "name-normalized": { model: "  nvidia   geforce rtx 3080 ", totalVramBytes: 10240 * MIB },
    "unknown-gpu": { model: "Radeon RX 7900 XTX", totalVramBytes: 24576 * MIB },
    "no-gpu": { model: null, totalVramBytes: null },
    "manual-override-wins": { manualGBps: 999.5, model: "NVIDIA GeForce RTX 3080", totalVramBytes: 10240 * MIB },
  };
  const resolutions = Object.fromEntries(
    Object.entries(CASES).map(([name, inputs]) => [name, bandwidth.resolveGpuMemoryBandwidth(inputs)]),
  );

  const out = {
    source: {
      repository: "opensourcesai-bench",
      generatedBy: "scripts/sync-from-bench.mjs",
      generatedAt: new Date().toISOString().slice(0, 10),
      modules: [MATCHER_MODULE, TABLE_MODULE],
      benchClientVersion: pair.version,
    },
    generatedCopies: {
      matcher: { file: pair.matcher.file, sourceModule: pair.matcher.module, algorithm: "sha256", sha256: pair.matcher.sha256 },
      table: { file: pair.table.file, sourceModule: pair.table.module, algorithm: "sha256", sha256: pair.table.sha256 },
      note:
        "Digests of the upstream files, LF-normalized — i.e. of everything below the " +
        "@generated:begin-verbatim marker in each copy. Recomputed by test/bandwidth.test.js.",
    },
    tableSchemaVersion: bandwidth.GPU_MEMORY_BANDWIDTH_TABLE.schemaVersion,
    entryIds: bandwidth.GPU_MEMORY_BANDWIDTH_TABLE.entries.map((e) => e.id),
    rooflineLimitsFile: rooflineFile,
    resolutions,
  };
  await writeFile(
    path.join(here, "fixtures", "bench-gpu-bandwidth-parity.json"),
    `${JSON.stringify(out, null, 2)}\n`,
  );
  return "fixtures/bench-gpu-bandwidth-parity.json";
}

const copy = await syncEnvironmentModule();
const pair = await syncBandwidthPair();
const rooflineFile = await syncRooflineLimits(pair);
const written = [
  `${copy.file} (verbatim ${copy.module}, sha256 ${copy.sha256.slice(0, 12)}…)`,
  await syncEnvironmentParity(copy),
  `${pair.matcher.file} (verbatim ${pair.matcher.module}, sha256 ${pair.matcher.sha256.slice(0, 12)}…)`,
  `${pair.table.file} (verbatim ${pair.table.module}, sha256 ${pair.table.sha256.slice(0, 12)}…)`,
  rooflineFile,
  await syncBandwidthParity(pair, rooflineFile),
];
for (const line of written) process.stdout.write(`wrote ${line}\n`);
