#!/usr/bin/env node

// Phase 0 diagnostic CLI. READ-ONLY: it inspects this machine and prints what
// it found. It pulls nothing, deletes nothing, starts nothing and stops
// nothing. Mutating actions are a deliberately later phase with their own
// preview/confirm/rollback design — read-only is the release boundary, not a
// per-feature judgement call.

import { pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { benchResultsDirectory, listBenchResults, readBenchResult } from "./collect/bench-results.js";
import { collect, resolveHost } from "./collect/index.js";
import { collectTelemetry } from "./collect/telemetry.js";
import { createActions } from "./actions/ollama.js";
import { createChatService } from "./chat/service.js";
import { resolveCaptureBandwidth } from "./derive/bandwidth.js";
import { compareBenchResults, inspectBenchResult } from "./derive/bench-results.js";
import { deriveRuntimeEnvironment, environmentDeclarationHash } from "./derive/environment.js";
import { gradeCatalog } from "./derive/fit.js";
import { buildReport } from "./derive/report.js";
import { renderReport } from "./derive/render.js";
import { resolveGradingHardware, resolveInstalledModels } from "./serve/routes.js";
import { DEFAULT_PORT, startServer } from "./serve/server.js";
import {
  MANUAL_BANDWIDTH_SCHEMA_VERSION,
  clearManualBandwidth,
  readManualBandwidth,
  writeManualBandwidth,
} from "./storage/bandwidth.js";
import { dataDirectory } from "./storage/paths.js";
import { openStore } from "./storage/store.js";
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
 * never render without. Holds no state, writes nothing — and since the
 * results-directory pairing with bench 0.12 it may READ exactly one thing:
 * the known bench-results directory
 * (`~/.osai/bench-results/`, bench's own default output location), through
 * collect/bench-results.js's pattern-and-containment gate. A request can name
 * a file already in that directory; it cannot name a path.
 *
 * A refused comparison returns ok:true — the evaluation SUCCEEDED and its
 * honest answer is "no". Only an unreadable file is an error.
 */
export function createInspect(rooflineLimits, { resultsDirectory = null } = {}) {
  return {
    inspectResult(body) {
      const result = inspectBenchResult(body);
      if (!result.ok) return { ok: false, status: 400, reason: result.reason };
      return { ok: true, view: result.view, rooflineLimits: rooflineLimits.limits };
    },
    compareResults(left, right, options) {
      return { ok: true, comparison: compareBenchResults(left, right, options) };
    },
    async listResults() {
      if (resultsDirectory === null) return { configured: false, exists: false, results: [] };
      return { configured: true, ...(await listBenchResults(resultsDirectory)) };
    },
    async inspectStored(name) {
      if (resultsDirectory === null) {
        return { ok: false, status: 400, reason: "no results directory is configured" };
      }
      const read = await readBenchResult(resultsDirectory, name);
      if (!read.ok) return { ok: false, status: 400, reason: read.reason };
      const result = inspectBenchResult(read.record);
      if (!result.ok) return { ok: false, status: 400, reason: result.reason };
      // `raw` rides along so the browser can offer the same gated comparison
      // it offers for dropped files — the client already owns this file.
      return { ok: true, name, view: result.view, rooflineLimits: rooflineLimits.limits, raw: read.record };
    },
  };
}

/**
 * The manual-bandwidth setting, as a surface: the honest escape hatch the
 * bandwidth decision promised for GPUs the manufacturer-sourced table does
 * not list. The copied resolver has carried the manual path all along —
 * `manualGBps` wins over the table and comes back labelled source: "manual" —
 * and this service is the persistence and gating around it.
 *
 * THE FIGURE APPLIES ONLY TO THE GPU IT WAS ENTERED FOR. `set` stamps the
 * capture's current primary-GPU name server-side (a client cannot tie a
 * figure to hardware it merely names), and a stored figure whose GPU no
 * longer matches is reported as ignored-with-reason rather than silently
 * applied to a different card — a borrowed number is exactly what the
 * provenance labels exist to prevent.
 */
export function createBandwidthSettings({
  dataDir = null,
  persistenceUnavailableReason = null,
  capture,
  now,
}) {
  let manual = null;
  let manualProblem = null;

  const gpuOf = () => resolveCaptureBandwidth(capture).gpu;
  const appliedManualGBps = () => {
    if (manual === null) return null;
    const gpu = gpuOf();
    return gpu !== null && gpu.name === manual.gpuName ? manual.memoryBandwidthGBps : null;
  };

  const api = {
    /** Read the stored entry once at startup; a broken file is a reason, not a crash. */
    async load() {
      if (dataDir === null) return;
      const read = await readManualBandwidth(dataDir);
      if (read.ok) manual = read.entry;
      else if (read.exists) manualProblem = read.reason;
    },

    /** The ceiling the measurement strips should use RIGHT NOW, with its source. */
    effectiveCeiling() {
      const resolution = resolveCaptureBandwidth(capture, { manualGBps: appliedManualGBps() });
      return { memoryBandwidthGBps: resolution.memoryBandwidthGBps, bandwidthSource: resolution.source };
    },

    /** The full provenance story, display-ready. */
    async status() {
      const gpu = gpuOf();
      const applied = appliedManualGBps();
      const effective = resolveCaptureBandwidth(capture, { manualGBps: applied });
      const tableOnly = resolveCaptureBandwidth(capture);
      return {
        ok: true,
        persistence: { available: dataDir !== null, reason: persistenceUnavailableReason },
        gpu,
        resolution: {
          memoryBandwidthGBps: effective.memoryBandwidthGBps,
          source: effective.source,
          entryId: effective.entryId ?? null,
          tableVersion: effective.tableVersion ?? null,
        },
        manual:
          manual !== null
            ? {
                exists: true,
                memoryBandwidthGBps: manual.memoryBandwidthGBps,
                gpuName: manual.gpuName,
                enteredAt: manual.enteredAt,
                applied: applied !== null,
                ignoredReason:
                  applied !== null
                    ? null
                    : gpu === null
                      ? "no GPU is detected on this machine"
                      : `it was entered for "${manual.gpuName}", but this machine's primary GPU is "${gpu.name}"`,
              }
            : { exists: false, problem: manualProblem },
        // When the manual figure displaces a manufacturer-sourced one, both
        // are shown — the user should see exactly what their entry overrode.
        overridesTable:
          applied !== null && tableOnly.memoryBandwidthGBps !== null
            ? { memoryBandwidthGBps: tableOnly.memoryBandwidthGBps, entryId: tableOnly.entryId }
            : null,
      };
    },

    async set(body) {
      if (dataDir === null) {
        return { ok: false, status: 400, reason: `the figure cannot be saved: ${persistenceUnavailableReason}` };
      }
      const gpu = gpuOf();
      if (gpu === null) {
        return { ok: false, status: 400, reason: "no GPU is detected, so there is no hardware to tie the figure to" };
      }
      const entry = {
        manualBandwidthSchemaVersion: MANUAL_BANDWIDTH_SCHEMA_VERSION,
        memoryBandwidthGBps: body?.memoryBandwidthGBps,
        gpuName: gpu.name,
        enteredAt: now(),
      };
      const written = await writeManualBandwidth(dataDir, entry);
      if (!written.ok) return { ok: false, status: 400, reason: written.reason };
      manual = entry;
      manualProblem = null;
      return api.status();
    },

    async clear() {
      if (dataDir === null) {
        return { ok: false, status: 400, reason: `the setting cannot be changed: ${persistenceUnavailableReason}` };
      }
      await clearManualBandwidth(dataDir);
      manual = null;
      manualProblem = null;
      return api.status();
    },
  };
  return api;
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
export async function startDashboard({ port = DEFAULT_PORT, llamacppPort = null } = {}) {
  const catalog = await loadCatalog();

  // Resolve the Ollama endpoint and model-store path ONCE at startup and close
  // over them, so each telemetry poll costs only the probes themselves rather
  // than re-deriving configuration two times a second.
  const host = resolveHost();
  const bootstrap = await collect({ capturedAt: new Date().toISOString() });
  const storePath = bootstrap.ollama?.modelStore?.path ?? null;

  // THE STORAGE WIRING (MAINTAINING §4a/§4b): the store opens here, once, and
  // only the chat surface receives it. A store that refuses to open — newer
  // schema on disk, corrupt meta — disables chat WITH ITS REASON, and the rest
  // of the dashboard runs untouched: measurement history is worth having, but
  // a diagnostic tool that cannot start because of its own data files would
  // have its priorities inverted.
  let chat = null;
  let chatUnavailableReason = null;
  const store = await openStore(dataDirectory(), { createdAt: new Date().toISOString() });

  // The bandwidth setting exists even when the store does not: its DISPLAY
  // half (what ceiling is in effect, from where) needs only the capture, and
  // only saving a new figure needs the data directory — refused with the
  // store's own reason when that failed.
  const settings = createBandwidthSettings({
    dataDir: store.ok ? store.dir : null,
    persistenceUnavailableReason: store.ok ? null : store.reason,
    capture: bootstrap,
    now: () => new Date().toISOString(),
  });
  await settings.load();

  if (store.ok) {
    // Fit grades for the expectation panel, resolved once at startup by the
    // same engine and the same platform rules the dashboard grades with —
    // nameplate VRAM, Apple usable memory — so prediction and observation can
    // never disagree about what was predicted.
    const bootstrapReport = buildReport(bootstrap);
    const graded = gradeCatalog(bootstrap.ollama?.apiReachable
      ? catalog.models
      : [], resolveGradingHardware(bootstrapReport));
    const installedNames = (bootstrap.ollama?.installedModels ?? []).map((m) => m.name);
    const resolved = resolveInstalledModels(
      { ...bootstrapReport, ollama: { ...bootstrapReport.ollama, installedModels: installedNames } },
      catalog,
      graded,
    );
    chat = createChatService({
      host,
      // The second runtime's endpoint is built from a PORT and nothing else —
      // loopback by construction, mirroring the deliberate absence of a --host
      // flag: there is no address input to mistype or to point off-machine.
      openAiHost: llamacppPort === null ? null : `http://127.0.0.1:${llamacppPort}`,
      dataDir: store.dir,
      // The ceiling arrives as a LIVE thunk, not a startup value, so a manual
      // figure entered in the Hardware view reaches the very next reply's
      // strip — with its source, because a manual ceiling must never render
      // indistinguishably from a manufacturer-sourced one. Weights stay
      // startup-resolved: on-disk bytes per installed model.
      bandwidth: settings.effectiveCeiling,
      weightsByModel: new Map(
        (bootstrap.ollama?.installedModels ?? []).map((m) => [m.name, m.sizeBytes]),
      ),
      gradeByModel: new Map(resolved.map((entry) => [entry.name, entry.grade])),
      runtimeVersion: bootstrap.ollama?.apiVersion ?? null,
      environmentHash: environmentDeclarationHash(deriveRuntimeEnvironment(process.env)),
      now: () => new Date().toISOString(),
    });
  } else {
    chatUnavailableReason = store.reason;
    process.stderr.write(`cmdcenter: chat disabled — ${store.reason}\n`);
  }

  const started = await startServer({
    collect,
    catalog,
    telemetry: ({ sampledAt }) => collectTelemetry({ host, storePath, sampledAt }),
    actions: createActions({ host }),
    inspect: createInspect(await loadRooflineLimits(), { resultsDirectory: benchResultsDirectory() }),
    chat,
    settings,
    port,
  });
  return { ...started, catalog, chatUnavailableReason };
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
  --llamacpp-port <n>  Chat with an OpenAI-compatible server (llama.cpp) on
                this loopback port, alongside Ollama. Port only, on purpose:
                there is no host flag, so the endpoint cannot leave this machine
  --version     Print the version
  --help        Show this help

This tool talks only to AI runtimes on this machine — never to the internet.
Its connections are Ollama on loopback (127.0.0.1:11434) and, only when
--llamacpp-port is given, an OpenAI-compatible server on that loopback port.
The dashboard binds to 127.0.0.1 only and requires a per-session token. Its
actions are loading and unloading a model; it never pulls, deletes or removes
anything it did not itself create.`;
}

function parseArguments(argv) {
  const args = argv.slice(2);
  const flags = new Set(args);
  const portIndex = args.indexOf("--port");
  const rawPort = portIndex === -1 ? null : args[portIndex + 1];
  const port = rawPort === null ? DEFAULT_PORT : Number(rawPort);
  const llamacppIndex = args.indexOf("--llamacpp-port");
  const rawLlamacpp = llamacppIndex === -1 ? null : args[llamacppIndex + 1];
  const llamacppPort = rawLlamacpp === null ? null : Number(rawLlamacpp);

  return {
    serve: args[0] === "serve",
    json: flags.has("--json"),
    capture: flags.has("--capture"),
    version: flags.has("--version"),
    help: flags.has("--help") || flags.has("-h"),
    port,
    portValid: Number.isInteger(port) && port > 0 && port < 65536,
    llamacppPort,
    llamacppPortValid:
      llamacppPort === null || (Number.isInteger(llamacppPort) && llamacppPort > 0 && llamacppPort < 65536),
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
    if (!args.llamacppPortValid) {
      stdout.write(`Invalid --llamacpp-port value. Expected an integer between 1 and 65535.\n`);
      return 1;
    }
    const { url, token, catalog } = await startDashboard({ port: args.port, llamacppPort: args.llamacppPort });
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
