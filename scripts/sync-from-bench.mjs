#!/usr/bin/env node
//
// Regenerate everything this package copies from opensourcesai-bench:
//
//   src/derive/bench-environment.generated.js — the runtime-environment
//     declaration module, copied verbatim
//   fixtures/bench-environment-parity.json    — pins that copy by digest, and
//     the façade over it by executed samples
//
// Run it from a machine that has BOTH repositories checked out:
//
//   node scripts/sync-from-bench.mjs ../opensourcesai-bench
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

const copy = await syncEnvironmentModule();
const written = [
  `${copy.file} (verbatim ${copy.module}, sha256 ${copy.sha256.slice(0, 12)}…)`,
  await syncEnvironmentParity(copy),
];
for (const line of written) process.stdout.write(`wrote ${line}\n`);
