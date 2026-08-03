import test from "node:test";
import assert from "node:assert/strict";
import { collectTools, mcpConfigPaths, parseMcpConfig, summariseServer, toolLocations } from "../src/collect/tools.js";
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
