#!/usr/bin/env node

// Phase 0 diagnostic CLI. READ-ONLY: it inspects this machine and prints what
// it found. It pulls nothing, deletes nothing, starts nothing and stops
// nothing. Mutating actions are a deliberately later phase with their own
// preview/confirm/rollback design — read-only is the release boundary, not a
// per-feature judgement call.

import { pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { collect, resolveHost } from "./collect/index.js";
import { collectTelemetry } from "./collect/telemetry.js";
import { createActions } from "./actions/ollama.js";
import { compareBenchResults, inspectBenchResult } from "./derive/bench-results.js";
import { buildReport } from "./derive/report.js";
import { renderReport } from "./derive/render.js";
import { DEFAULT_PORT, startServer } from "./serve/server.js";
import { CLIENT_VERSION } from "./version.js";

const packageRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");

export async function loadCatalog() {
  return JSON.parse(
    await readFile(path.join(packageRoot, "data", "checker-models-snapshot.json"), "utf8"),
  );
}

export async function loadRooflineLimits() {
  return JSON.parse(
    await readFile(path.join(packageRoot, "data", "bench-roofline-limits.json"), "utf8"),
  );
}

/**
 * The bench-result inspection surface handed to the server: pure functions
 * over a POSTed body, plus the roofline caveats a utilization figure must
 * never render without. Holds no state, writes nothing, calls nothing.
 *
 * A refused comparison returns ok:true — the evaluation SUCCEEDED and its
 * honest answer is "no". Only an unreadable file is an error.
 */
export function createInspect(rooflineLimits) {
  return {
    inspectResult(body) {
      const result = inspectBenchResult(body);
      if (!result.ok) return { ok: false, status: 400, reason: result.reason };
      return { ok: true, view: result.view, rooflineLimits: rooflineLimits.limits };
    },
    compareResults(left, right, options) {
      return { ok: true, comparison: compareBenchResults(left, right, options) };
    },
  };
}

/**
 * Wire up and start the dashboard.
 *
 * EXPORTED SO IT CAN BE TESTED. This wiring previously lived inline in main()'s
 * serve branch, where it was unreachable from the suite — and a
 * temporal-dead-zone reference to `now` shipped and only surfaced when the
 * server was actually run by hand. A seam that returns the handle lets a test
 * boot the real path on an ephemeral port and close it again.
 */
export async function startDashboard({ port = DEFAULT_PORT } = {}) {
  const catalog = await loadCatalog();

  // Resolve the Ollama endpoint and model-store path ONCE at startup and close
  // over them, so each telemetry poll costs only the probes themselves rather
  // than re-deriving configuration two times a second.
  const host = resolveHost();
  const bootstrap = await collect({ capturedAt: new Date().toISOString() });
  const storePath = bootstrap.ollama?.modelStore?.path ?? null;

  const started = await startServer({
    collect,
    catalog,
    telemetry: ({ sampledAt }) => collectTelemetry({ host, storePath, sampledAt }),
    actions: createActions({ host }),
    inspect: createInspect(await loadRooflineLimits()),
    port,
  });
  return { ...started, catalog };
}

function usage() {
  return `Usage: osai-cmdcenter [command] [options]

Inspects this machine's local AI setup — GPU and memory, Ollama, installed and
loaded models — and reports what it can actually verify.

Commands:
  (none)        Print a diagnostic report as text
  serve         Open the local dashboard in a browser

Options:
  --json        Emit the full report as JSON instead of text
  --capture     Emit the RAW capture as JSON (for fixtures and bug reports)
  --port <n>    Port for 'serve' (default ${DEFAULT_PORT})
  --version     Print the version
  --help        Show this help

This tool talks only to AI runtimes on this machine — never to the internet.
Its only connection is Ollama on loopback (127.0.0.1:11434). The dashboard
binds to 127.0.0.1 only and requires a per-session token. Its actions are
loading and unloading a model; it never pulls, deletes or removes anything it
did not itself create.`;
}

function parseArguments(argv) {
  const args = argv.slice(2);
  const flags = new Set(args);
  const portIndex = args.indexOf("--port");
  const rawPort = portIndex === -1 ? null : args[portIndex + 1];
  const port = rawPort === null ? DEFAULT_PORT : Number(rawPort);

  return {
    serve: args[0] === "serve",
    json: flags.has("--json"),
    capture: flags.has("--capture"),
    version: flags.has("--version"),
    help: flags.has("--help") || flags.has("-h"),
    port,
    portValid: Number.isInteger(port) && port > 0 && port < 65536,
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

  if (args.serve) {
    if (!args.portValid) {
      stdout.write(`Invalid --port value. Expected an integer between 1 and 65535.\n`);
      return 1;
    }
    const { url, token, catalog } = await startDashboard({ port: args.port });
    stdout.write(
      [
        `OpenSourcesAI Command Center`,
        ``,
        `  ${url}`,
        ``,
        `Bound to 127.0.0.1 only, so it is not reachable from another machine.`,
        `It talks only to AI runtimes on this machine — never to the internet. Its`,
        `actions are load and unload; it never pulls, deletes or removes anything`,
        `it did not itself create.`,
        `The page authenticates with a token generated for this session; it is`,
        `never written to disk and changes every time you start the server.`,
        `Catalog snapshot: ${catalog.source?.generatedAt ?? "unknown"} (${catalog.modelCount} models).`,
        ``,
        `Press Ctrl+C to stop.`,
        ``,
      ].join("\n"),
    );
    // Deliberately not printing the token: the URL above is enough, because the
    // server hands the token to the page itself. Keeping it off the terminal
    // keeps it out of scrollback and out of any transcript that gets shared.
    void token;
    return new Promise(() => {}); // run until interrupted
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
