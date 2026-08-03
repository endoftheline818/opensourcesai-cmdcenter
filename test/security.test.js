import test from "node:test";
import assert from "node:assert/strict";
import {
  TOKEN_HEADER,
  authorize,
  createSessionToken,
  hostnameOf,
  isAllowedHost,
  isAllowedOrigin,
  securityHeaders,
  tokensMatch,
} from "../src/serve/security.js";

const TOKEN = "a".repeat(64);
// `headers` is merged explicitly and `overrides` spread FIRST, because
// spreading overrides last would replace the merged headers object wholesale
// and silently defeat every per-header case below.
const req = ({ headers, ...rest } = {}) => ({
  method: "GET",
  ...rest,
  headers: { host: "127.0.0.1:7717", [TOKEN_HEADER]: TOKEN, ...headers },
});

test("session tokens are long, random, and distinct", () => {
  const a = createSessionToken();
  const b = createSessionToken();
  assert.equal(a.length, 64, "256 bits as hex");
  assert.notEqual(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test("token comparison rejects mismatches and non-strings", () => {
  assert.equal(tokensMatch(TOKEN, TOKEN), true);
  assert.equal(tokensMatch(TOKEN, "b".repeat(64)), false);
  assert.equal(tokensMatch(TOKEN, TOKEN.slice(0, 63)), false, "length mismatch must not throw");
  for (const bad of [undefined, null, 42, {}, []]) {
    assert.equal(tokensMatch(TOKEN, bad), false);
    assert.equal(tokensMatch(bad, TOKEN), false);
  }
});

// ANTI-DNS-REBINDING. A rebound request arrives with the attacker's hostname in
// the Host header even though it resolves to 127.0.0.1, so an allowlist of
// loopback literals is the defence. Origin checks alone do not help here,
// because after rebinding the attacker's origin IS the page's origin.
test("only loopback hostnames are accepted", () => {
  for (const good of ["127.0.0.1", "127.0.0.1:7717", "localhost", "localhost:7717", "[::1]:7717"]) {
    assert.equal(isAllowedHost(good), true, `${good} should be allowed`);
  }
  for (const bad of [
    "evil.com",
    "evil.com:7717",
    "127.0.0.1.evil.com",
    "notlocalhost",
    "localhost.evil.com",
    "192.168.1.50:7717",
    "0.0.0.0:7717",
    "",
    undefined,
    null,
  ]) {
    assert.equal(isAllowedHost(bad), false, `${bad} must be rejected`);
  }
});

test("hostnameOf strips ports without mangling IPv6 literals", () => {
  assert.equal(hostnameOf("127.0.0.1:7717"), "127.0.0.1");
  assert.equal(hostnameOf("[::1]:7717"), "[::1]");
  assert.equal(hostnameOf("localhost"), "localhost");
  assert.equal(hostnameOf(""), null);
});

test("origin must match exactly — no prefix or substring matching", () => {
  assert.equal(isAllowedOrigin(undefined, 7717), true, "absent origin is same-origin or non-browser");
  assert.equal(isAllowedOrigin("", 7717), true);
  assert.equal(isAllowedOrigin("http://127.0.0.1:7717", 7717), true);
  assert.equal(isAllowedOrigin("http://localhost:7717", 7717), true);

  // The exact strings a naive startsWith/includes check would wrongly accept.
  for (const bad of [
    "http://127.0.0.1.evil.com:7717",
    "http://127.0.0.1:7717.evil.com",
    "https://127.0.0.1:7717",
    "http://127.0.0.1:9999",
    "http://evil.com",
    "null",
    "not a url",
  ]) {
    assert.equal(isAllowedOrigin(bad, 7717), false, `${bad} must be rejected`);
  }
});

test("authorize refuses every non-read verb", () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS", "TRACE"]) {
    const result = authorize(req({ method }), { token: TOKEN, port: 7717 });
    assert.equal(result.ok, false, `${method} must be refused`);
    assert.equal(result.status, 405);
  }
  assert.equal(authorize(req({ method: "GET" }), { token: TOKEN, port: 7717 }).ok, true);
  assert.equal(authorize(req({ method: "HEAD" }), { token: TOKEN, port: 7717 }).ok, true);
});

test("authorize enforces host, origin, and token independently", () => {
  const ok = { token: TOKEN, port: 7717 };

  assert.equal(authorize(req(), ok).ok, true);

  const badHost = authorize(req({ headers: { host: "evil.com" } }), ok);
  assert.equal(badHost.status, 403);

  const badOrigin = authorize(req({ headers: { origin: "http://evil.com" } }), ok);
  assert.equal(badOrigin.status, 403);

  const noToken = authorize(req({ headers: { [TOKEN_HEADER]: undefined } }), ok);
  assert.equal(noToken.status, 401);

  const wrongToken = authorize(req({ headers: { [TOKEN_HEADER]: "b".repeat(64) } }), ok);
  assert.equal(wrongToken.status, 401);
});

test("assets may skip the token but never the host check", () => {
  const opts = { token: TOKEN, port: 7717, requireToken: false };
  assert.equal(authorize(req({ headers: { [TOKEN_HEADER]: undefined } }), opts).ok, true);
  // Even unauthenticated assets must not be reachable via a rebound hostname.
  assert.equal(authorize(req({ headers: { host: "evil.com", [TOKEN_HEADER]: undefined } }), opts).ok, false);
});

test("security headers deny by default and permit no cross-origin reads", () => {
  const headers = securityHeaders();
  assert.match(headers["content-security-policy"], /default-src 'none'/);
  assert.match(headers["content-security-policy"], /connect-src 'self'/);
  assert.match(headers["content-security-policy"], /frame-ancestors 'none'/);
  assert.equal(headers["x-content-type-options"], "nosniff");
  assert.equal(headers["cache-control"], "no-store");
  // No CORS header anywhere: a cross-origin page must not be able to read a
  // response even if it somehow issues a request.
  for (const name of Object.keys(headers)) {
    assert.doesNotMatch(name, /access-control-allow/i, `${name} must not be sent`);
  }
});
