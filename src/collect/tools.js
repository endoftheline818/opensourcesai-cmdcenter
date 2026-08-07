// Local AI tooling inventory — MCP servers and installed runtimes.
//
// THE HARD RULE, AND WHY IT SHAPES THE WHOLE MODULE
// MCP config files routinely hold live credentials in their `env` blocks. So
// this module NEVER puts an env value into the object it returns.
//
// The redaction happens HERE, at collection, not in the derive layer or the UI.
// That ordering is deliberate: `osai-cmdcenter --capture` writes the collected
// object straight to disk for bug reports, so anything a collector returns can
// end up in a file someone pastes into an issue. A value that is never read
// cannot leak; a value redacted later already existed in memory and in every
// intermediate structure.
//
// Env var NAMES are kept — "this server needs GITHUB_TOKEN" is useful, and a
// name is not a secret. Values, and anything that could carry one (raw argv,
// URLs with embedded credentials), are dropped before returning.

import os from "node:os";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { run } from "./exec.js";

/** Config locations, per platform. Absent files are an ordinary result. */
export function mcpConfigPaths(platform = process.platform, home = os.homedir(), env = process.env) {
  const appData = env.APPDATA ?? path.join(home, "AppData", "Roaming");
  const claudeDesktop =
    platform === "win32"
      ? path.join(appData, "Claude", "claude_desktop_config.json")
      : platform === "darwin"
        ? path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json")
        : path.join(home, ".config", "Claude", "claude_desktop_config.json");

  return [
    { client: "Claude Desktop", file: claudeDesktop },
    { client: "Claude Code", file: path.join(home, ".claude.json") },
    { client: "Cursor", file: path.join(home, ".cursor", "mcp.json") },
    { client: "Windsurf", file: path.join(home, ".codeium", "windsurf", "mcp_config.json") },
    { client: "VS Code (Continue)", file: path.join(home, ".continue", "config.json") },
  ];
}

const SECRET_NAME = /token|key|secret|password|passwd|credential|auth|api/i;

/**
 * Last path segment, splitting on BOTH separators.
 *
 * `path.basename` is platform-dependent and that is a privacy bug here, not a
 * cosmetic one: on POSIX it does not treat "\" as a separator, so a Windows
 * path like `C:\Users\someone\npx.cmd` read on macOS or Linux comes back
 * unchanged — username and all. Config files genuinely cross platforms (synced
 * dotfiles, WSL, a repo checked out on two machines), so the separator in the
 * data cannot be assumed to match the separator of the host reading it.
 *
 * Caught by CI on Linux and macOS while Windows passed, which is exactly what
 * the cross-platform matrix is for.
 */
export function safeBasename(value) {
  if (typeof value !== "string" || value === "") return null;
  const segments = value.split(/[\\/]/).filter(Boolean);
  return segments.length ? segments[segments.length - 1] : null;
}

/**
 * Does this string look like it came off a filesystem, i.e. might carry a
 * username? Package specifiers are safe to report; paths are not.
 */
function looksLikePath(value) {
  return /[\\/]/.test(value) && !/^@[a-z0-9-]+\/[a-z0-9._-]+$/i.test(value);
}

/**
 * Extract the publishable shape of one MCP server definition.
 *
 * PURE, and exported, so the redaction guarantee can be tested against a
 * synthetic config carrying a known sentinel value rather than against
 * anybody's real credentials.
 */
export function summariseServer(name, definition) {
  const def = definition ?? {};
  const envNames = Object.keys(def.env ?? {});

  // The package specifier is the useful identifying detail — it says WHAT the
  // server is, where the user-chosen name does not. Anything path-shaped is
  // dropped because it can contain a home directory and therefore a username.
  const args = Array.isArray(def.args) ? def.args : [];
  const packageHint =
    args.find((a) => typeof a === "string" && !a.startsWith("-") && !looksLikePath(a)) ?? null;

  return {
    name,
    // stdio servers declare a command; remote ones declare a url. The url
    // itself is NOT returned — it can embed credentials in userinfo or query.
    transport: def.url ? "remote" : def.command ? "stdio" : "unknown",
    // Basename only: a full command path leaks the home directory. Uses
    // safeBasename, NOT path.basename — see the note there.
    command: safeBasename(def.command),
    packageHint,
    envVarNames: envNames,
    envVarCount: envNames.length,
    // Counted so a user can see at a glance which servers hold credentials,
    // without the tool ever reading one.
    secretShapedEnvCount: envNames.filter((n) => SECRET_NAME.test(n)).length,
  };
}

/** PURE. Parses one config's contents into safe summaries. */
export function parseMcpConfig(parsed) {
  const servers = parsed?.mcpServers;
  if (!servers || typeof servers !== "object") return [];
  return Object.entries(servers).map(([name, def]) => summariseServer(name, def));
}

async function readMcpConfigs(paths) {
  const results = [];
  for (const { client, file } of paths) {
    if (!fs.existsSync(file)) {
      results.push({ client, present: false, servers: [] });
      continue;
    }
    try {
      const parsed = JSON.parse(await fsp.readFile(file, "utf8"));
      results.push({
        client,
        present: true,
        // Basename only — the full path contains the home directory.
        configFile: safeBasename(file),
        servers: parseMcpConfig(parsed),
      });
    } catch (err) {
      results.push({
        client,
        present: true,
        configFile: safeBasename(file),
        servers: [],
        // The message is scrubbed of anything path-shaped before truncation: a
        // filesystem error embeds the full path it failed on, which is exactly
        // the home directory the rest of this module works to keep out.
        error: "unreadable: " + String(err.message).replace(/\S*[\\/]\S*/g, "<path>").slice(0, 80),
      });
    }
  }
  return results;
}

/**
 * Locally installed AI runtimes, detected by well-known install locations.
 *
 * DELIBERATELY NOT EXHAUSTIVE, and the report says so. Presence is evidence;
 * absence here is not evidence of absence, because a tool installed somewhere
 * unusual will not be found. Overstating this list would be the same mistake
 * as trusting a single VRAM source.
 */
export function toolLocations(platform = process.platform, home = os.homedir(), env = process.env) {
  const localAppData = env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");
  const byPlatform = {
    win32: [
      { name: "Ollama", dir: path.join(localAppData, "Programs", "Ollama") },
      { name: "LM Studio", dir: path.join(home, ".lmstudio") },
      { name: "Jan", dir: path.join(localAppData, "Programs", "Jan") },
      { name: "ComfyUI", dir: path.join(home, "ComfyUI") },
    ],
    darwin: [
      { name: "Ollama", dir: "/Applications/Ollama.app" },
      { name: "LM Studio", dir: "/Applications/LM Studio.app" },
      { name: "Jan", dir: "/Applications/Jan.app" },
      { name: "ComfyUI", dir: path.join(home, "ComfyUI") },
    ],
    linux: [
      { name: "Ollama", dir: "/usr/share/ollama" },
      { name: "LM Studio", dir: path.join(home, ".lmstudio") },
      { name: "Jan", dir: path.join(home, "jan") },
      { name: "ComfyUI", dir: path.join(home, "ComfyUI") },
    ],
  };
  return byPlatform[platform] ?? byPlatform.linux;
}

async function detectTools(locations) {
  const found = [];
  for (const { name, dir } of locations) {
    // Existence only. The path is never returned — it contains the home
    // directory on every platform.
    found.push({ name, installed: fs.existsSync(dir) });
  }
  return found;
}

/**
 * Resolve which of the configured stdio COMMANDS exist on PATH — the Tier 1
 * static probe, and the whole extent of what this module will ever probe.
 *
 * `where`/`which` LOCATES a binary; it executes nothing. That line is the
 * design: actually spawning a configured server would run arbitrary
 * user-configured code on inspect (and most servers need their env values to
 * start, which this module never reads) — deferred deliberately, and remote
 * servers are never probed at all because that would be an outbound call.
 *
 * Results are true / false / null: resolvable, not found, or the probe itself
 * did not answer — and null is reported as unchecked, never as either verdict.
 */
export async function resolveCommands(commands, { platform = process.platform } = {}) {
  const locator = platform === "win32" ? "where" : "which";
  const distinct = [...new Set(commands.filter((c) => typeof c === "string" && c.length > 0))];
  const entries = await Promise.all(
    distinct.map(async (command) => [command, probeOutcome(await run(locator, [command], { timeout: 4000 }))]),
  );
  return Object.fromEntries(entries);
}

/**
 * PURE — one probe result becomes one honest outcome.
 *
 * false is reserved for the locator actually ANSWERING: `where`/`which` ran
 * and exited non-zero, saying "not on PATH". "not-found" is the locator
 * itself being absent, and "timed-out" is the locator killed before it
 * exited — in neither case did the probe answer, so neither may become a
 * verdict. Not academic: a cold CI runner once pushed `where node` past its
 * budget, and the pre-fix mapping reported node — the binary running the
 * test — as not on PATH.
 */
export function probeOutcome(res) {
  if (res.ok) return true;
  return res.error === "not-found" || res.error === "timed-out" ? null : false;
}

export async function collectTools({ platform = process.platform, home = os.homedir(), env = process.env } = {}) {
  const [clients, tools] = await Promise.all([
    readMcpConfigs(mcpConfigPaths(platform, home, env)),
    detectTools(toolLocations(platform, home, env)),
  ]);

  const commandResolution = await resolveCommands(
    clients.flatMap((c) => c.servers.map((s) => s.command)),
    { platform },
  );

  return {
    mcpClients: clients,
    tools,
    commandResolution,
    note: "Detection covers well-known install locations only. A tool installed elsewhere will not appear here.",
  };
}
