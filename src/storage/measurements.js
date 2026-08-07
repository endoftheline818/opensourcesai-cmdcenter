// The measurement history — what this tool is allowed to remember.
//
// THE HARD RULE, AND WHY IT IS STRUCTURAL RATHER THAN PROMISED
// A measurement record holds counters and metadata ONLY. There is no field in
// the schema that can carry prose: the allowlist below is CLOSED (an unknown
// key anywhere in the record is refused, not ignored), every permitted string
// is shape- or length-constrained, and the numbers are just numbers. Records
// that fail validation are refused at append time — a value that is never
// written cannot leak, the same ordering collect/tools.js uses for MCP secrets.
//
// This matters because the store outlives the moment. A capture is pasted into
// one bug report; a history file sits on disk for months and gets copied,
// synced, and backed up. The only defensible design is one where the sensitive
// thing CANNOT be in the file, rather than one where somebody remembered not to
// put it there.
//
// NULL IS NOT ZERO. A counter the runtime did not report is null, never 0 —
// "unknown" and "measured as nothing" are different claims, the same rule the
// gauges hold. The validator accepts null everywhere a probe can honestly come
// back empty, and rejects fabricated shapes (negative counts, non-finite
// numbers) that no real probe produces.
//
// TWO KINDS OF NUMBER, NAMED FOR THEIR SOURCE. `reported` figures come from the
// runtime's own response body (nanosecond durations, token counts) and are only
// as honest as the runtime. `observed` figures were measured by this tool with
// its own clock (wall milliseconds). Keeping them in separately-named blocks
// means a record never has to explain which kind a number is — the name does.

import path from "node:path";
import fsp from "node:fs/promises";
import { MEASUREMENT_SCHEMA_VERSION } from "../version.js";
import { MEASUREMENTS_FILE } from "./paths.js";
import { appendRecord, readRecords } from "./jsonl.js";

/**
 * What can produce a measurement record today. Closed on purpose: a source is
 * a claim about HOW the numbers were obtained, and a reader interprets records
 * differently by source — so an unknown source is an unknown meaning, refused.
 * Extending this list is a schema decision (bump MEASUREMENT_SCHEMA_VERSION).
 *
 * The two entries are the two measurable things the tool performs right now:
 * its own load and unload actions, both of which already time themselves.
 */
export const MEASUREMENT_SOURCES = ["load-action", "unload-action"];

// --- field validators, each small enough to read as a sentence ---------------

const isNonNegativeFinite = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;
const isPositiveInteger = (v) => Number.isInteger(v) && v > 0;
const nullOr = (check) => (v) => v === null || check(v);

// Bounded, pattern-checked strings. The caps are not politeness — they are the
// property that makes "no prose can live here" true. A model tag is the longest
// string a record may carry, and 200 matches the cap the action layer already
// enforces on model names.
const boundedString = (max, pattern = null) => (v) =>
  typeof v === "string" && v.length > 0 && v.length <= max && (pattern === null || pattern.test(v));

const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const HEX = /^[0-9a-f]+$/;
// Ollama digests arrive as "sha256:<hex>" or bare hex, truncated or full.
const DIGEST = /^(sha256:)?[0-9a-f]{6,64}$/;

// --- the schema, as data ------------------------------------------------------
//
// One closed allowlist per nesting level. `required` fields must be present;
// everything else must be present OR the whole block may be null where the
// block itself is nullable. There is deliberately no "any object" branch.

const REPORTED_FIELDS = {
  promptEvalCount: nullOr(isNonNegativeFinite),
  promptEvalDurationNs: nullOr(isNonNegativeFinite),
  evalCount: nullOr(isNonNegativeFinite),
  evalDurationNs: nullOr(isNonNegativeFinite),
  loadDurationNs: nullOr(isNonNegativeFinite),
  totalDurationNs: nullOr(isNonNegativeFinite),
};

const OBSERVED_FIELDS = {
  elapsedMs: nullOr(isNonNegativeFinite),
  timeToFirstTokenMs: nullOr(isNonNegativeFinite),
  timeToFirstVisibleTokenMs: nullOr(isNonNegativeFinite),
};

const RESIDENCY_FIELDS = {
  sizeBytes: isNonNegativeFinite,
  sizeVramBytes: isNonNegativeFinite,
};

function checkBlock(value, fields, blockName, { nullable = false } = {}) {
  if (value === null) {
    return nullable ? null : `${blockName} must be an object`;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return `${blockName} must be an object`;
  }
  for (const key of Object.keys(value)) {
    if (!(key in fields)) return `unknown field: ${blockName}.${key}`;
  }
  for (const [key, check] of Object.entries(fields)) {
    if (!(key in value)) return `missing field: ${blockName}.${key}`;
    if (!check(value[key])) return `invalid value for ${blockName}.${key}`;
  }
  return null;
}

/**
 * Validate one measurement record against schema v1.
 *
 * PURE, and the only gate between a caller and the file. Returns a reason
 * string a maintainer can act on — naming the offending field, never echoing
 * its value, because the value is exactly what must not travel.
 */
export function validateMeasurement(record) {
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    return { ok: false, reason: "record must be an object" };
  }

  const TOP = {
    measurementSchemaVersion: (v) => v === MEASUREMENT_SCHEMA_VERSION,
    recordedAt: boundedString(40, ISO_8601),
    source: (v) => MEASUREMENT_SOURCES.includes(v),
    model: () => true, // checked structurally below
    runtime: () => true,
    reported: () => true,
    observed: () => true,
    residencyAfter: () => true,
    environmentHash: nullOr(boundedString(64, HEX)),
  };

  for (const key of Object.keys(record)) {
    if (!(key in TOP)) return { ok: false, reason: `unknown field: ${key}` };
  }
  for (const [key, check] of Object.entries(TOP)) {
    if (!(key in record)) return { ok: false, reason: `missing field: ${key}` };
    if (!check(record[key])) return { ok: false, reason: `invalid value for ${key}` };
  }

  const model = checkBlock(record.model, {
    name: boundedString(200),
    digest: nullOr(boundedString(72, DIGEST)),
  }, "model");
  if (model) return { ok: false, reason: model };

  const runtime = checkBlock(record.runtime, {
    name: (v) => v === "ollama",
    version: nullOr(boundedString(64)),
  }, "runtime");
  if (runtime) return { ok: false, reason: runtime };

  const reported = checkBlock(record.reported, REPORTED_FIELDS, "reported");
  if (reported) return { ok: false, reason: reported };

  const observed = checkBlock(record.observed, OBSERVED_FIELDS, "observed");
  if (observed) return { ok: false, reason: observed };

  const residency = checkBlock(record.residencyAfter, RESIDENCY_FIELDS, "residencyAfter", {
    nullable: true,
  });
  if (residency) return { ok: false, reason: residency };

  return { ok: true };
}

/** Convenience for tests and future producers: a minimal valid record shape. */
export function emptyMeasurement({ recordedAt, source, modelName }) {
  return {
    measurementSchemaVersion: MEASUREMENT_SCHEMA_VERSION,
    recordedAt,
    source,
    model: { name: modelName, digest: null },
    runtime: { name: "ollama", version: null },
    reported: {
      promptEvalCount: null,
      promptEvalDurationNs: null,
      evalCount: null,
      evalDurationNs: null,
      loadDurationNs: null,
      totalDurationNs: null,
    },
    observed: { elapsedMs: null, timeToFirstTokenMs: null, timeToFirstVisibleTokenMs: null },
    residencyAfter: null,
    environmentHash: null,
  };
}

/**
 * Append one measurement, validation-gated. Refusal is an ordinary result with
 * a reason, never a throw — and a refused record touches the disk not at all.
 */
export async function appendMeasurement(dir, record) {
  const verdict = validateMeasurement(record);
  if (!verdict.ok) return verdict;
  await appendRecord(path.join(dir, MEASUREMENTS_FILE), record);
  return { ok: true };
}

/**
 * Read the history, honestly bucketed:
 *   records        — valid v1 records, in append order
 *   newerSchema    — records from a FUTURE schema version: counted, not guessed at
 *   invalidRecords — parsed JSON that fails validation (a hand-edited file)
 *   invalidLines / tornTail — from the JSONL layer (corruption vs crash artifact)
 */
export async function readMeasurements(dir) {
  const raw = await readRecords(path.join(dir, MEASUREMENTS_FILE));
  const out = {
    exists: raw.exists,
    records: [],
    newerSchema: 0,
    invalidRecords: 0,
    invalidLines: raw.invalidLines,
    tornTail: raw.tornTail,
  };
  if (raw.error) out.error = raw.error;

  for (const record of raw.records) {
    const version = record?.measurementSchemaVersion;
    if (typeof version === "number" && version > MEASUREMENT_SCHEMA_VERSION) {
      out.newerSchema += 1;
      continue;
    }
    if (validateMeasurement(record).ok) out.records.push(record);
    else out.invalidRecords += 1;
  }
  return out;
}

/**
 * Delete the measurement history. THE PACKAGE'S FIRST DELETION, and its whole
 * shape is containment: no caller-supplied path, no id, no pattern — the one
 * deletable thing is the one file this module itself writes, joined from the
 * store directory and a constant. It cannot reach a model, a config, or
 * anything this tool did not create, because there is no parameter with which
 * to name one.
 *
 * `force: true` because clearing an empty history is a no-op, not an error;
 * `existed` tells the caller which of the two happened.
 */
export async function clearMeasurements(dir) {
  const file = path.join(dir, MEASUREMENTS_FILE);
  let existed = true;
  try {
    await fsp.access(file);
  } catch {
    existed = false;
  }
  await fsp.rm(file, { force: true });
  return { ok: true, existed };
}
