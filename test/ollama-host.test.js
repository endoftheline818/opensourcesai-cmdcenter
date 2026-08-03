import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_OLLAMA_HOST, resolveHost } from "../src/collect/ollama.js";

// REGRESSION TEST FOR A BUG FOUND ON A REAL MACHINE.
//
// OLLAMA_HOST is dual-purpose: the SERVER reads it as a bind address, a CLIENT
// reads it as a connect target. The Ollama Windows app sets it to "0.0.0.0" so
// the server listens on every interface — and a client that trusts that builds
// http://0.0.0.0 and fails instantly, reporting "Ollama not detected" on a
// machine where Ollama is running fine. That is precisely what happened during
// the port, on a box where curl 127.0.0.1:11434 answered normally.
test("wildcard bind addresses fall back to loopback rather than being trusted", () => {
  for (const wildcard of ["0.0.0.0", "::", "[::]", "*"]) {
    assert.equal(resolveHost({ OLLAMA_HOST: wildcard }), DEFAULT_OLLAMA_HOST, `${wildcard} is a bind address, not a target`);
  }
});

test("a wildcard address still preserves a deliberately moved port", () => {
  // The address was a bind directive, but the port change was intentional.
  assert.equal(resolveHost({ OLLAMA_HOST: "0.0.0.0:11500" }), "http://127.0.0.1:11500");
});

test("unset or empty falls back to loopback", () => {
  assert.equal(resolveHost({}), DEFAULT_OLLAMA_HOST);
  assert.equal(resolveHost({ OLLAMA_HOST: "" }), DEFAULT_OLLAMA_HOST);
  assert.equal(resolveHost({ OLLAMA_HOST: "   " }), DEFAULT_OLLAMA_HOST);
});

test("real connect targets are honoured, with the default port supplied", () => {
  assert.equal(resolveHost({ OLLAMA_HOST: "127.0.0.1:11434" }), "http://127.0.0.1:11434");
  assert.equal(resolveHost({ OLLAMA_HOST: "192.168.1.50" }), "http://192.168.1.50:11434");
  assert.equal(resolveHost({ OLLAMA_HOST: "192.168.1.50:9999" }), "http://192.168.1.50:9999");
  assert.equal(resolveHost({ OLLAMA_HOST: "http://box.local:11434" }), "http://box.local:11434");
  assert.equal(resolveHost({ OLLAMA_HOST: "https://box.local:443" }), "https://box.local:443");
});

test("the default target is loopback, never localhost", () => {
  // On a dual-stack host "localhost" can resolve to ::1 first while Ollama is
  // bound to v4 only, producing a confident and completely false "not installed".
  assert.match(DEFAULT_OLLAMA_HOST, /^http:\/\/127\.0\.0\.1:11434$/);
  assert.doesNotMatch(DEFAULT_OLLAMA_HOST, /localhost/);
});
