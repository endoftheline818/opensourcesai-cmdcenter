// Where this tool's own data lives. Pure resolution — no I/O, no clock.
//
// THE BOUNDARY THIS MODULE DRAWS
// Everything the storage layer ever writes or deletes sits under ONE directory,
// resolved here and nowhere else. That is what makes "it can only touch its own
// data" a checkable property rather than a promise: the write/delete functions
// take this directory as an explicit argument, a structural test asserts file
// mutation exists only in src/storage, and a containment test asserts deletion
// never resolves outside it.
//
// The directory is a PLATFORM data dir, never the package clone. A tool that
// writes into its own checkout cannot be updated by `git pull` without risking
// user data, and `--capture` style artifacts must never be able to pick up
// stored records by walking the package tree.

import os from "node:os";
import path from "node:path";

/** Directory name under the platform data root. Matches the bin name. */
export const DATA_DIR_NAME = "osai-cmdcenter";

/** The store's own metadata file — schema version and provenance. */
export const META_FILE = "meta.json";

/** Append-only measurement history. Counters and metadata ONLY — see measurements.js. */
export const MEASUREMENTS_FILE = "measurements.jsonl";

/** The one recorded setting: a user-entered bandwidth figure — see bandwidth.js. */
export const MANUAL_BANDWIDTH_FILE = "manual-bandwidth.json";

/**
 * Resolve the data directory for this platform.
 *
 * Injection mirrors collect/tools.js: platform, home and env are parameters so
 * every branch is testable from any OS, and tests never touch the real
 * location. Callers in src/ pass nothing and get the platform default.
 *
 *   win32  %LOCALAPPDATA%\osai-cmdcenter
 *   darwin ~/Library/Application Support/osai-cmdcenter
 *   linux  $XDG_DATA_HOME/osai-cmdcenter, else ~/.local/share/osai-cmdcenter
 */
export function dataDirectory({
  platform = process.platform,
  home = os.homedir(),
  env = process.env,
} = {}) {
  if (platform === "win32") {
    const base = env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");
    return path.join(base, DATA_DIR_NAME);
  }
  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support", DATA_DIR_NAME);
  }
  const base = env.XDG_DATA_HOME ?? path.join(home, ".local", "share");
  return path.join(base, DATA_DIR_NAME);
}
