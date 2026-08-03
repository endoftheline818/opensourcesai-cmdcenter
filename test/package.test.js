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

test("package is executable, dependency-free, and version-aligned", async () => {
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  assert.equal(pkg.name, "@opensourcesai/cmdcenter");
  assert.equal(pkg.version, CLIENT_VERSION);
  assert.equal(pkg.bin["osai-cmdcenter"], "src/cli.js");
  assert.equal(pkg.engines.node, ">=20");
  assert.equal(pkg.dependencies, undefined, "runtime dependencies need explicit justification");
  assert.equal(pkg.devDependencies, undefined, "node --test needs no test framework");
});

// PUBLISH GUARD. This package is deliberately unpublished: discovery-spec §8
// decision 2 keeps it private until a publish is a considered founder action.
// Removing `private: true` is exactly the mistake that once nearly pushed an
// entire private website to npm, so it is asserted rather than trusted.
test("package is private until a deliberate publish decision", async () => {
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  assert.equal(pkg.private, true, "do not remove private:true without a recorded decision");
});

// TRUST PROPERTY 1 — NO TRANSMISSION.
// The tool asks people to run it against their own machine. An audit must find
// zero outbound calls. Network access exists in exactly one module and is
// pinned to loopback; everywhere else it is absent by construction.
// The two files permitted to reach the network, both talking only to Ollama.
// An allowlist rather than a blanket exemption: adding a third has to be a
// deliberate edit to this list, which is the point.
const NETWORK_CAPABLE = [path.join("collect", "ollama.js"), path.join("collect", "telemetry.js")];

test("network access exists only in the Ollama collectors", async () => {
  const files = await sourceFiles(path.join(root, "src"));
  const browserBundle = path.join("serve", "ui.js");

  for (const file of files) {
    const source = await readFile(file, "utf8");
    if (NETWORK_CAPABLE.some((allowed) => file.endsWith(allowed))) continue;

    // serve/ui.js is BROWSER code carried as a string. Its fetches run in the
    // user's browser against this same server, which is a different thing from
    // the Node process reaching the network — it has its own stricter rule.
    if (file.endsWith(browserBundle)) continue;

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
  const source = await readFile(path.join(root, "src", "serve", "ui.js"), "utf8");

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

// TRUST PROPERTY 2 — READ-ONLY.
// Phase 0 is a diagnostic. It must not be able to mutate the machine even by
// accident: no model pulls, no deletions, no service control. Read-only means
// the mutation surface is absent, not disabled behind a flag.
test("no mutating Ollama endpoint or destructive command is reachable", async () => {
  const files = await sourceFiles(path.join(root, "src"));
  for (const file of files) {
    const source = await readFile(file, "utf8");
    const relative = path.relative(root, file);
    assert.doesNotMatch(source, /\/api\/(pull|push|delete|create|copy)\b/, `mutating API in ${relative}`);
    assert.doesNotMatch(source, /method:\s*["'](POST|PUT|PATCH|DELETE)["']/i, `write request in ${relative}`);
    assert.doesNotMatch(source, /\bollama\s+(pull|rm|stop|serve|create|push)\b/, `mutating CLI call in ${relative}`);
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
test("the derive layer never reads a clock or a random source", async () => {
  const files = await sourceFiles(path.join(root, "src", "derive"));
  assert.ok(files.length > 0);
  for (const file of files) {
    const source = await readFile(file, "utf8");
    const relative = path.relative(root, file);
    assert.doesNotMatch(source, /Date\.now\(\)|new Date\(\)/, `clock read in ${relative}`);
    assert.doesNotMatch(source, /Math\.random/, `randomness in ${relative}`);
  }
});

// HARD REPO BOUNDARY — this package never imports from the website. The two
// are joined only by versioned contracts and the parity fixture.
test("nothing imports from the website repository", async () => {
  const files = await sourceFiles(path.join(root, "src"));

  // Inspect IMPORT SPECIFIERS, not raw file text. Matching the bare string
  // "opensourcesai.com" would flag the provenance comment in derive/bands.js,
  // which documents where the fixture-verified copy came from — the guard has
  // to test the coupling itself, not any mention of it.
  const specifierPattern = /(?:^|\s)(?:import|export)[\s\S]*?from\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']/g;

  for (const file of files) {
    const source = await readFile(file, "utf8");
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
