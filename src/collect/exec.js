// The only place this package spawns a process.
//
// SAFETY PROPERTIES, each load-bearing rather than stylistic:
//
// - execFile with an explicit argv array and NO shell. Nothing this package
//   captures is ever interpolated into a command string, so there is no
//   injection surface to reason about — it is absent by construction.
// - A hard timeout on every call. A wedged GPU driver makes `nvidia-smi` hang
//   indefinitely; a diagnostic tool that hangs while diagnosing is useless.
// - Never throws. A missing binary is an ordinary, expected result on a machine
//   that simply does not have that vendor's tooling, not an error condition.
//   Callers get {ok:false} and carry on collecting everything else.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 6000;
const MAX_BUFFER = 4 * 1024 * 1024;

/**
 * @returns {Promise<{ok: true, stdout: string, durationMs: number}
 *                  | {ok: false, error: string, durationMs: number}>}
 */
export async function run(file, args, { timeout = DEFAULT_TIMEOUT_MS } = {}) {
  const started = Date.now();
  try {
    const { stdout } = await execFileAsync(file, args, {
      timeout,
      windowsHide: true,
      maxBuffer: MAX_BUFFER,
    });
    return { ok: true, stdout: stdout.trim(), durationMs: Date.now() - started };
  } catch (err) {
    const error = err.code === "ENOENT" ? "not-found" : String(err.message).slice(0, 200);
    return { ok: false, error, durationMs: Date.now() - started };
  }
}

/**
 * Windows-only helper: run PowerShell and parse JSON from it.
 *
 * PowerShell is used rather than parsing `reg query` / `wmic` text output
 * because ConvertTo-Json gives a typed result instead of a format that changes
 * between Windows builds. It is slow — see the timing note in README — but it
 * is correct, and Phase 0 optimises for correct.
 */
export async function powershellJson(script, options) {
  const res = await run(
    "powershell",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    options,
  );
  if (!res.ok) return res;
  if (!res.stdout) return { ok: true, value: [], durationMs: res.durationMs };
  try {
    const parsed = JSON.parse(res.stdout);
    // ConvertTo-Json emits a bare object for a single result and an array for
    // several. Normalise so callers never branch on cardinality.
    return {
      ok: true,
      value: Array.isArray(parsed) ? parsed : [parsed],
      durationMs: res.durationMs,
    };
  } catch (err) {
    return {
      ok: false,
      error: `unparseable json: ${String(err.message).slice(0, 120)}`,
      durationMs: res.durationMs,
    };
  }
}
