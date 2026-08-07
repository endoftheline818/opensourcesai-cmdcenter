// Opening the store — where the version discipline is enforced.
//
// THE MIGRATION RULE, FROM DAY ONE
// meta.json records which STORAGE_SCHEMA_VERSION laid the directory out. A
// client that opens a store and finds a HIGHER version than its own must
// refuse: that data belongs to a newer client, and "probably still readable"
// is how user data gets corrupted by well-meaning code. Refusal is loud and
// names both versions. A LOWER version on disk is the future-migration seam —
// v1 is the first version, so today it cannot occur, and the branch below
// refuses it too rather than pretending a migration path exists.
//
// A corrupt meta.json is never overwritten. It is evidence of what happened,
// and the store refuses to open until a human looks — the same keep-the-
// contradiction ethos the collect layer applies to hardware sources.
//
// NO CLOCK IN HERE. `createdAt` is caller-supplied, like every timestamp in
// this package — the top of the CLI reads the clock once and passes it down,
// which is what keeps every layer below it snapshot-testable.

import path from "node:path";
import fsp from "node:fs/promises";
import { STORAGE_SCHEMA_VERSION } from "../version.js";
import { META_FILE } from "./paths.js";

const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Open (creating if needed) the data directory at `dir`.
 *
 * @param {string} dir Resolved data directory — from paths.js in production,
 *   a temp directory in tests. Always explicit; there is no hidden default.
 * @param {object} options
 * @param {string} options.createdAt Caller-supplied ISO timestamp, used only
 *   when the store is being created for the first time.
 * @returns {{ok: true, dir: string, meta: object, created: boolean}
 *         | {ok: false, reason: string}}
 */
export async function openStore(dir, { createdAt } = {}) {
  if (typeof createdAt !== "string" || !ISO_8601.test(createdAt)) {
    return { ok: false, reason: "createdAt must be a caller-supplied ISO-8601 timestamp" };
  }

  await fsp.mkdir(dir, { recursive: true });
  const metaPath = path.join(dir, META_FILE);

  let rawMeta = null;
  try {
    rawMeta = await fsp.readFile(metaPath, "utf8");
  } catch (err) {
    if (err.code !== "ENOENT") {
      return { ok: false, reason: `meta.json unreadable: ${String(err.message).slice(0, 120)}` };
    }
  }

  if (rawMeta === null) {
    const meta = { storageSchemaVersion: STORAGE_SCHEMA_VERSION, createdAt };
    // `wx`: if two processes race to create the store, exactly one wins and the
    // other re-reads — nobody half-overwrites a meta file.
    try {
      await fsp.writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`, { flag: "wx" });
      return { ok: true, dir, meta, created: true };
    } catch {
      try {
        rawMeta = await fsp.readFile(metaPath, "utf8");
      } catch {
        return { ok: false, reason: "could not create or read meta.json" };
      }
    }
  }

  let meta;
  try {
    meta = JSON.parse(rawMeta);
  } catch {
    // Deliberately NOT repaired and NOT overwritten — see the module header.
    return {
      ok: false,
      reason: "meta.json is corrupt; refusing to open or overwrite it. Inspect the data directory by hand.",
    };
  }

  const version = meta?.storageSchemaVersion;
  if (version !== STORAGE_SCHEMA_VERSION) {
    return {
      ok: false,
      reason:
        `store was created by storage schema v${String(version)}; this client speaks v${STORAGE_SCHEMA_VERSION} ` +
        "and refuses to reinterpret another version's data.",
    };
  }

  return { ok: true, dir, meta, created: false };
}
