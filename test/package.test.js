import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { CLIENT_VERSION } from "../src/version.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(directory, entry.name);
      return entry.isDirectory() ? sourceFiles(full) : [full];
    }),
  );
  return nested.flat().filter((f) => f.endsWith(".js"));
}

test("package is executable, runtime-dependency-free, and version-aligned", async () => {
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  assert.equal(pkg.name, "@opensourcesai/cmdcenter");
  assert.equal(pkg.version, CLIENT_VERSION);
  assert.equal(pkg.bin["osai-cmdcenter"], "src/cli.js");
  assert.equal(pkg.engines.node, ">=20");
  assert.equal(pkg.dependencies, undefined, "runtime dependencies need explicit justification");
  assert.deepEqual(
    Object.keys(pkg.devDependencies || {}).sort(),
    ["@tailwindcss/cli", "tailwindcss"],
    "only the approved local theme compiler may be installed for development",
  );
  assert.match(pkg.devDependencies.tailwindcss, /^\^4\./, "the theme compiler must stay on Tailwind v4");
  assert.match(pkg.devDependencies["@tailwindcss/cli"], /^\^4\./, "the theme CLI must stay on Tailwind v4");
});

// PUBLISH GUARD, REWRITTEN AT ITS SECOND CROSSING — never deleted. Until
// 2026-08-10 this test asserted `private: true` (the deliberate-unpublished
// state the discovery spec chose); the publish decision was taken that day
// with Phase 3d complete, and the guard now asserts the SUCCESSOR
// properties: the package publishes publicly WITH provenance attestation,
// which structurally forces every release through CI (npm refuses
// provenance from a laptop) — a release stays a considered action, enforced
// by mechanism rather than by a flag. The workflow's existence is asserted
// so the only publish path cannot quietly disappear.
test("publishing carries provenance and only CI can do it", async () => {
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  assert.equal(pkg.private, undefined, "the publish decision was recorded 2026-08-10; private:true must not return silently");
  assert.equal(pkg.publishConfig.access, "public");
  assert.equal(pkg.publishConfig.provenance, true, "provenance is what pins releases to CI");
  const workflow = await readFile(path.join(root, ".github", "workflows", "release.yml"), "utf8");
  assert.match(workflow, /id-token:\s*write/, "provenance needs the OIDC token");
  assert.match(workflow, /npm publish/, "the release workflow must be the thing that publishes");
  assert.match(workflow, /node --test|npm (run )?test|npm run check/, "no publish without the suite");
});

// TRUST PROPERTY 1 — NO TRANSMISSION.
// The tool asks people to run it against their own machine. An audit must find
// zero outbound calls. Network access exists in exactly one module and is
// pinned to loopback; everywhere else it is absent by construction.
// The two files permitted to reach the network, both talking only to Ollama.
// An allowlist rather than a blanket exemption: adding a third has to be a
// deliberate edit to this list, which is the point.
const NETWORK_CAPABLE = [
  path.join("collect", "ollama.js"),
  path.join("collect", "telemetry.js"),
  path.join("actions", "ollama.js"),
  // The inference surface (MAINTAINING §4b): the relays stream to the local
  // runtimes (Ollama's /api/chat, an OpenAI-compatible /v1/chat/completions),
  // the service validates against their model lists. Loopback like every
  // other entry — the URL guard below still binds all three, and openai.js
  // additionally contains no URL literal at all: its endpoint is built from a
  // CLI-supplied port.
  path.join("chat", "ollama.js"),
  path.join("chat", "openai.js"),
  path.join("chat", "service.js"),
];

test("network access exists only in the Ollama collectors", async () => {
  const files = await sourceFiles(path.join(root, "src"));

  for (const file of files) {
    const source = await readFile(file, "utf8");
    if (NETWORK_CAPABLE.some((allowed) => file.endsWith(allowed))) continue;

    // serve/ui*.js is BROWSER code carried as strings. Its fetches run in the
    // user's browser against this same server, which is a different thing from
    // the Node process reaching the network — it has its own stricter rule,
    // asserted below over the COMPOSED bundle so every UI module is covered.
    if (/serve[\\/]ui[^\\/]*\.js$/.test(file)) continue;

    assert.doesNotMatch(
      source,
      /\bfetch\s*\(|\bhttp\.request|\bhttps\.request|XMLHttpRequest|WebSocket/,
      `unexpected network call in ${path.relative(root, file)}`,
    );
  }
});

// THE PROPERTY THAT ACTUALLY MATTERS, and it is stronger than the file
// allowlist above: no source file may contain an absolute URL pointing anywhere
// other than loopback. `collect/telemetry.js` builds its request from a host
// passed in by the caller and contains no URL literal of its own, so this is
// what proves the whole package can only ever talk to this machine.
test("every absolute URL in the package points at loopback", async () => {
  const files = await sourceFiles(path.join(root, "src"));
  let found = 0;

  for (const file of files) {
    // Comments stripped, strings kept — a comment discussing `http://0.0.0.0`
    // as a bug is documentation, not an outbound call. Fourth instance of this
    // repo's prose-versus-code trap; see withoutComments() above.
    const source = withoutComments(await readFile(file, "utf8"));
    for (const match of source.matchAll(/https?:\/\/[^\s"'`)]+/g)) {
      const url = match[0];
      found += 1;
      assert.match(
        url,
        // `${BIND_ADDRESS}` is permitted as a loopback form because the very
        // next assertion proves that constant IS the loopback literal — an
        // allowance grounded in a check, not in a comment claiming it is fine.
        /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]|\$\{BIND_ADDRESS\})(:|\/|$)/,
        `${path.relative(root, file)} contains a non-loopback URL: ${url}`,
      );
    }
  }
  assert.ok(found > 0, "expected at least one loopback URL — otherwise this guard is vacuous");

  // Grounds the ${BIND_ADDRESS} allowance above. If the server ever bound to
  // 0.0.0.0, the URL guard would still pass on the template — this is what
  // catches it.
  const { BIND_ADDRESS } = await import("../src/serve/server.js");
  assert.equal(BIND_ADDRESS, "127.0.0.1", "the server must bind loopback only");

  const { DEFAULT_OLLAMA_HOST } = await import("../src/collect/ollama.js");
  assert.match(DEFAULT_OLLAMA_HOST, /^http:\/\/127\.0\.0\.1:\d+$/);
});

test("the browser bundle only ever talks to its own origin", async () => {
  // Scans the COMPOSED served assets, not a source file (changed when the
  // first UI module split out of ui.js): everything asserted here binds every
  // module concatenated into the bundle, present and future, because it is
  // the exact string a browser receives.
  const { JS, CSS } = await import("../src/serve/ui.js");
  const source = JS + CSS;

  // No absolute URL of any kind: every request target must be a same-origin
  // relative path. This is the property that makes the browser side incapable
  // of exfiltrating machine data, and it is enforced again at runtime by the
  // `connect-src 'self'` CSP.
  assert.doesNotMatch(source, /https?:\/\//, "the UI must contain no absolute URL");

  const targets = [...source.matchAll(/fetch\(\s*"([^"]*)"/g)].map((m) => m[1]);
  assert.ok(targets.length > 0, "expected at least one fetch — otherwise this guard is vacuous");
  for (const target of targets) {
    assert.match(target, /^\/[a-z/-]*$/, `fetch target must be a same-origin path, got: ${target}`);
  }

  // The page must not be able to open a socket or a worker either.
  assert.doesNotMatch(source, /WebSocket|EventSource|new Worker|importScripts|sendBeacon/);
});

/**
 * Strip comments and string literals so a guard inspects CODE rather than
 * prose. Without this, documenting *why* there is no telemetry trips the guard
 * that checks there is no telemetry — a false positive that would train the
 * next person to delete the guard rather than trust it.
 */
/**
 * Strip comments only, KEEPING string literals.
 *
 * Distinct from codeOnly() on purpose. A URL guard must still see
 * `"http://127.0.0.1:11434"` — that string ships and is the thing being
 * verified — while ignoring a comment that merely *discusses* an address. Using
 * codeOnly() here would delete the only real URL and leave the guard vacuously
 * passing, which is why it asserts it found at least one.
 */
function withoutComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function codeOnly(source) {
  return withoutComments(source)
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""');
}

// NOTE ON THE WORD "TELEMETRY". This guard originally forbade it outright,
// which broke the moment local hardware counters arrived — `collectTelemetry`
// reads this machine's own GPU and CPU and sends nothing anywhere, the exact
// opposite of the phone-home sense the guard was written for. Two unrelated
// meanings, one word. The word itself is therefore not the check; the
// no-outbound-URL and network-allowlist guards above are, and this one names
// the vendors and mechanisms that actually indicate exfiltration.
test("no analytics, crash-reporting, or update-check surface exists anywhere", async () => {
  const files = await sourceFiles(path.join(root, "src"));
  for (const file of files) {
    const code = codeOnly(await readFile(file, "utf8"));
    assert.doesNotMatch(
      code,
      /\b(analytics|gtag|dataLayer|sentry|posthog|mixpanel|amplitude|segment|crashReport|sendBeacon|checkForUpdate|phoneHome)\b/i,
      `exfiltration-adjacent identifier in ${path.relative(root, file)}`,
    );
  }
});

test("the comment stripper used by these guards actually works", () => {
  // A guard built on a helper is only as trustworthy as the helper, so the
  // helper gets its own test rather than being assumed correct.
  assert.doesNotMatch(codeOnly("// telemetry is deliberately absent"), /telemetry/);
  assert.doesNotMatch(codeOnly("/* analytics discussion */"), /analytics/);
  assert.doesNotMatch(codeOnly('const s = "telemetry";'), /telemetry/);
  assert.match(codeOnly("const telemetry = 1; // note"), /telemetry/);
  // A URL inside code must survive: "//" in https:// is not a line comment.
  assert.match(codeOnly('fetch(x); // c'), /fetch/);
});

// TRUST PROPERTY 2 — A NARROW, ENUMERATED MUTATION SURFACE.
//
// This guard used to assert absolute read-only. Phase 2 deliberately opened two
// actions (load, unload), so the absolute claim would now be false — and a
// guard asserting something false is worse than no guard. It is REPLACED, not
// relaxed: the destructive operations it existed to prevent are still named
// individually and still unreachable, and the mutation surface is confined to
// one directory. src/actions has its own dedicated suite in actions.test.js.
test("destructive Ollama operations are unreachable from anywhere", async () => {
  const files = await sourceFiles(path.join(root, "src"));
  for (const file of files) {
    // Comments stripped: src/actions/ollama.js documents precisely which
    // endpoints it must never call, and naming them in prose is exactly what
    // makes that file trustworthy. Fifth instance of this repo's
    // prose-versus-code trap — a guard must read code, never commentary.
    const source = withoutComments(await readFile(file, "utf8"));
    const relative = path.relative(root, file);
    // These endpoints download gigabytes or destroy data irreversibly. No
    // phase has opened them and none is planned.
    assert.doesNotMatch(source, /\/api\/(pull|push|delete|create|copy)\b/, `destructive API in ${relative}`);
    assert.doesNotMatch(source, /\bollama\s+(pull|rm|stop|serve|create|push)\b/, `destructive CLI call in ${relative}`);
    // PUT/PATCH/DELETE have no use here in any phase.
    assert.doesNotMatch(source, /method:\s*["'](PUT|PATCH|DELETE)["']/i, `write verb in ${relative}`);
  }
});

// THE ENGINE COPY ARRIVES WHOLE, AND TWO OF ITS FUNCTIONS MUST STAY UNREACHABLE.
//
// src/derive/checker-engine.generated.js is a verbatim copy of the website's
// engine — verbatim because that is what makes it checkable by `diff` rather
// than by judgement. The cost of copying it whole is that `scoreModel` (a
// composite 0–100 ranking whose weights are only defensible inside the website's
// surrounding copy) and `buildRationale` (that surface's prose, not this one's)
// come along. Neither may become reachable: this dashboard reports what fits and
// what it costs, and does not rank models.
//
// Deliberately a CODE scan. src/derive/fit.js explains at length which functions
// it refuses to re-export and why — a raw text match would flag the explanation
// and train the next person to delete the guard. Sixth instance of this repo's
// prose-versus-code trap.
test("the website's ranking and rationale functions are copied but unreachable", async () => {
  const files = await sourceFiles(path.join(root, "src"));
  const generated = path.join("derive", "checker-engine.generated.js");
  let scanned = 0;

  for (const file of files) {
    if (file.endsWith(generated)) continue;
    scanned += 1;
    const code = codeOnly(await readFile(file, "utf8"));
    const relative = path.relative(root, file);
    assert.doesNotMatch(code, /\bscoreModel\b/, `composite ranking reached from ${relative}`);
    assert.doesNotMatch(code, /\bbuildRationale\b/, `website rationale prose reached from ${relative}`);
  }
  assert.ok(scanned > 0, "no files scanned — this guard would be vacuous");

  // POSITIVE CONTROL. If the copy stopped containing these, the loop above would
  // pass while protecting against nothing at all — which is precisely how a
  // guard rots into decoration.
  const copy = await readFile(path.join(root, "src", generated), "utf8");
  assert.match(copy, /export function scoreModel\b/, "the copy should still carry scoreModel");
  assert.match(copy, /export function buildRationale\b/, "the copy should still carry buildRationale");
});

// A GENERATED FILE MUST SAY SO, EVERYWHERE IT COULD BE MISTAKEN FOR SOURCE.
// The digest tests catch an edit after the fact; this catches the likelier
// failure, which is somebody opening the file and not realising.
//
// The list below is the complete set of generated sources, each paired with
// the sync script that writes it. Naming the RIGHT script matters as much as
// naming one: regenerating a bench copy with the website script would fail
// confusingly rather than helpfully.
test("generated sources announce themselves and name their regeneration command", async () => {
  const generated = [
    [path.join(root, "src", "derive", "checker-engine.generated.js"), /scripts\/sync-from-website\.mjs/],
    [path.join(root, "src", "derive", "bench-environment.generated.js"), /scripts\/sync-from-bench\.mjs/],
    [path.join(root, "src", "derive", "bench-gpu-bandwidth.generated.js"), /scripts\/sync-from-bench\.mjs/],
    [path.join(root, "src", "serve", "theme.generated.js"), /npm run build:theme/],
    // Not named *.generated.js, deliberately: the matcher imports it by exactly
    // this name, so the name is load-bearing. It still must announce itself —
    // being listed here is what enforces that.
    [path.join(root, "data", "gpu-memory-bandwidth-v1.js"), /scripts\/sync-from-bench\.mjs/],
  ];
  for (const [file, regenerate] of generated) {
    const source = await readFile(file, "utf8");
    const relative = path.relative(root, file);
    assert.match(source, /DO NOT EDIT/, `${relative} must warn against hand edits`);
    assert.match(source, regenerate, `${relative} must name how to regenerate it`);
  }

  // Nothing may LOOK generated without being on the list above — a stray
  // *.generated.js with no digest pinning it would be exactly the unverified
  // copy this whole arrangement exists to prevent.
  const files = await sourceFiles(path.join(root, "src"));
  const listed = new Set(generated.map(([file]) => path.resolve(file)));
  for (const file of files) {
    if (file.endsWith(".generated.js")) {
      assert.ok(listed.has(path.resolve(file)), `${path.relative(root, file)} is generated-named but unlisted/unpinned`);
    }
  }
});

// NO USER-FACING SURFACE MAY CLAIM READ-ONLY.
//
// Phase 2 made that claim false, but it was asserted in five places — a badge,
// two lines of help text, a startup banner and a footer — and only the badge
// was visible in a screenshot. The suite happily passed the whole time, because
// a test can only protect a property someone remembered to restate.
//
// Comments and internal identifiers may still discuss read-only accurately
// (the JSON routes ARE read-only; actions are a separate surface). This guards
// the strings a USER reads.
test("no user-facing string still claims the tool is read-only", async () => {
  const files = await sourceFiles(path.join(root, "src"));
  for (const file of files) {
    const source = withoutComments(await readFile(file, "utf8"));
    const relative = path.relative(root, file);
    // Phrases that assert it TO A USER, rather than describing one subsystem.
    for (const claim of [/tool is read-only/i, /read-only dashboard/i, /read-only,/i, /">Read-only</]) {
      assert.doesNotMatch(source, claim, `stale read-only claim in ${relative}`);
    }
  }
});

// THE SECOND RETIRED BOUNDARY CLAIM, same mechanism as read-only above.
//
// The 2026-08-07 decision (MAINTAINING §4b) replaced "load / unload only" as
// the tool's headline with the successor guarantee — *talks only to AI
// runtimes on this machine, never to the internet* — because an inference
// surface is authorized. The old phrase was stated in a badge, a trust rail,
// the HUD mode line, the CLI help and the serve banner; each was rewritten,
// and this guard keeps the retired phrasing from quietly returning to any of
// them. (The action layer is still load/unload only, and comments may say so —
// this guards the strings a USER reads as a claim about the whole tool.)
test("no user-facing string still claims load-and-unload is the whole tool", async () => {
  const files = await sourceFiles(path.join(root, "src"));
  for (const file of files) {
    const source = withoutComments(await readFile(file, "utf8"));
    const relative = path.relative(root, file);
    for (const claim of [
      /Load \/ unload only/,
      /LOAD \/ UNLOAD ONLY/,
      /It can load and unload models\. It never pulls/,
      /The only things it changes are loading and unloading/,
    ]) {
      assert.doesNotMatch(source, claim, `retired boundary claim in ${relative}`);
    }
  }
});

// THE SUCCESSOR BOUNDARY MUST STAY STATED, not just enforced. The structural
// URL guard makes the property true; this keeps it VISIBLE — in the README a
// security-conscious user reads before running the tool, and in the badge the
// dashboard shows while it runs. A guarantee that silently stops being stated
// is halfway to being renegotiated.
test("the successor trust boundary is stated where users read it", async () => {
  const readme = await readFile(path.join(root, "README.md"), "utf8");
  assert.match(readme, /talks only to AI runtimes on this machine/i, "README must state the guarantee");
  assert.match(readme, /never to the internet/i);
  assert.match(readme, /permanently out of scope/i, "the cloud-endpoints exclusion must stay stated");

  const ui = await readFile(path.join(root, "src", "serve", "ui.js"), "utf8");
  assert.match(ui, /never to the internet/i, "the dashboard badge must state the guarantee");
});

test("POST exists only in the action, chat, and browser-bundle surfaces", async () => {
  const files = await sourceFiles(path.join(root, "src"));
  for (const file of files) {
    const relative = path.relative(root, file);
    // serve/ui*.js posts to THIS server, not to Ollama, and is constrained by
    // the same-origin rule asserted above. src/chat is the inference surface
    // opened by MAINTAINING §4b — its POSTs target loopback Ollama, bound by
    // the URL guard like everything else.
    if (
      relative.includes(path.join("src", "actions")) ||
      relative.includes(path.join("src", "chat")) ||
      /serve[\\/]ui[^\\/]*\.js$/.test(relative)
    ) continue;
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, /method:\s*["']POST["']/i, `unexpected POST in ${relative}`);
  }
});

// TRUST PROPERTY 3 — NO SHELL.
// Every child process runs through execFile with an argv array. A shell would
// reintroduce an injection surface that currently does not exist.
test("child processes never run through a shell", async () => {
  const files = await sourceFiles(path.join(root, "src"));
  for (const file of files) {
    const source = await readFile(file, "utf8");
    const relative = path.relative(root, file);

    // Deliberately NOT matching a bare /exec\s*\(/ — that also matches
    // RegExp.prototype.exec, which is legitimate and common here. Match the
    // synchronous child_process helpers by name instead.
    assert.doesNotMatch(source, /\b(execSync|spawnSync|execFileSync)\s*\(/, `sync shell exec in ${relative}`);
    assert.doesNotMatch(source, /shell:\s*true/, `shell:true in ${relative}`);

    // The real containment property: only exec.js may import child_process at
    // all, so every spawn in the package goes through its argv-array wrapper.
    if (!file.endsWith(path.join("collect", "exec.js"))) {
      assert.doesNotMatch(source, /child_process/, `process spawning outside exec.js in ${relative}`);
    }
  }
});

// DETERMINISM — the derive layer must be snapshot-testable and comparable
// across runs, which it cannot be if anything in it reads a clock or a random
// source. Timestamps are caller-supplied from the CLI's top level only.
//
// src/storage holds the same line for a different reason: what lands on disk
// must be exactly what the caller handed over, so a stored record can be
// traced to the code path that produced its every field. A storage layer that
// stamps its own times is a storage layer whose tests need a clock.
test("the derive and storage layers never read a clock or a random source", async () => {
  const files = [
    ...(await sourceFiles(path.join(root, "src", "derive"))),
    ...(await sourceFiles(path.join(root, "src", "storage"))),
  ];
  assert.ok(files.length > 0);
  for (const file of files) {
    const source = await readFile(file, "utf8");
    const relative = path.relative(root, file);
    assert.doesNotMatch(source, /Date\.now\(\)|new Date\(\)/, `clock read in ${relative}`);
    assert.doesNotMatch(source, /Math\.random/, `randomness in ${relative}`);
  }
});

// FILE MUTATION EXISTS ONLY IN THE STORAGE LAYER.
//
// Until 2026-08-07 this package wrote nothing to disk at all, which was itself
// a trust property. Adding retained history narrows that property rather than
// abandoning it: every write and every deletion now lives in src/storage,
// confined to the tool's own data directory — and this guard is what keeps
// "the storage layer is where files change" from decaying into "files change
// wherever it was convenient". Comments stripped, strings kept: prose about
// writing must not trip a guard about writing, but a call that ships must.
test("file writes and deletions exist only in src/storage", async () => {
  const files = await sourceFiles(path.join(root, "src"));
  const MUTATION = /\b(writeFile|appendFile|mkdir|rmdir|unlink|rename|copyFile|truncate|createWriteStream|rm|writev)(Sync)?\s*\(/;
  let storageMutations = 0;

  for (const file of files) {
    const source = withoutComments(await readFile(file, "utf8"));
    const relative = path.relative(root, file);
    if (relative.includes(path.join("src", "storage"))) {
      if (MUTATION.test(source)) storageMutations += 1;
      continue;
    }
    assert.doesNotMatch(source, MUTATION, `file mutation outside the storage layer in ${relative}`);
  }

  // Positive control: if the storage layer stopped mutating files, this guard
  // would pass while guarding nothing.
  assert.ok(storageMutations > 0, "expected the storage layer itself to write — otherwise this guard is vacuous");
});

// THE STORAGE LAYER IS NOT YET REACHABLE FROM ANY ENTRY POINT.
//
// Deliberate, and temporary by design: retained history changes what a user
// should expect this tool to keep, so the surface that first writes it must
// arrive together with the UI that shows it, the control that deletes it, and
// rewritten user-facing claims — the phase-2 lesson, applied in advance this
// time. Until that deliberate act, the CLI help and dashboard badge stay
// literally true: nothing the tool currently does persists anything. When
// wiring lands, REWRITE this guard to assert the narrower property that
// replaces it (only the serve layer may reach storage, or whatever the wiring
// decides) — do not delete it.
// REWRITTEN, NOT DELETED, when the wiring landed — exactly as the previous
// version of this guard instructed. Until 2026-08-08 nothing reached storage;
// the chat surface (MAINTAINING §4b) now does, arriving together with the UI
// that shows retained data, the delete-with-confirm control, and the rewritten
// user-facing claims — the package deal §4a demanded. The narrower property
// that replaces "unreachable": ONLY the chat surface and the CLI's wiring seam
// may reach storage. Collect must never read what the tool remembers into a
// capture; derive stays pure; serve touches storage only through the injected
// chat service, never directly.
test("only the chat surface and the CLI wiring may reach the storage layer", async () => {
  const files = await sourceFiles(path.join(root, "src"));
  const allowed = (relative) =>
    relative.includes(path.join("src", "chat")) || relative.endsWith(path.join("src", "cli.js"));
  let reached = 0;

  for (const file of files) {
    const relative = path.relative(root, file);
    if (relative.includes(path.join("src", "storage"))) continue;
    const source = await readFile(file, "utf8");
    const imports = /from\s+["'][^"']*\/storage\//.test(source);
    if (allowed(relative)) {
      if (imports) reached += 1;
      continue;
    }
    assert.doesNotMatch(
      source,
      /from\s+["'][^"']*\/storage\//,
      `${relative} reaches the storage layer — only src/chat and the CLI wiring may`,
    );
  }
  // Positive control: if the allowlisted importers stopped importing, this
  // guard would pass while guarding a wiring that no longer exists.
  assert.ok(reached > 0, "expected the chat surface to actually reach storage — otherwise this guard is vacuous");
});

// HARD REPO BOUNDARY — this package never imports from the website. The two
// are joined only by versioned contracts and the parity fixture.
test("nothing imports from the website repository", async () => {
  const files = await sourceFiles(path.join(root, "src"));

  // Inspect IMPORT SPECIFIERS, not raw file text. Matching the bare string
  // "opensourcesai.com" would flag the provenance comment in derive/bands.js,
  // which documents where the fixture-verified copy came from — the guard has
  // to test the coupling itself, not any mention of it.
  //
  // Comments stripped before extraction (added 2026-08-07, the SEVENTH
  // instance of the prose-versus-code trap): the specifier pattern spans
  // lazily from any `export` keyword to the next `from "..."`, and a comment
  // containing the words `from "anything quoted"` — which is how a sentence
  // discussing an inference "from \"clocks below max\"" reads — was captured
  // as an import specifier. The guard was flagging prose about throttling as
  // a cross-repo import.
  const specifierPattern = /(?:^|\s)(?:import|export)[\s\S]*?from\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']/g;

  for (const file of files) {
    const source = withoutComments(await readFile(file, "utf8"));
    const relative = path.relative(root, file);
    for (const match of source.matchAll(specifierPattern)) {
      const specifier = match[1] ?? match[2];
      assert.doesNotMatch(
        specifier,
        /opensourcesai|next\/|^react$|\.\.\/\.\.\/\.\./,
        `${relative} imports across the repo boundary: ${specifier}`,
      );
      // Every import must be a node: builtin or a relative path inside src —
      // there are no dependencies, so anything else is a mistake.
      assert.ok(
        specifier.startsWith("node:") || specifier.startsWith("."),
        `${relative} imports a non-builtin, non-relative module: ${specifier}`,
      );
    }
  }
});

test("workflows exist and reference no stored registry credential", async () => {
  const dir = path.join(root, ".github", "workflows");
  const names = (await readdir(dir)).filter((n) => n.endsWith(".yml") || n.endsWith(".yaml"));

  // Asserting the directory is non-empty first, because a "no credentials
  // found" pass over zero files is not a pass — it is a guard that checks
  // nothing while looking like it checks something.
  assert.ok(names.length > 0, "no workflow files found — this guard would be vacuous");
  assert.ok(names.includes("test.yml"), "the test workflow must exist");

  for (const name of names) {
    const workflow = await readFile(path.join(dir, name), "utf8");
    assert.doesNotMatch(workflow, /NPM_TOKEN|NODE_AUTH_TOKEN|npm-token/i, `credential in ${name}`);
  }
});

test("CI covers every platform this tool claims to support", async () => {
  const workflow = await readFile(path.join(root, ".github", "workflows", "test.yml"), "utf8");
  for (const os of ["ubuntu-latest", "windows-latest", "macos-latest"]) {
    assert.match(workflow, new RegExp(os), `${os} missing from the CI matrix`);
  }
});
