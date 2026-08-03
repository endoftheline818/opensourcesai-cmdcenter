#!/usr/bin/env node
//
// Redact a raw capture so it can be committed as a fixture.
//
// A capture is real machine state and contains real home-directory paths. This
// repository is intended to be public, so a capture is not publishable as-is —
// `C:\Users\<name>\...` and `/Users/<name>/...` both carry a username.
//
// Redaction replaces the home prefix with a placeholder and keeps everything
// else byte-identical, so the fixture still exercises real path handling
// (separators, drive letters, the Linux system-install location) without
// naming anybody. test/fixtures.test.js fails the build if an unredacted
// capture is ever committed.
//
// Usage: node scripts/redact-fixture.mjs <path-to-capture.json> [...more]

import { readFile, writeFile } from "node:fs/promises";

const RULES = [
  // Windows: C:\Users\someone\... → C:\Users\<USER>\...
  { name: "windows-home", pattern: /([A-Za-z]:\\\\?Users\\\\?)[^\\\\/"]+/g, replace: "$1<USER>" },
  // macOS: /Users/someone/... → /Users/<USER>/...
  { name: "macos-home", pattern: /(\/Users\/)[^/"]+/g, replace: "$1<USER>" },
  // Linux user homes. /usr/share/ollama is a system path and is deliberately
  // left alone — it identifies an install method, not a person.
  { name: "linux-home", pattern: /(\/home\/)[^/"]+/g, replace: "$1<USER>" },
];

async function redact(path) {
  const original = await readFile(path, "utf8");
  let text = original;
  const applied = [];

  for (const rule of RULES) {
    const next = text.replace(rule.pattern, rule.replace);
    if (next !== text) applied.push(rule.name);
    text = next;
  }

  const capture = JSON.parse(text);
  capture.redactions = {
    rulesApplied: applied,
    note: "Home-directory paths replaced with <USER>. No other field was altered.",
  };

  await writeFile(path, `${JSON.stringify(capture, null, 2)}\n`);
  return applied;
}

const targets = process.argv.slice(2);
if (targets.length === 0) {
  process.stderr.write("usage: node scripts/redact-fixture.mjs <capture.json> [...]\n");
  process.exitCode = 1;
} else {
  for (const target of targets) {
    const applied = await redact(target);
    process.stdout.write(`${target}: ${applied.length ? applied.join(", ") : "nothing to redact"}\n`);
  }
}
