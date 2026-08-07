import test from "node:test";
import assert from "node:assert/strict";
import { collectTools, mcpConfigPaths, parseMcpConfig, probeOutcome, safeBasename, summariseServer, toolLocations } from "../src/collect/tools.js";
import { buildToolsPayload, exportableTools } from "../src/derive/tools.js";

// A config shaped like a real one, carrying sentinels no real secret would
// match. Testing redaction against synthetic values means the suite never has
// to read anybody's actual credentials to prove they cannot leak.
const SENTINEL = "SENTINEL_SECRET_VALUE_ZZZ";
const SYNTHETIC = {
  mcpServers: {
    github: {
      command: "C:\\Users\\somebody\\AppData\\npm\\npx.cmd",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_TOKEN: SENTINEL, LOG_LEVEL: "debug" },
    },
    "internal-db": {
      command: "/home/somebody/.local/bin/uvx",
      args: ["--from", "/home/somebody/secret-project", "db-server"],
      env: { DATABASE_PASSWORD: SENTINEL, API_KEY: SENTINEL },
    },
    remote: {
      url: "https://user:" + SENTINEL + "@mcp.example.com/sse",
    },
  },
};

// THE GUARANTEE THIS WHOLE MODULE EXISTS TO KEEP.
// MCP configs hold live credentials. `--capture` writes the collected object
// straight to disk for bug reports, so a value that survives collection can end
// up in a file someone pastes into a public issue.
test("no environment value survives collection, anywhere in the output", () => {
  const servers = parseMcpConfig(SYNTHETIC);
  const serialized = JSON.stringify(servers);

  assert.doesNotMatch(serialized, new RegExp(SENTINEL), "a credential value survived redaction");
  // The remote server's URL embeds the secret in userinfo — so the URL itself
  // must never be returned, not merely scrubbed.
  assert.doesNotMatch(serialized, /mcp\.example\.com/, "a remote URL survived, and URLs can carry credentials");
});

test("env var NAMES are kept, because a name is not a secret", () => {
  const [github] = parseMcpConfig(SYNTHETIC);
  assert.deepEqual(github.envVarNames, ["GITHUB_TOKEN", "LOG_LEVEL"]);
  assert.equal(github.envVarCount, 2);
  // Only GITHUB_TOKEN is secret-shaped; LOG_LEVEL is not.
  assert.equal(github.secretShapedEnvCount, 1);
});

test("no home directory or username survives collection", () => {
  const serialized = JSON.stringify(parseMcpConfig(SYNTHETIC));
  assert.doesNotMatch(serialized, /somebody/, "a username leaked through a path");
  assert.doesNotMatch(serialized, /C:\\\\Users|\/home\/|\/Users\//, "a home directory leaked");
  // The command is reduced to its basename, which is the useful part.
  assert.equal(parseMcpConfig(SYNTHETIC)[0].command, "npx.cmd");
});

// REGRESSION TEST FOR A REAL PRIVACY BUG THAT ONLY CI CAUGHT.
//
// The first version used path.basename, which is platform-dependent: on POSIX
// it does not treat "\" as a separator, so a Windows path read on macOS or
// Linux came back whole — username included. Windows CI passed while both
// other platforms failed.
//
// Config files genuinely cross platforms (synced dotfiles, WSL, a repo checked
// out on two machines), so the separator in the DATA cannot be assumed to match
// the separator of the HOST. Both directions are asserted here so the test
// fails on every runner, not just the ones whose separator differs.
test("a path is reduced to its last segment regardless of separator", () => {
  assert.equal(safeBasename("C:\\Users\\someone\\AppData\\npm\\npx.cmd"), "npx.cmd");
  assert.equal(safeBasename("/home/someone/.local/bin/uvx"), "uvx");
  assert.equal(safeBasename("C:/Users/someone/mixed/path.exe"), "path.exe");
  assert.equal(safeBasename("C:\\Users\\someone/mixed\\separators.js"), "separators.js");
  assert.equal(safeBasename("bare-command"), "bare-command");
  for (const empty of ["", null, undefined, 42]) assert.equal(safeBasename(empty), null);
});

test("both separator styles are redacted whatever platform is reading", () => {
  // The Windows-path case is what shipped broken; the POSIX one is its mirror.
  const windowsStyle = parseMcpConfig({
    mcpServers: { a: { command: "C:\\Users\\wintel\\bin\\node.exe", args: [], env: {} } },
  });
  const posixStyle = parseMcpConfig({
    mcpServers: { a: { command: "/home/nixuser/bin/node", args: [], env: {} } },
  });

  assert.equal(windowsStyle[0].command, "node.exe");
  assert.equal(posixStyle[0].command, "node");
  assert.doesNotMatch(JSON.stringify(windowsStyle), /wintel/, "a Windows username leaked");
  assert.doesNotMatch(JSON.stringify(posixStyle), /nixuser/, "a POSIX username leaked");
});

test("a package specifier is reported but a filesystem path is not", () => {
  const servers = parseMcpConfig(SYNTHETIC);
  const github = servers.find((s) => s.name === "github");
  const internal = servers.find((s) => s.name === "internal-db");

  // Scoped npm specifiers say WHAT a server is, and carry no user data.
  assert.equal(github.packageHint, "@modelcontextprotocol/server-github");
  // "--from" is a flag and "/home/somebody/secret-project" is a path, so the
  // first safe argument is the bare name.
  assert.equal(internal.packageHint, "db-server");
});

test("transport is classified without returning the endpoint", () => {
  const servers = parseMcpConfig(SYNTHETIC);
  assert.equal(servers.find((s) => s.name === "github").transport, "stdio");
  assert.equal(servers.find((s) => s.name === "remote").transport, "remote");
  assert.equal(summariseServer("odd", {}).transport, "unknown");
});

test("malformed or absent configs are ordinary results, not errors", () => {
  assert.deepEqual(parseMcpConfig(null), []);
  assert.deepEqual(parseMcpConfig({}), []);
  assert.deepEqual(parseMcpConfig({ mcpServers: null }), []);
  assert.deepEqual(parseMcpConfig({ mcpServers: "nope" }), []);
  assert.doesNotThrow(() => summariseServer("x", null));
});

// THE SHAREABLE BLOCK IS STRICTER THAN THE SCREEN.
// Server names are user-chosen and can reveal what someone works on; config
// filenames identify which products they run; env var names hint at which
// vendors hold their credentials. Counts answer the question a shared report
// exists to answer without any of that.
test("only counts reach the shareable block", () => {
  const payload = buildToolsPayload({
    mcpClients: [{ client: "Claude Desktop", present: true, configFile: "claude_desktop_config.json", servers: parseMcpConfig(SYNTHETIC) }],
    tools: [{ name: "Ollama", installed: true }, { name: "Jan", installed: false }],
  });
  const exported = exportableTools(payload);

  assert.deepEqual(Object.keys(exported).sort(), ["local_tools", "mcp_clients", "mcp_servers"]);
  for (const value of Object.values(exported)) assert.equal(typeof value, "number");

  const serialized = JSON.stringify(exported);
  assert.doesNotMatch(serialized, /github|internal-db|GITHUB_TOKEN|claude_desktop/i, "an identifying detail reached the shareable block");
});

test("aggregates distinguish total servers from distinct ones", () => {
  // The same server configured in two clients is two configurations of one
  // thing; conflating them would overstate how much is set up.
  const shared = { command: "npx", args: ["@x/server"], env: {} };
  const payload = buildToolsPayload({
    mcpClients: [
      { client: "Claude Desktop", present: true, servers: parseMcpConfig({ mcpServers: { a: shared, b: shared } }) },
      { client: "Cursor", present: true, servers: parseMcpConfig({ mcpServers: { a: shared } }) },
      { client: "Windsurf", present: false, servers: [] },
    ],
    tools: [],
  });

  assert.equal(payload.summary.serversConfigured, 3);
  assert.equal(payload.summary.distinctServers, 2);
  assert.equal(payload.summary.clientsConfigured, 2, "absent clients must not count as configured");
});

test("config paths are platform-correct and never hardcode a user", () => {
  const home = "/home/testuser";
  for (const platform of ["win32", "darwin", "linux"]) {
    const paths = mcpConfigPaths(platform, home, { APPDATA: "/appdata", LOCALAPPDATA: "/localappdata" });
    assert.ok(paths.length >= 4, `${platform} should probe several clients`);
    assert.ok(paths.every((p) => p.client && p.file));
    assert.ok(paths.some((p) => /claude_desktop_config\.json$/.test(p.file)), `${platform} must look for Claude Desktop`);
  }
  // Separator-agnostic on purpose. `path.join` uses the RUNTIME separator, not
  // the platform argument, so the win32 branch yields backslashes on Windows
  // and forward slashes on Linux CI. That is fine in real use — the argument
  // defaults to the actual platform — but it means a literal path assertion
  // here would pass on one runner and fail on another.
  const win = mcpConfigPaths("win32", home, { APPDATA: "/appdata" });
  const normalized = win[0].file.replace(/\\/g, "/");
  assert.match(normalized, /^\/appdata\//, "Windows must honour APPDATA rather than assuming a location");
});

test("tool locations differ per platform", () => {
  const mac = toolLocations("darwin", "/Users/t", {});
  assert.ok(mac.some((t) => t.dir.includes(".app")), "macOS tools live in .app bundles");
  const linux = toolLocations("linux", "/home/t", {});
  assert.ok(linux.every((t) => !t.dir.includes(".app")));
});

// Runs against the real machine — it must be honest whatever is installed here.
test("collectTools works on this machine without leaking a path", async () => {
  const inventory = await collectTools();
  assert.ok(Array.isArray(inventory.mcpClients) && inventory.mcpClients.length > 0);
  assert.ok(Array.isArray(inventory.tools));
  assert.ok(inventory.note, "the incompleteness of detection must be stated");

  const serialized = JSON.stringify(inventory);
  assert.doesNotMatch(serialized, /C:\\\\Users\\\\[^\\\\"]+|\/Users\/[^/"]+|\/home\/[^/"]+/, "a home directory leaked into the inventory");

  for (const client of inventory.mcpClients) {
    for (const server of client.servers) {
      assert.equal(typeof server.name, "string");
      assert.ok(Array.isArray(server.envVarNames));
      assert.equal("env" in server, false, "the raw env block must never be carried through");
      assert.equal("url" in server, false, "a remote URL must never be carried through");
      assert.equal("args" in server, false, "raw argv must never be carried through");
    }
  }
});

// ---------------------------------------------------------------------------
// Tier 1 static verdicts — located, never executed
// ---------------------------------------------------------------------------

test("verdicts map every static outcome, and remote stays declared by design", async () => {
  const { serverVerdict } = await import("../src/derive/tools.js");
  const resolution = { node: true, "gone-tool": false };

  assert.equal(serverVerdict({ transport: "stdio", command: "node" }, resolution), "config-ok");
  assert.equal(serverVerdict({ transport: "stdio", command: "gone-tool" }, resolution), "command-not-found");
  assert.equal(serverVerdict({ transport: "stdio", command: "unprobed" }, resolution), "unchecked",
    "an unanswered probe is not a verdict in either direction");
  assert.equal(serverVerdict({ transport: "unknown", command: null }, resolution), "config-broken");
  assert.equal(serverVerdict({ transport: "remote", command: null }, resolution), "declared",
    "remote servers are never probed — that would be an outbound call");
});

test("the payload carries verdicts, the not-found count, and the honesty label", async () => {
  const { buildToolsPayload } = await import("../src/derive/tools.js");
  const payload = buildToolsPayload({
    mcpClients: [{
      client: "Test Client", present: true, configFile: "c.json",
      servers: [
        { name: "good", transport: "stdio", command: "node", packageHint: null, envVarNames: [], envVarCount: 0, secretShapedEnvCount: 0 },
        { name: "gone", transport: "stdio", command: "gone-tool", packageHint: null, envVarNames: [], envVarCount: 0, secretShapedEnvCount: 0 },
        { name: "far", transport: "remote", command: null, packageHint: null, envVarNames: [], envVarCount: 0, secretShapedEnvCount: 0 },
      ],
    }],
    tools: [],
    commandResolution: { node: true, "gone-tool": false },
  });

  assert.deepEqual(payload.servers.map((s) => s.verdict), ["config-ok", "command-not-found", "declared"]);
  assert.equal(payload.summary.commandsNotFound, 1);
  assert.match(payload.verdictNote, /never executed/);
  assert.match(payload.verdictNote, /declared, not probed/);
});

test("the shareable block still carries counts only — verdicts stay on-screen", async () => {
  const { buildToolsPayload, exportableTools } = await import("../src/derive/tools.js");
  const payload = buildToolsPayload({
    mcpClients: [{ client: "C", present: true, servers: [{ name: "s", transport: "stdio", command: "gone", packageHint: null, envVarNames: [], envVarCount: 0, secretShapedEnvCount: 0 }] }],
    tools: [],
    commandResolution: { gone: false },
  });
  const exported = exportableTools(payload);
  assert.deepEqual(Object.keys(exported).sort(), ["local_tools", "mcp_clients", "mcp_servers"]);
  assert.ok(!JSON.stringify(exported).includes("command-not-found"), "a verdict names what someone runs; counts only may leave the machine");
});

// REGRESSION TEST FOR A REAL DISHONESTY THAT ONLY A COLD CI RUNNER CAUGHT.
//
// On windows-latest (run 31163686715, PR #43) the first `where node` outlived
// its 4s budget. The kill came back as a generic error string, the old
// mapping read any non-"not-found" error as the locator answering, and a
// probe that never answered was published as "command-not-found" — for the
// binary running the test. Unavailable ≠ a verdict, here as everywhere: only
// a locator that RAN and EXITED gets to say false.
test("a probe that never answered maps to null, never to a verdict", () => {
  assert.equal(probeOutcome({ ok: true, stdout: "C:\\somewhere\\node.exe" }), true);
  assert.equal(probeOutcome({ ok: false, error: "timed-out" }), null, "a timeout is not an answer");
  assert.equal(probeOutcome({ ok: false, error: "not-found" }), null, "a missing locator cannot answer");
  assert.equal(probeOutcome({ ok: false, error: "Command failed: where gone-tool" }), false,
    "a completed non-zero exit IS the answer: not on PATH");
});

test("command resolution locates real binaries without executing anything", async () => {
  const { resolveCommands } = await import("../src/collect/tools.js");
  // `node` is running this test, so it must resolve; the sentinel must not.
  const commands = ["node", "definitely-not-a-real-binary-xyz", "node", null, ""];
  let resolution = await resolveCommands(commands);
  // A null is the probe honestly saying it got no answer — seen once when a
  // cold runner pushed the first `where` past its budget. One retry gives a
  // warmed-up machine its answer; the strict asserts below still stand, so a
  // machine that cannot resolve node at all still fails. false is never
  // retried: a locator that ANSWERED "not on PATH" for the binary running
  // this test is a bug, not weather.
  if (Object.values(resolution).includes(null)) resolution = await resolveCommands(commands);
  assert.equal(resolution.node, true);
  assert.equal(resolution["definitely-not-a-real-binary-xyz"], false);
  assert.equal(Object.keys(resolution).length, 2, "distinct commands only, empties dropped");
});
