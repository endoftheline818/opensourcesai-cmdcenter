// The security model for the local dashboard. Pure functions, no I/O, so every
// rule below is directly testable.
//
// THE THREAT THIS DEFENDS AGAINST
// A local HTTP server that can read your hardware and talk to Ollama is a target
// for any web page you happen to have open. Two attacks matter, and they are not
// hypothetical — both have been demonstrated against local services, including
// against Ollama's own API:
//
//   DNS REBINDING — an attacker's domain re-resolves to 127.0.0.1, so the
//   browser treats attacker JavaScript as same-origin with this server. Origin
//   checks alone do NOT stop this, because the origin genuinely becomes theirs.
//   The defence is the Host header: a rebound request still carries the
//   attacker's hostname, so requiring a loopback Host rejects it.
//
//   CSRF — any page can make the browser issue a cross-site request. The
//   defences are a secret the attacker cannot read and a custom header they
//   cannot set without a preflight this server refuses.
//
// Defence in depth, because each layer has a known bypass on its own:
//   1. bind to loopback only (never reachable off-machine)
//   2. Host must be a loopback literal (kills rebinding)
//   3. Origin, when present, must be exactly ours (kills ordinary CSRF)
//   4. a per-session secret in a custom header (unreadable and unsettable
//      cross-origin without a preflight, which is refused)
//   5. no mutating or command-executing endpoint exists at all

import { randomBytes, timingSafeEqual } from "node:crypto";

export const TOKEN_HEADER = "x-cmdcenter-token";
export const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/** 256 bits from a CSPRNG. Never derived from time, pid, or path. */
export function createSessionToken() {
  return randomBytes(32).toString("hex");
}

/**
 * Constant-time comparison. A plain === leaks the shared prefix length through
 * timing, which is the difference between guessing a token in 2^256 attempts
 * and guessing it one byte at a time.
 */
export function tokensMatch(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Strip the port and normalise brackets so `[::1]:7717` compares as `[::1]`. */
export function hostnameOf(hostHeader) {
  if (typeof hostHeader !== "string" || hostHeader === "") return null;
  const trimmed = hostHeader.trim();
  if (trimmed.startsWith("[")) {
    const close = trimmed.indexOf("]");
    return close === -1 ? null : trimmed.slice(0, close + 1);
  }
  return trimmed.split(":")[0];
}

/**
 * Reject anything whose Host is not a loopback literal.
 *
 * This is the anti-rebinding rule, and it is why a machine name or LAN IP is
 * refused even though it would route here perfectly well: a rebound request
 * carries the attacker's hostname, so the only safe policy is an allowlist of
 * names that cannot be attacker-controlled.
 */
export function isAllowedHost(hostHeader) {
  const hostname = hostnameOf(hostHeader);
  return hostname !== null && LOOPBACK_HOSTS.has(hostname);
}

/**
 * Origin must be absent (a same-origin navigation or a non-browser client) or
 * exactly one of our own loopback origins. There is no wildcard and no
 * substring matching — `http://127.0.0.1.evil.com` must not pass, which is
 * exactly what a naive `startsWith` or `includes` check would allow.
 */
export function isAllowedOrigin(origin, port) {
  if (origin === undefined || origin === null || origin === "") return true;
  if (typeof origin !== "string") return false;
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:") return false;
  if (String(parsed.port) !== String(port)) return false;
  return LOOPBACK_HOSTS.has(parsed.hostname) || LOOPBACK_HOSTS.has(`[${parsed.hostname}]`);
}

/**
 * Authorize one request.
 *
 * @returns {{ok: true} | {ok: false, status: number, reason: string}}
 */
/**
 * The complete set of MUTATING paths. The check below is an exact-match
 * allowlist rather than a prefix or pattern — so a new mutating route cannot
 * appear by accident, only by being named here. Everything in this set changes
 * machine state (today: model residency, and nothing else).
 */
export const ACTION_PATHS = new Set(["/api/actions/load", "/api/actions/unload"]);

/**
 * POSTable paths that MUTATE NOTHING. POST here is transport, not intent: a
 * bench result file is read in the browser and its content must reach the
 * pure derive layer for validation, because duplicating those rules in the
 * browser bundle would fork them (the drift class the generated copies exist
 * to close), and a GET cannot carry a file. These handlers hold no state and
 * write nothing — asserted by the same structural guards that confine
 * mutation to src/actions and file writes to src/storage. Since the
 * results-directory pairing with bench 0.12, one of them READS:
 * results/inspect opens one file from the known
 * bench-results directory, named by a bare filename behind a
 * pattern-and-containment gate (POST because a filename must not ride a URL,
 * the same rule the conversation history follows for ids).
 *
 * Kept as a SEPARATE set from ACTION_PATHS so "the complete set of mutating
 * paths" stays a true sentence with two members. Growing either set is a
 * deliberate act; the mirror tests force the dispatcher to agree.
 */
export const INSPECT_PATHS = new Set([
  "/api/bench/inspect",
  "/api/bench/compare",
  "/api/bench/results/inspect",
]);

/**
 * The chat surface's POSTable paths (MAINTAINING §4b). `send` runs inference
 * and writes to the tool's own data directory through the storage layer;
 * `history` is POST-as-transport for a conversation id (query strings are
 * ignored by design, and an id must not ride a URL); `delete` removes one
 * conversation, with containment enforced and tested in src/storage. A third
 * set rather than a widening of the others, so each set's sentence stays
 * exactly true: ACTION_PATHS mutate Ollama residency, INSPECT_PATHS mutate
 * nothing, CHAT_PATHS run inference and manage this tool's own data.
 */
export const CHAT_PATHS = new Set(["/api/chat/send", "/api/chat/history", "/api/chat/delete"]);

/**
 * The settings pair: exactly ONE recorded setting exists — the manual
 * bandwidth figure (the honest escape hatch for GPUs the sourced table does
 * not list). `set` writes it into the tool's own data directory through the
 * storage layer's validated single-entry store; `clear` removes that one
 * file, containment-tested. Neither touches machine state, a model, or a
 * runtime — a fourth set so each set's sentence stays exactly true.
 */
export const SETTINGS_PATHS = new Set([
  "/api/settings/bandwidth/set",
  "/api/settings/bandwidth/clear",
]);

export function authorize(req, { token, port, requireToken = true, pathname = null }) {
  const isPostable =
    pathname !== null &&
    (ACTION_PATHS.has(pathname) ||
      INSPECT_PATHS.has(pathname) ||
      CHAT_PATHS.has(pathname) ||
      SETTINGS_PATHS.has(pathname));

  if (req.method === "POST") {
    if (!isPostable) {
      return { ok: false, status: 405, reason: "this endpoint is read-only" };
    }
    // A POST ALWAYS requires the session token, whatever the caller asks
    // for — actions because they change state, inspections because machine-
    // adjacent data flows through them. The `requireToken` relaxation exists
    // only for unauthenticated UI assets, and must never extend here.
    if (!tokensMatch(req.headers?.[TOKEN_HEADER], token)) {
      return { ok: false, status: 401, reason: "missing or invalid session token" };
    }
  } else if (req.method !== "GET" && req.method !== "HEAD") {
    // PUT, PATCH, DELETE and the rest have no use here and never will. Refusing
    // the verb outright means such a route cannot be reached even by mistake.
    return { ok: false, status: 405, reason: "unsupported method" };
  }
  if (!isAllowedHost(req.headers?.host)) {
    return { ok: false, status: 403, reason: "host is not a loopback address" };
  }
  if (!isAllowedOrigin(req.headers?.origin, port)) {
    return { ok: false, status: 403, reason: "origin is not this server" };
  }
  if (requireToken && !tokensMatch(req.headers?.[TOKEN_HEADER], token)) {
    return { ok: false, status: 401, reason: "missing or invalid session token" };
  }
  return { ok: true };
}

/**
 * Headers applied to every response.
 *
 * The CSP is `default-src 'none'` with only same-origin script/style added, so
 * the page cannot reach the network even if markup were somehow injected —
 * which also enforces the package-wide no-transmission property at the browser
 * layer rather than trusting the code alone.
 */
export function securityHeaders() {
  return {
    "content-security-policy":
      "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-origin",
    // No Access-Control-Allow-Origin header anywhere, deliberately: without one
    // a cross-origin page cannot read a response even if it manages to send a
    // request, and a preflight for the custom token header is refused.
    "cache-control": "no-store",
  };
}
