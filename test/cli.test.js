import test from "node:test";
import assert from "node:assert/strict";
import { TOKEN_HEADER } from "../src/serve/server.js";
import { loadCatalog, main, startDashboard } from "../src/cli.js";

const capture = () => {
  const chunks = [];
  return { write: (s) => chunks.push(s), text: () => chunks.join("") };
};

test("--help and --version are handled without touching the machine", async () => {
  const help = capture();
  assert.equal(await main(["node", "cli", "--help"], help), 0);
  assert.match(help.text(), /osai-cmdcenter \[command\] \[options\]/);
  assert.match(help.text(), /serve/);
  // Was /read-only/i, which Phase 2 made false. The help text must state the
  // guarantee that actually holds — nothing downloaded, nothing destroyed —
  // rather than one that stopped being true when load/unload shipped.
  assert.match(help.text(), /never pulls, deletes or removes/i, "the standing guarantee belongs in the help text");
  assert.doesNotMatch(help.text(), /tool is read-only/i, "the stale read-only claim must be gone");

  const version = capture();
  assert.equal(await main(["node", "cli", "--version"], version), 0);
  assert.match(version.text().trim(), /^\d+\.\d+\.\d+$/);
});

test("an invalid --port is rejected before anything is started", async () => {
  for (const bad of ["0", "-1", "99999", "abc", ""]) {
    const out = capture();
    const code = await main(["node", "cli", "serve", "--port", bad], out);
    assert.equal(code, 1, `--port ${bad} must be rejected`);
    assert.match(out.text(), /Invalid --port/);
  }
});

test("the catalog snapshot loads and carries its provenance", async () => {
  const catalog = await loadCatalog();
  assert.ok(Array.isArray(catalog.models) && catalog.models.length > 0);
  assert.ok(catalog.source?.generatedAt, "snapshot age must be available to display");
  assert.equal(catalog.modelCount, catalog.models.length);
});

// REGRESSION TEST FOR A BUG THAT REACHED RUNTIME.
//
// The serve wiring used to live inline inside main()'s serve branch, where no
// test could reach it. A temporal-dead-zone reference (`capturedAt: now` used
// above the `const now` declaration) shipped and only surfaced when the server
// was started by hand. Booting the real path here on an ephemeral port is what
// makes that class of error impossible to miss again.
test("the real serve wiring boots, serves live telemetry, and closes", async () => {
  const { server, token, url } = await startDashboard({ port: 0 });
  try {
    const { port } = server.address();
    assert.ok(port > 0);
    assert.match(url, /^http:\/\/127\.0\.0\.1:/, "must advertise a loopback URL");

    const base = `http://127.0.0.1:${port}`;
    const get = (p) => fetch(base + p, { headers: { [TOKEN_HEADER]: token } });

    const health = await get("/api/health");
    assert.equal(health.status, 200);

    // The live endpoint must work against this machine, whatever it has
    // installed — no GPU and no Ollama are both valid states.
    const live = await (await get("/api/live")).json();
    assert.equal(live.available, true);
    assert.ok(Array.isArray(live.gauges) && live.gauges.length > 0, "gauges must be produced");
    assert.ok("reachable" in live.loaded);

    for (const gauge of live.gauges) {
      assert.ok(typeof gauge.id === "string" && gauge.id.length > 0);
      assert.ok(["normal", "warn", "critical", "unknown"].includes(gauge.severity));
      // The invariant worth protecting: unavailable never masquerades as zero.
      if (!gauge.available) assert.equal(gauge.percent, null);
      if (gauge.available) assert.ok(gauge.percent >= 0 && gauge.percent <= 100);
    }

    // Memory is present on every machine, so it must always be measurable —
    // if this ever reports unavailable, the collector is broken rather than
    // the platform being limited.
    const ram = live.gauges.find((g) => g.id === "ram");
    assert.ok(ram && ram.available, "system memory must always be measurable");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("live polling is cached between rapid requests", async () => {
  const { server, token } = await startDashboard({ port: 0 });
  try {
    const { port } = server.address();
    const get = () =>
      fetch(`http://127.0.0.1:${port}/api/live`, { headers: { [TOKEN_HEADER]: token } }).then((r) => r.json());

    await get();
    const second = await get();
    // Two calls back to back land inside the rate-limit window, so the second
    // must be served from cache rather than spawning another nvidia-smi.
    assert.equal(second.cached, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
