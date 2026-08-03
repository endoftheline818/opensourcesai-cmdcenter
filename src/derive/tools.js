// Shapes the tooling inventory for display. Pure: no I/O, no clock.
//
// Redaction already happened in collect/tools.js — by the time anything reaches
// here, no credential was ever read. This layer's job is aggregation and, most
// importantly, deciding what may appear in the SHAREABLE block, which is a
// stricter question than what may appear on screen.

export function buildToolsPayload(inventory) {
  const clients = (inventory?.mcpClients ?? []).filter((c) => c.present);
  const allServers = clients.flatMap((c) => c.servers.map((s) => ({ ...s, client: c.client })));

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
    },
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
