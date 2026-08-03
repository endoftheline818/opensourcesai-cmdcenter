// Collection orchestrator — the I/O boundary of this package.
//
// Everything below this module performs I/O. Everything in src/derive is pure.
// That split is what lets the whole reporting layer be tested against committed
// fixtures from real machines, with no GPU and no Ollama present on the runner.

import { CAPTURE_SCHEMA_VERSION } from "../version.js";
import { collectGpu, collectPlatform, collectSystem } from "./gpu.js";
import { collectOllama, resolveHost } from "./ollama.js";
import { collectTools } from "./tools.js";

/**
 * Capture raw machine state.
 *
 * @param {object} [options]
 * @param {string} [options.capturedAt] Caller-supplied ISO timestamp. NOT read
 *   from the clock here: a module that stamps its own time cannot be
 *   snapshot-tested, and cannot be compared across two runs to prove the
 *   machine changed rather than the clock. Same invariant the website's
 *   checker-result contract holds.
 */
export async function collect({ capturedAt = null, host = resolveHost() } = {}) {
  // Probes are independent, so run them concurrently — on Windows the
  // PowerShell-backed ones dominate wall time and serialising them roughly
  // doubles the run.
  const [platform, system, gpu, ollama, tools] = await Promise.all([
    collectPlatform(),
    collectSystem(),
    collectGpu(),
    collectOllama(host),
    collectTools(),
  ]);

  return {
    captureSchemaVersion: CAPTURE_SCHEMA_VERSION,
    capturedAt,
    platform,
    system,
    gpu,
    ollama,
    tools,
  };
}

export { collectGpu, collectPlatform, collectSystem, collectOllama, collectTools, resolveHost };
