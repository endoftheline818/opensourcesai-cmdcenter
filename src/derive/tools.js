// Shapes the tooling inventory for display. Pure: no I/O, no clock.
//
// Redaction already happened in collect/tools.js — by the time anything reaches
// here, no credential was ever read. This layer's job is aggregation and, most
// importantly, deciding what may appear in the SHAREABLE block, which is a
// stricter question than what may appear on screen.

/**
 * The Tier 1 verdict for one server — STATIC checks only, and the vocabulary
 * says exactly how far each claim reaches:
 *
 *   config-ok         — well-formed, and its command resolves on PATH. A found
 *                       command can still fail at runtime; nothing was executed.
 *   command-not-found — well-formed, but the command is not on PATH. The most
 *                       common real failure (a moved binary, an npx-era server
 *                       after a Node switch), caught without running anything.
 *   config-broken     — the entry declares neither a command nor a url.
 *   unchecked         — the resolution probe itself did not answer. Unknown is
 *                       not a verdict in either direction.
 *   declared          — a remote server. Never probed, BY DESIGN: probing a
 *                       configured URL is an outbound network call, and this
 *                       tool does not make those. The trust property, presented
 *                       as information.
 */
export function serverVerdict(server, commandResolution = {}) {
  if (server.transport === "remote") return "declared";
  if (server.transport === "unknown" || !server.command) return "config-broken";
  const resolved = commandResolution[server.command];
  if (resolved === true) return "config-ok";
  if (resolved === false) return "command-not-found";
  return "unchecked";
}

export function buildToolsPayload(inventory) {
  const clients = (inventory?.mcpClients ?? []).filter((c) => c.present);
  const commandResolution = inventory?.commandResolution ?? {};
  const allServers = clients.flatMap((c) =>
    c.servers.map((s) => ({ ...s, client: c.client, verdict: serverVerdict(s, commandResolution) })),
  );

  // A server name is user-chosen and can repeat across clients (the same
  // server configured in both Claude Desktop and Cursor), so distinctness is
  // reported separately from the raw total rather than conflated.
  const distinctNames = new Set(allServers.map((s) => s.name));
  const withSecrets = allServers.filter((s) => s.secretShapedEnvCount > 0);

  const installed = (inventory?.tools ?? []).filter((t) => t.installed);

  return {
    servers: allServers,
    clients: clients.map((c) => ({
      client: c.client,
      configFile: c.configFile ?? null,
      serverCount: c.servers.length,
      error: c.error ?? null,
    })),
    tools: inventory?.tools ?? [],
    summary: {
      clientsConfigured: clients.length,
      serversConfigured: allServers.length,
      distinctServers: distinctNames.size,
      // Surfaced so a user knows which of their configs hold credentials —
      // which is exactly the set worth being careful with when sharing a
      // machine or a screen. The tool never reads the values themselves.
      serversHoldingCredentials: withSecrets.length,
      toolsInstalled: installed.length,
      commandsNotFound: allServers.filter((s) => s.verdict === "command-not-found").length,
    },
    // The honesty label the panel renders beside the verdicts, verbatim.
    verdictNote:
      "Static checks only: commands were located, never executed. A found command can still fail at runtime, " +
      "and remote servers are declared, not probed — probing them would be an outbound network call.",
    note: inventory?.note ?? null,
  };
}

/**
 * The only tooling facts allowed into a shareable report.
 *
 * Counts, nothing else. Server names are user-chosen labels that can reveal
 * what someone works on ("acme-internal-db"), config filenames identify which
 * products they run, and env var names hint at which vendors hold their
 * credentials. None of that belongs in an artifact designed to be pasted into
 * a public issue, and none of it is needed to answer the question a shared
 * report exists to answer.
 */
export function exportableTools(payload) {
  return {
    mcp_clients: payload.summary.clientsConfigured,
    mcp_servers: payload.summary.serversConfigured,
    local_tools: payload.summary.toolsInstalled,
  };
}
