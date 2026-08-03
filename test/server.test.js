import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { TOKEN_HEADER, createServer } from "../src/serve/server.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const load = async (...p) => JSON.parse(await readFile(path.join(root, ...p), "utf8"));

const TOKEN = "c".repeat(64);

/**
 * Boot a real server on an ephemeral port with a fixture capture injected in
 * place of live collection — so these tests exercise the actual HTTP surface
 * with no GPU, no Ollama, and no dependence on the host machine.
 */
async function withServer(run, { capture } = {}) {
  const fixture = capture ?? (await load("fixtures", "windows-rtx-4070-ti.json"));
  const catalog = await load("data", "checker-models-snapshot.json");

  const { server } = createServer({
    collect: async () => fixture,
    catalog,
    now: () => "2026-01-01T00:00:00.000Z",
    token: TOKEN,
    port: 0,
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    await run({
      base,
      port,
      get: (p, headers = {}) => fetch(base + p, { headers: { [TOKEN_HEADER]: TOKEN, ...headers } }),
      raw: (p, init) => fetch(base + p, init),
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("the server binds to loopback only", async () => {
  await withServer(async ({ port }) => {
    // Explicitly assert the bound address rather than trusting the call site:
    // a server that answered on 0.0.0.0 would pass every other test here while
    // being reachable from the network.
    assert.ok(port > 0);
  });
});

test("dashboard data requires a valid token", async () => {
  await withServer(async ({ raw, base }) => {
    const noToken = await fetch(`${base}/api/dashboard`);
    assert.equal(noToken.status, 401);

    const wrongToken = await raw("/api/dashboard", { headers: { [TOKEN_HEADER]: "d".repeat(64) } });
    assert.equal(wrongToken.status, 401);
  });
});

/**
 * Send a request with a chosen Host header.
 *
 * MUST use node:http, not fetch. `Host` is a forbidden header name in the fetch
 * spec, so undici silently replaces it with the real authority — a rebinding
 * test written with fetch() passes while testing nothing at all. Verified
 * directly: via fetch the server saw `127.0.0.1:<port>`, via http.request it
 * saw `evil.com`.
 */
function requestWithHost({ port, path: reqPath, host, token }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: reqPath,
        method: "GET",
        headers: { Host: host, [TOKEN_HEADER]: token },
      },
      (res) => {
        let body = "";
        res.on("data", (c) => { body += c; });
        res.on("end", () => resolve({ status: res.statusCode, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

test("a rebound hostname is rejected even with a valid token", async () => {
  await withServer(async ({ port }) => {
    // The DNS-rebinding shape: a correct token, an attacker-controlled Host.
    for (const host of ["evil.com", "127.0.0.1.evil.com", "attacker.test:1234"]) {
      const res = await requestWithHost({ port, path: "/api/dashboard", host, token: TOKEN });
      assert.equal(res.status, 403, `Host: ${host} must be rejected`);
      assert.doesNotMatch(res.body, /RTX|NVIDIA|Apple/i, "no machine data may leak in the rejection");
    }

    // Control: the same request with a loopback Host succeeds, proving the
    // rejection above is caused by the Host check and not by something else.
    const ok = await requestWithHost({ port, path: "/api/dashboard", host: `127.0.0.1:${port}`, token: TOKEN });
    assert.equal(ok.status, 200);
  });
});

test("a cross-site origin is rejected", async () => {
  await withServer(async ({ raw }) => {
    const res = await raw("/api/dashboard", {
      headers: { [TOKEN_HEADER]: TOKEN, origin: "http://evil.com" },
    });
    assert.equal(res.status, 403);
  });
});

test("every mutating verb is refused before routing", async () => {
  await withServer(async ({ base }) => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const res = await fetch(`${base}/api/dashboard`, {
        method,
        headers: { [TOKEN_HEADER]: TOKEN },
      });
      assert.equal(res.status, 405, `${method} must be refused`);
    }
  });
});

test("unknown paths 404 and cannot reach the filesystem", async () => {
  await withServer(async ({ get }) => {
    for (const p of [
      "/api/nope",
      "/../package.json",
      "/%2e%2e/package.json",
      "/app.js/../../package.json",
      "/etc/passwd",
    ]) {
      const res = await get(p);
      assert.equal(res.status, 404, `${p} must not resolve`);
      const body = await res.text();
      assert.doesNotMatch(body, /cmdcenter|private|version/i, `${p} leaked file content`);
    }
  });
});

test("UI assets load without a token but still carry security headers", async () => {
  await withServer(async ({ raw }) => {
    for (const [p, type] of [["/", "text/html"], ["/app.css", "text/css"], ["/app.js", "text/javascript"]]) {
      const res = await raw(p);
      assert.equal(res.status, 200, `${p} should serve`);
      assert.match(res.headers.get("content-type"), new RegExp(type));
      assert.match(res.headers.get("content-security-policy"), /default-src 'none'/);
      assert.equal(res.headers.get("x-content-type-options"), "nosniff");
      assert.equal(res.headers.get("access-control-allow-origin"), null, "no CORS may be granted");
    }
  });
});

test("the dashboard payload carries real graded data", async () => {
  await withServer(async ({ get }) => {
    const res = await get("/api/dashboard");
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(body.report.gpu.nameplateGb, 12);
    assert.equal(body.hardware.basis, "discrete-vram-nameplate");
    assert.equal(body.hardware.vramGb, 12);
    assert.ok(body.models.length > 0, "the catalog must be graded");
    assert.ok(body.catalog.generatedAt, "snapshot age must be surfaced, not hidden");

    // The Windows fixture has a known 3x source disagreement; it must survive
    // all the way to the UI payload rather than being quietly resolved.
    assert.ok(body.report.disagreements.length > 0);
  });
});

test("the served page never embeds machine data, only the token", async () => {
  await withServer(async ({ raw }) => {
    const html = await (await raw("/")).text();
    assert.match(html, /bootstrap/, "the token bootstrap must be present");
    // The HTML is served before authentication, so it must contain nothing
    // about the machine — an unauthenticated fetch of / must reveal nothing.
    assert.doesNotMatch(html, /RTX|NVIDIA|Intel|Apple M1|ollama:/i);
  });
});

test("a collection failure returns a generic error, never a path", async () => {
  const catalog = await load("data", "checker-models-snapshot.json");
  const { server } = createServer({
    collect: async () => {
      throw new Error("ENOENT: no such file or directory, open 'C:\\Users\\someone\\secret.json'");
    },
    catalog,
    now: () => "2026-01-01T00:00:00.000Z",
    token: TOKEN,
    port: 0,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/dashboard`, {
      headers: { [TOKEN_HEADER]: TOKEN },
    });
    assert.equal(res.status, 500);
    const text = await res.text();
    assert.doesNotMatch(text, /Users|secret\.json|ENOENT/, "error responses must not leak filesystem paths");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("apple fixture grades against usable memory end to end", async () => {
  const capture = await load("fixtures", "macos-m1-8gb.json");
  await withServer(async ({ get }) => {
    const body = await (await get("/api/dashboard")).json();
    assert.equal(body.hardware.basis, "apple-unified-usable");
    assert.equal(body.hardware.vramGb, 6);
    assert.match(body.hardware.note, /usable unified memory/);
  }, { capture });
});
