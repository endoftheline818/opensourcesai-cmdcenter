import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturesDir = path.join(root, "fixtures");

// `website-*` are parity pins generated from the website's modules, not machine
// captures. Excluded by prefix rather than by an exact filename, so adding
// another parity fixture cannot accidentally make it get validated as a capture.
const captureFixtures = async () =>
  (await readdir(fixturesDir)).filter((n) => n.endsWith(".json") && !n.startsWith("website-"));

// PUBLISHABILITY GUARD.
//
// Fixtures are real machine captures and this repository is intended to become
// public. A capture straight off a machine contains real home-directory paths,
// which carry a username — so committing one unredacted leaks a person's name
// into public git history, where it cannot be taken back.
//
// scripts/redact-fixture.mjs does the redaction; this test makes forgetting it
// a build failure rather than a discovery after the fact.
test("no fixture contains a real home-directory path", async () => {
  const names = await captureFixtures();
  assert.ok(names.length > 0, "no capture fixtures found — this guard would be vacuous");

  for (const name of names) {
    const text = await readFile(path.join(fixturesDir, name), "utf8");

    // A home path whose next segment is anything other than the <USER>
    // placeholder is an unredacted username.
    for (const pattern of [
      /[A-Za-z]:\\{1,2}Users\\{1,2}(?!<USER>)[^\\"]+/,
      /\/Users\/(?!<USER>)[^/"]+/,
      /\/home\/(?!<USER>)[^/"]+/,
    ]) {
      const match = pattern.exec(text);
      assert.equal(match, null, `${name} contains an unredacted home path: ${match?.[0]}`);
    }
  }
});

test("every capture fixture records whether redaction ran", async () => {
  for (const name of await captureFixtures()) {
    const fixture = JSON.parse(await readFile(path.join(fixturesDir, name), "utf8"));
    assert.ok(fixture.redactions, `${name} has no redactions record`);
    assert.ok(
      Array.isArray(fixture.redactions.rulesApplied),
      `${name} must record which rules ran — including none, which is a real result`,
    );
  }
});

test("fixtures still exercise real platform path shapes after redaction", async () => {
  // Redaction must not flatten the differences the fixtures exist to cover:
  // a Windows drive letter and backslashes, and Linux's system-install
  // location, are the path handling most likely to regress.
  const windows = JSON.parse(await readFile(path.join(fixturesDir, "windows-rtx-4070-ti.json"), "utf8"));
  assert.match(windows.ollama.modelStore.path, /^[A-Za-z]:\\/, "Windows path shape lost in redaction");

  const linux = JSON.parse(await readFile(path.join(fixturesDir, "linux-rtx-3080.json"), "utf8"));
  assert.match(linux.ollama.modelStore.path, /^\/(usr|home)\//, "Linux path shape lost in redaction");

  const macos = JSON.parse(await readFile(path.join(fixturesDir, "macos-m1-8gb.json"), "utf8"));
  assert.match(macos.ollama.modelStore.path, /^\/Users\//, "macOS path shape lost in redaction");
});

test("the three validated platforms are all represented", async () => {
  const platforms = new Set();
  for (const name of await captureFixtures()) {
    const fixture = JSON.parse(await readFile(path.join(fixturesDir, name), "utf8"));
    platforms.add(fixture.platform.nodePlatform);
  }
  assert.deepEqual([...platforms].sort(), ["darwin", "linux", "win32"]);
});
