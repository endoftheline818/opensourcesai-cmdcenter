// The manual bandwidth figure — the one recorded setting this tool keeps.
//
// WHY IT EXISTS. The bandwidth table is deliberately narrow: entries exist
// only where a manufacturer source with an archive snapshot exists, so an
// unlisted GPU honestly renders "no sourced figure" and every utilization
// figure stays unavailable. The escape hatch the bandwidth decision promised
// is a USER-ENTERED figure — persisted here, labelled source: "manual"
// everywhere it travels, never able to masquerade as manufacturer-sourced.
//
// THE FIGURE IS TIED TO THE GPU IT WAS ENTERED FOR. The entry records the
// exact GPU name from the capture at entry time, and consumers apply it only
// while the machine's primary GPU still reports that name. A figure entered
// for one card silently applying to its replacement would be a borrowed
// number — the exact dishonesty this tool exists to refuse — so a mismatch
// is reported as ignored-with-reason, and the stale entry stays on disk for
// the user to see and clear.
//
// SANITY BOUNDS, NOT PLAUSIBILITY GUESSES. The validator refuses what no
// real memory system reports (non-finite, zero, negative, above 10 TB/s) and
// otherwise takes the user at their word — this is their claim about their
// hardware, and it is labelled as exactly that.

import path from "node:path";
import fsp from "node:fs/promises";
import { MANUAL_BANDWIDTH_FILE } from "./paths.js";

export const MANUAL_BANDWIDTH_SCHEMA_VERSION = 1;

/** No shipping memory system exceeds ~8 TB/s; 10000 GB/s refuses typos, not hardware. */
export const MAX_MANUAL_BANDWIDTH_GBPS = 10_000;

const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Validate one manual-bandwidth entry. PURE, closed allowlist — an unknown
 * key is refused, not ignored, the same rule every stored shape here follows.
 */
export function validateManualBandwidth(entry) {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    return { ok: false, reason: "entry must be an object" };
  }
  const FIELDS = {
    manualBandwidthSchemaVersion: (v) => v === MANUAL_BANDWIDTH_SCHEMA_VERSION,
    memoryBandwidthGBps: (v) =>
      typeof v === "number" && Number.isFinite(v) && v > 0 && v <= MAX_MANUAL_BANDWIDTH_GBPS,
    gpuName: (v) => typeof v === "string" && v.length > 0 && v.length <= 200,
    enteredAt: (v) => typeof v === "string" && ISO_8601.test(v),
  };
  for (const key of Object.keys(entry)) {
    if (!(key in FIELDS)) return { ok: false, reason: `unknown field: ${key}` };
  }
  for (const [key, check] of Object.entries(FIELDS)) {
    if (!(key in entry)) return { ok: false, reason: `missing field: ${key}` };
    if (!check(entry[key])) return { ok: false, reason: `invalid value for ${key}` };
  }
  return { ok: true };
}

/**
 * Write the entry, validation-gated — a refused entry touches the disk not at
 * all. Latest wins: this is a setting, not a history, and the honest record
 * of "what ceiling was in effect" already lives in each bench result and in
 * the provenance shown beside every figure.
 */
export async function writeManualBandwidth(dir, entry) {
  const verdict = validateManualBandwidth(entry);
  if (!verdict.ok) return verdict;
  await fsp.writeFile(
    path.join(dir, MANUAL_BANDWIDTH_FILE),
    `${JSON.stringify(entry, null, 2)}\n`,
    "utf8",
  );
  return { ok: true };
}

/**
 * Read the entry, honestly bucketed: absent is a normal state, a hand-edited
 * or torn file is invalid-with-reason (never a throw, never silently
 * discarded), and a FUTURE schema version is reported as such rather than
 * reinterpreted — newer-version data is not this version's to guess at.
 */
export async function readManualBandwidth(dir) {
  let text;
  try {
    text = await fsp.readFile(path.join(dir, MANUAL_BANDWIDTH_FILE), "utf8");
  } catch {
    return { exists: false, ok: false, entry: null };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { exists: true, ok: false, entry: null, reason: "the stored entry is not valid JSON" };
  }
  const version = parsed?.manualBandwidthSchemaVersion;
  if (typeof version === "number" && version > MANUAL_BANDWIDTH_SCHEMA_VERSION) {
    return {
      exists: true,
      ok: false,
      entry: null,
      reason: `the stored entry uses schema v${version}; this client reads up to v${MANUAL_BANDWIDTH_SCHEMA_VERSION}`,
    };
  }
  const verdict = validateManualBandwidth(parsed);
  if (!verdict.ok) {
    return { exists: true, ok: false, entry: null, reason: verdict.reason };
  }
  return { exists: true, ok: true, entry: parsed };
}

/**
 * Remove the entry. Contained exactly like clearMeasurements: no parameter
 * can name a path — the one deletable thing is the one file this module
 * writes, joined from the store directory and a constant.
 */
export async function clearManualBandwidth(dir) {
  const file = path.join(dir, MANUAL_BANDWIDTH_FILE);
  let existed = true;
  try {
    await fsp.access(file);
  } catch {
    existed = false;
  }
  await fsp.rm(file, { force: true });
  return { ok: true, existed };
}
