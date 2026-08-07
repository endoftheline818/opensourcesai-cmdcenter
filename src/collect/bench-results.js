// The known bench-results location — the read-only half of a deliberate
// cross-repo pair. osai-bench 0.12+ writes result JSON into
// `~/.osai/bench-results/` by default; this module lets the Bench view say
// "found 3 results" instead of requiring a drag-and-drop hunt for files the
// user may not remember saving.
//
// STRICTLY READ-ONLY, BY SHAPE. There is no write and no delete here, and the
// read cannot be aimed: the directory is derived from the home directory and a
// constant (never from a request), and a result is named by a bare filename
// that must clear a conservative pattern AND a resolved-path containment
// check — the same two-layer discipline the conversation store's deletion
// uses, applied to a read. A request cannot name a path, only a file that
// already sits in the one known directory.
//
// The directory belongs to bench, not to this tool: absent is a normal state
// (bench never ran, or an older bench wrote elsewhere), reported as
// `exists: false` rather than treated as an error — and nothing here creates
// it, because a directory this tool created would be an empty promise that
// bench had.

import os from "node:os";
import path from "node:path";
import fsp from "node:fs/promises";

/**
 * What a result file may be called. Conservative on purpose: one bare
 * filename, no separators of any kind (which is what makes traversal
 * unspellable rather than merely checked), no leading dot, `.json` required.
 * Bench's own timestamped names clear it; so do reasonable `--output` names.
 */
export const RESULT_FILENAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}\.json$/;

/**
 * Matches the server's inspect body cap: a file too large to POST through the
 * drop-zone is refused at the same size when read from disk — the two intake
 * paths must not disagree about what a plausible result is.
 */
export const MAX_RESULT_BYTES = 2 * 1024 * 1024;

/** Bench's default `--output` directory, spelled identically to bench's own resolver. */
export function benchResultsDirectory({ home = os.homedir() } = {}) {
  return path.join(home, ".osai", "bench-results");
}

/**
 * List what the directory holds: candidate filenames with size and mtime,
 * newest first. Non-files, foreign names, and entries lost to races are
 * skipped silently — this is a scan of someone else's output directory, not
 * an audit of it. Parsing and validation happen only when one file is opened.
 */
export async function listBenchResults(directory) {
  let entries;
  try {
    entries = await fsp.readdir(directory, { withFileTypes: true });
  } catch {
    return { exists: false, results: [] };
  }
  const results = [];
  for (const entry of entries) {
    if (!entry.isFile() || !RESULT_FILENAME_PATTERN.test(entry.name)) continue;
    try {
      const stat = await fsp.stat(path.join(directory, entry.name));
      results.push({
        name: entry.name,
        sizeBytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      });
    } catch {
      // Deleted between readdir and stat — it honestly is not there to list.
    }
  }
  results.sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : a.modifiedAt > b.modifiedAt ? -1 : 0));
  return { exists: true, results };
}

/**
 * Read one named result. The refusal reason never echoes the offending name —
 * the name is exactly the thing an attacker controls.
 */
export async function readBenchResult(directory, name) {
  if (typeof name !== "string" || !RESULT_FILENAME_PATTERN.test(name)) {
    return { ok: false, reason: "not a recognized result filename" };
  }
  const file = path.resolve(directory, name);
  // Belt to the pattern's braces: whatever the name was, the file we are
  // about to open must sit DIRECTLY in the known directory.
  if (path.dirname(file) !== path.resolve(directory)) {
    return { ok: false, reason: "not a recognized result filename" };
  }
  let stat;
  try {
    stat = await fsp.stat(file);
  } catch {
    return { ok: false, reason: "that result file does not exist" };
  }
  if (!stat.isFile()) return { ok: false, reason: "that result file does not exist" };
  if (stat.size > MAX_RESULT_BYTES) {
    return { ok: false, reason: "the file is too large to be a bench result" };
  }
  let record;
  try {
    record = JSON.parse(await fsp.readFile(file, "utf8"));
  } catch {
    return { ok: false, reason: "the file is not valid JSON" };
  }
  return { ok: true, record };
}
