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
export function authorize(req, { token, port, requireToken = true }) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    // Phase 1 is read-only. Refusing the verb outright means a mutating route
    // cannot be reached even if one were added by mistake.
    return { ok: false, status: 405, reason: "read-only server: only GET and HEAD are accepted" };
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
