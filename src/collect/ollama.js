// Ollama collection. The ONLY network access this package performs, and it is
// pinned to loopback — see the structural test in test/package.test.js, which
// fails the build if an outbound call appears anywhere else.

import os from "node:os";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { run } from "./exec.js";

// 127.0.0.1 rather than "localhost", always. On a dual-stack host "localhost"
// can resolve to ::1 first while Ollama is bound to v4 only, which produces a
// confident and completely false "Ollama is not installed".
export const DEFAULT_OLLAMA_HOST = "http://127.0.0.1:11434";

// Wildcard BIND addresses. These mean "listen on every interface" and are not
// connectable targets — 0.0.0.0 in particular fails immediately on Windows.
const WILDCARD_BIND_ADDRESSES = new Set(["0.0.0.0", "::", "[::]", "*"]);

/**
 * Resolve the Ollama endpoint to talk to.
 *
 * WHY THIS IS MORE THAN `env.OLLAMA_HOST ?? default`:
 * OLLAMA_HOST is dual-purpose in Ollama and the two meanings are incompatible.
 * For the SERVER it is the bind address; for a CLIENT it is the connect target.
 * The Ollama Windows app sets `OLLAMA_HOST=0.0.0.0` so the server listens
 * broadly — and a client that trusts that value builds `http://0.0.0.0` and
 * fails instantly on a machine where Ollama is running perfectly.
 *
 * Found on a real machine during the port, where the whole report degraded to
 * "Ollama not detected" while `curl 127.0.0.1:11434` answered fine. A wildcard
 * bind address therefore falls back to loopback rather than being trusted.
 */
export function resolveHost(env = process.env) {
  const raw = (env.OLLAMA_HOST ?? "").trim();
  if (!raw) return DEFAULT_OLLAMA_HOST;

  // Strip any scheme to inspect the host portion, then rebuild deliberately.
  const withoutScheme = raw.replace(/^https?:\/\//i, "");
  const scheme = /^https:\/\//i.test(raw) ? "https" : "http";

  const [hostPart] = withoutScheme.split("/");
  const lastColon = hostPart.lastIndexOf(":");
  // Guard IPv6 literals: a bare "::1" is all colons and has no port.
  const hasPort = lastColon > hostPart.lastIndexOf("]") && /^\d+$/.test(hostPart.slice(lastColon + 1));
  const host = hasPort ? hostPart.slice(0, lastColon) : hostPart;
  const port = hasPort ? hostPart.slice(lastColon + 1) : "11434";

  if (!host || WILDCARD_BIND_ADDRESSES.has(host)) {
    // Preserve a non-default port even when the host is unusable: the user
    // clearly moved the port, and only the address was a bind directive.
    return port === "11434" ? DEFAULT_OLLAMA_HOST : `http://127.0.0.1:${port}`;
  }

  return `${scheme}://${host}:${port}`;
}

async function getJson(url, timeoutMs = 5000) {
  const started = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { ok: false, error: `http ${res.status}`, durationMs: Date.now() - started };
    return { ok: true, value: await res.json(), durationMs: Date.now() - started };
  } catch (err) {
    return { ok: false, error: String(err.message).slice(0, 160), durationMs: Date.now() - started };
  }
}

function defaultModelStore() {
  if (process.platform === "linux" && fs.existsSync("/usr/share/ollama/.ollama/models")) {
    // Ollama's Linux systemd install runs as its own user and stores models
    // outside the invoking user's home directory.
    return "/usr/share/ollama/.ollama/models";
  }
  return path.join(os.homedir(), ".ollama", "models");
}

export async function collectOllama(host = resolveHost()) {
  const out = { host };

  // WHY BINARY LOCATION IS CAPTURED BUT NOT TRUSTED AS "IS IT INSTALLED":
  // `which`/`where` resolves against the invoking shell's PATH, which varies by
  // install method and is frequently empty in non-interactive contexts. During
  // Phase 0 validation this reported not-found on a Mac where Ollama was
  // installed via Homebrew AND its API was confirmed responding. API
  // reachability is the reliable signal; this field is diagnostic colour only.
  const locate = await run(process.platform === "win32" ? "where" : "which", ["ollama"], {
    timeout: 4000,
  });
  out.binaryPath = locate.ok ? locate.stdout.split("\n")[0].trim() : null;

  const cliVersion = await run("ollama", ["--version"], { timeout: 5000 });
  out.cliVersion = cliVersion.ok
    ? cliVersion.stdout.replace(/^.*version is\s*/i, "").trim()
    : null;

  const version = await getJson(`${host}/api/version`);
  out.apiReachable = version.ok;
  out.apiVersion = version.ok ? version.value.version : null;
  if (!version.ok) out.apiError = version.error;

  const tags = await getJson(`${host}/api/tags`);
  out.installedModels = tags.ok
    ? tags.value.models.map((m) => ({
        name: m.name,
        sizeBytes: m.size,
        family: m.details?.family ?? null,
        parameterSize: m.details?.parameter_size ?? null,
        quantization: m.details?.quantization_level ?? null,
        digest: m.digest?.slice(0, 12) ?? null,
      }))
    : null;

  // /api/ps carries the single most product-relevant runtime fact available
  // anywhere: size_vram against size tells you whether a loaded model actually
  // fit, or is running partly on CPU at a fraction of the speed.
  const ps = await getJson(`${host}/api/ps`);
  out.loadedModels = ps.ok
    ? ps.value.models.map((m) => ({
        name: m.name,
        sizeBytes: m.size,
        sizeVramBytes: m.size_vram ?? 0,
        expiresAt: m.expires_at ?? null,
      }))
    : null;

  const store = process.env.OLLAMA_MODELS || defaultModelStore();
  out.modelStore = {
    path: store,
    fromEnv: Boolean(process.env.OLLAMA_MODELS),
    exists: fs.existsSync(store),
  };
  try {
    const stat = await fsp.statfs(store);
    out.modelStore.freeBytes = stat.bavail * stat.bsize;
    out.modelStore.totalBytes = stat.blocks * stat.bsize;
  } catch (err) {
    out.modelStore.diskError = String(err.message).slice(0, 140);
  }

  return out;
}
