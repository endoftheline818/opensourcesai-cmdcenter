// The only place this package spawns a process.
//
// SAFETY PROPERTIES, each load-bearing rather than stylistic:
//
// - execFile with an explicit argv array and NO shell. Nothing this package
//   captures is ever interpolated into a command string, so there is no
//   injection surface to reason about — it is absent by construction.
// - A hard timeout on every call. A wedged GPU driver makes `nvidia-smi` hang
//   indefinitely; a diagnostic tool that hangs while diagnosing is useless.
//   The kill is reported as "timed-out", distinct from every answer-shaped
//   failure, so no caller can mistake a probe that never answered for one
//   that did.
// - Never throws. A missing binary is an ordinary, expected result on a machine
//   that simply does not have that vendor's tooling, not an error condition.
//   Callers get {ok:false} and carry on collecting everything else.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 6000;
const MAX_BUFFER = 4 * 1024 * 1024;

/**
 * Three failure shapes, and the third exists for honesty rather than detail:
 *
 *   "not-found" — the binary is absent (ENOENT). Ordinary on a machine that
 *                 does not have that vendor's tooling.
 *   "timed-out" — the child was killed before it exited: by our own hard
 *                 timeout in practice, by anything delivering a signal in
 *                 principle. Either way it never answered, and callers must
 *                 be able to tell "no answer" from an answer — treating a
 *                 timeout as a definite result is the unavailable-reported-
 *                 as-zero mistake this package refuses everywhere else. Seen
 *                 for real: on a cold CI runner `where node` outlived its
 *                 budget and the kill was reported as node not being on PATH.
 *   message     — the binary ran and failed. That IS an answer (`which`
 *                 exiting 1 means "not on PATH"), so the message is kept.
 *
 * The platform shape of a kill varies (exit code 1 and no signal on Windows,
 * SIGTERM on POSIX; execFile's own `killed` flag when its timeout fired),
 * which is exactly why the classification lives here instead of leaving every
 * caller a message to parse. A maxBuffer overflow also kills the child, but
 * it is not a timeout — its own message survives.
 */
function failureReason(err) {
  if (err.code === "ENOENT") return "not-found";
  if (err.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return String(err.message).slice(0, 200);
  if (err.killed || err.signal) return "timed-out";
  return String(err.message).slice(0, 200);
}

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
    return { ok: false, error: failureReason(err), durationMs: Date.now() - started };
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
