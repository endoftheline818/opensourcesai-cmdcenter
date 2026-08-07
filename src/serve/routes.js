// Read-only JSON routes. Every handler is a pure-ish function of a capture, so
// the routing table can be tested without opening a socket.
//
// THE ROUTE TABLE IS AN ALLOWLIST. An unmatched path is a 404 — there is no
// catch-all, no path-derived file read, and no way to name a resource the table
// does not already enumerate. That is what makes path traversal impossible here
// rather than merely guarded against.

import { buildReport } from "../derive/report.js";
import { gradeCatalog } from "../derive/fit.js";
import { buildLivePayload } from "../derive/telemetry.js";
import { buildToolsPayload, exportableTools } from "../derive/tools.js";
import { nameplateGb, toGb } from "../units.js";
import { CLIENT_VERSION, REPORT_CONTRACT_VERSION } from "../version.js";

/**
 * Floor on how often telemetry is actually sampled, regardless of how fast a
 * client polls. The UI asks every 2s; a stuck or malicious loop asking a
 * thousand times a second must not spawn a thousand nvidia-smi processes on
 * the user's machine. Within the window the previous sample is returned as-is.
 */
export const TELEMETRY_MIN_INTERVAL_MS = 900;

/**
 * Resolve the hardware figures the fit engine should grade against.
 *
 * This is the ONLY place the platform rules are applied, so the dashboard and
 * any future consumer cannot disagree about them:
 *   - Apple Silicon grades against USABLE unified memory (75%), not the total.
 *   - Everything else grades against NAMEPLATE VRAM, not the raw reported value,
 *     because vendors report just under nameplate and the raw figure crosses
 *     tier boundaries downward.
 */
export function resolveGradingHardware(report) {
  const systemRamGb = report.memory?.totalGb ?? 0;

  if (report.appleMemory) {
    return {
      vramGb: report.appleMemory.usableModelMemoryGb,
      systemRamGb,
      basis: "apple-unified-usable",
      note: `Graded against ${report.appleMemory.usableModelMemoryGb} GB of usable unified memory (${report.appleMemory.usableFraction * 100}% of ${report.appleMemory.totalMemoryGb} GB — macOS reserves the rest).`,
    };
  }
  if (report.gpu) {
    return {
      vramGb: report.gpu.nameplateGb,
      systemRamGb,
      basis: "discrete-vram-nameplate",
      note: `Graded against ${report.gpu.nameplateGb} GB of VRAM, from ${report.gpu.selectedSource}.`,
    };
  }
  return {
    vramGb: 0,
    systemRamGb,
    basis: "cpu-only",
    note: "No GPU detected. Everything here is graded as CPU/RAM offload.",
  };
}

/** Join what Ollama actually has installed to what the catalog knows about it. */
export function resolveInstalledModels(report, catalog, graded) {
  const installed = report.ollama?.installedModelCount === null ? [] : (report.ollama?.installedModels ?? []);
  const byTag = new Map();
  for (const model of catalog.models) {
    for (const tag of [model.ollamaTag, model.ollamaTagQ8, model.ollamaTagFp16]) {
      if (tag) byTag.set(tag.toLowerCase(), model.id);
    }
  }
  const gradeById = new Map(graded.map((g) => [g.id, g]));

  return installed.map((name) => {
    const key = String(name).toLowerCase();
    const id = byTag.get(key) ?? byTag.get(key.replace(/:latest$/, ""));
    if (id) return { name, status: "known", catalogId: id, grade: gradeById.get(id) ?? null };

    // Three outcomes, not two. A model the catalog does not list is usually a
    // local derivative (built from a Modelfile) or deliberately out of scope
    // (an embedding model), not evidence of a catalog gap — and calling all of
    // them "unknown" would be both alarming and wrong.
    const derived = /-(fast|light|broken|cpuonly|custom)\b|:[^:]*-(fast|light|custom)\b/i.test(key);
    return {
      name,
      status: derived ? "derived" : "unlisted",
      catalogId: null,
      grade: null,
    };
  });
}

export function buildDashboardPayload(capture, catalog, { generatedAt = null } = {}) {
  const report = buildReport(capture, { generatedAt });
  const hardware = resolveGradingHardware(report);
  const graded = gradeCatalog(catalog.models, hardware);
  const tools = buildToolsPayload(capture.tools);

  // Tooling contributes COUNTS ONLY to the shareable block. Server names,
  // config filenames and env var names all reveal what someone works on and
  // which vendors hold their credentials — none of which belongs in an
  // artifact designed to be pasted in public.
  const exportable = { ...report.exportable, ...exportableTools(tools) };

  const installedNames = (capture.ollama?.installedModels ?? []).map((m) => m.name);
  const reportWithNames = {
    ...report,
    ollama: { ...report.ollama, installedModels: installedNames },
  };

  return {
    clientVersion: CLIENT_VERSION,
    reportContractVersion: REPORT_CONTRACT_VERSION,
    generatedAt,
    report: { ...report, exportable },
    tools,
    hardware,
    catalog: {
      // Surfaced so the UI can show the snapshot's age rather than implying the
      // data is live. Decision 3 is open; until then this is honest labelling.
      generatedAt: catalog.source?.generatedAt ?? null,
      modelCount: catalog.modelCount ?? catalog.models.length,
      note: catalog.note ?? null,
    },
    models: graded,
    installed: resolveInstalledModels(reportWithNames, catalog, graded),
    loaded: (report.ollama?.loadedModels ?? []).map((m) => ({
      ...m,
      // A loaded model below 100% residency is running partly on CPU. Naming it
      // is the single most useful runtime fact this dashboard can show.
      spilled: m.vramResidentPercent !== null && m.vramResidentPercent < 100,
    })),
  };
}

/** Small helpers so route handlers stay declarative. */
const json = (body) => ({ status: 200, type: "application/json; charset=utf-8", body: JSON.stringify(body) });

/**
 * @param {object} deps
 * @param {() => Promise<object>} deps.collect    Re-runs full collection on demand.
 * @param {object} deps.catalog                   The committed catalog snapshot.
 * @param {() => string} deps.now                 Injected clock — the routes never read one.
 * @param {() => Promise<object>} [deps.telemetry] Cheap poll-safe sample.
 * @param {() => number} [deps.monotonic]         Injected elapsed-ms source, for the rate limiter.
 */
export function createRoutes({ collect, catalog, now, telemetry = null, monotonic = () => Date.now(), chat = null }) {
  // Rate-limiter state. Deliberately per-server rather than per-client: the
  // resource being protected is the machine's CPU, and it does not care which
  // tab asked.
  let lastSampleAt = -Infinity;
  let lastPayload = null;

  return {
    "/api/health": async () => json({ ok: true, clientVersion: CLIENT_VERSION }),

    // The conversation LIST — ids and metadata only, no prose by construction
    // (the shape is enforced and sentinel-tested in src/storage/conversations).
    // Reading a conversation's words requires POSTing for exactly that
    // conversation. When chat is not configured (storage failed to open, say),
    // the reason is reported rather than an empty list pretending health.
    "/api/chat/conversations": async () =>
      chat
        ? json(await chat.list())
        : json({ ok: false, reason: chat === null ? "chat is not configured" : "chat unavailable" }),

    // The second runtime's served-model list (or its honest absence). GET like
    // the conversation list: names only, no prose, nothing actionable.
    "/api/chat/models": async () =>
      chat
        ? json(await chat.models())
        : json({ ok: false, reason: chat === null ? "chat is not configured" : "chat unavailable" }),

    "/api/live": async () => {
      if (!telemetry) return json({ available: false, reason: "telemetry collector not configured" });

      const elapsed = monotonic() - lastSampleAt;
      if (lastPayload && elapsed < TELEMETRY_MIN_INTERVAL_MS) {
        return json({ ...lastPayload, cached: true });
      }

      const sample = await telemetry({ sampledAt: now() });
      lastSampleAt = monotonic();
      lastPayload = { available: true, ...buildLivePayload(sample) };
      return json({ ...lastPayload, cached: false });
    },

    "/api/dashboard": async () => {
      const generatedAt = now();
      const capture = await collect({ capturedAt: generatedAt });
      return json(buildDashboardPayload(capture, catalog, { generatedAt }));
    },

    "/api/report": async () => {
      const generatedAt = now();
      const capture = await collect({ capturedAt: generatedAt });
      return json(buildReport(capture, { generatedAt }));
    },

    "/api/capture": async () => {
      const generatedAt = now();
      return json(await collect({ capturedAt: generatedAt }));
    },
  };
}
