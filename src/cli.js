#!/usr/bin/env node

// Phase 0 diagnostic CLI. READ-ONLY: it inspects this machine and prints what
// it found. It pulls nothing, deletes nothing, starts nothing and stops
// nothing. Mutating actions are a deliberately later phase with their own
// preview/confirm/rollback design — read-only is the release boundary, not a
// per-feature judgement call.

import { pathToFileURL } from "node:url";
import { collect } from "./collect/index.js";
import { buildReport } from "./derive/report.js";
import { renderReport } from "./derive/render.js";
import { CLIENT_VERSION } from "./version.js";

function usage() {
  return `Usage: osai-cmdcenter [options]

Inspects this machine's local AI setup — GPU and memory, Ollama, installed and
loaded models — and reports what it can actually verify.

Options:
  --json        Emit the full report as JSON instead of text
  --capture     Emit the RAW capture as JSON (for fixtures and bug reports)
  --version     Print the version
  --help        Show this help

This tool is read-only and makes no external network calls. Its only network
connection is to Ollama on loopback (127.0.0.1:11434).`;
}

function parseArguments(argv) {
  const flags = new Set(argv.slice(2));
  return {
    json: flags.has("--json"),
    capture: flags.has("--capture"),
    version: flags.has("--version"),
    help: flags.has("--help") || flags.has("-h"),
  };
}

export async function main(argv = process.argv, stdout = process.stdout) {
  const args = parseArguments(argv);

  if (args.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }
  if (args.version) {
    stdout.write(`${CLIENT_VERSION}\n`);
    return 0;
  }

  // The clock is read HERE, at the top level, and passed down. Nothing in
  // collect or derive reads it, which is what keeps both snapshot-testable.
  const now = new Date().toISOString();
  const capture = await collect({ capturedAt: now });

  if (args.capture) {
    stdout.write(`${JSON.stringify(capture, null, 2)}\n`);
    return 0;
  }

  const report = buildReport(capture, { generatedAt: now });
  stdout.write(args.json ? `${JSON.stringify(report, null, 2)}\n` : `${renderReport(report)}\n`);
  return 0;
}

// pathToFileURL rather than string-concatenating "file://" — on Windows an
// absolute path produces file:///C:/... with three slashes, and hand-built
// comparisons silently never match, leaving the CLI printing nothing at all.
const isDirectRun = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isDirectRun) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      process.stderr.write(`osai-cmdcenter failed: ${err.stack}\n`);
      process.exitCode = 1;
    },
  );
}
