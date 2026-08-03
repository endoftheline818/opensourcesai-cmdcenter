// The local dashboard server.
//
// Binds to loopback only. Serves three static assets and four read-only JSON
// routes, all behind the checks in security.js. There is no route that mutates
// anything, no route that takes a path or a command, and no request body is
// ever read — non-GET verbs are rejected before routing.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRoutes } from "./routes.js";
import { CSS, HTML, JS } from "./ui.js";
import { authorize, createSessionToken, securityHeaders, TOKEN_HEADER } from "./security.js";

export const DEFAULT_PORT = 7717;
/** Loopback literal, never 0.0.0.0 — this must not be reachable off-machine. */
export const BIND_ADDRESS = "127.0.0.1";

// The brand mark, read once at startup from a FIXED path inside the package.
// Nothing about the request influences which file is read, so this adds no
// traversal surface — the route table stays a pure allowlist. Read failure is
// non-fatal: a missing icon must never stop the diagnostic from running.
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
let brandIcon = null;
try {
  brandIcon = fs.readFileSync(path.join(packageRoot, "assets", "opensourcesai-icon.png"));
} catch {
  brandIcon = null;
}

function send(res, status, type, body, extraHeaders = {}) {
  res.writeHead(status, {
    "content-type": type,
    "content-length": Buffer.byteLength(body),
    ...securityHeaders(),
    ...extraHeaders,
  });
  res.end(body);
}

/**
 * @param {object} deps
 * @param {(opts: object) => Promise<object>} deps.collect
 * @param {object} deps.catalog
 * @param {() => string} [deps.now] Injected clock, so tests are deterministic.
 * @param {string} [deps.token]     Injected token, so tests are deterministic.
 */
export function createServer({
  collect,
  catalog,
  telemetry = null,
  now = () => new Date().toISOString(),
  monotonic = () => Date.now(),
  token = createSessionToken(),
  port = DEFAULT_PORT,
}) {
  const routes = createRoutes({ collect, catalog, now, telemetry, monotonic });

  const server = http.createServer(async (req, res) => {
    // Parsed against a fixed base purely to extract a clean pathname; the base
    // is discarded. Query strings are ignored entirely — no route reads one, so
    // there is no parameter to validate or smuggle anything through.
    let pathname;
    try {
      pathname = new URL(req.url, "http://127.0.0.1").pathname;
    } catch {
      send(res, 400, "text/plain; charset=utf-8", "bad request");
      return;
    }

    // The UI assets are readable without the token: they contain no machine
    // data, and the HTML is what *delivers* the token to the page. Every route
    // that exposes machine state requires it.
    const isAsset =
      pathname === "/" || pathname === "/app.js" || pathname === "/app.css" || pathname === "/brand-icon.png";
    const auth = authorize(req, { token, port, requireToken: !isAsset });
    if (!auth.ok) {
      send(res, auth.status, "text/plain; charset=utf-8", auth.reason);
      return;
    }

    if (pathname === "/") {
      send(res, 200, "text/html; charset=utf-8", HTML(token));
      return;
    }
    if (pathname === "/app.css") {
      send(res, 200, "text/css; charset=utf-8", CSS);
      return;
    }
    if (pathname === "/app.js") {
      send(res, 200, "text/javascript; charset=utf-8", JS);
      return;
    }
    if (pathname === "/brand-icon.png") {
      if (!brandIcon) {
        send(res, 404, "text/plain; charset=utf-8", "not found");
        return;
      }
      send(res, 200, "image/png", brandIcon);
      return;
    }

    const handler = routes[pathname];
    if (!handler) {
      send(res, 404, "text/plain; charset=utf-8", "not found");
      return;
    }

    try {
      const result = await handler();
      send(res, result.status, result.type, result.body);
    } catch (err) {
      // The message is deliberately generic: an error string from a collector
      // can contain a filesystem path, and this response crosses a boundary.
      send(res, 500, "application/json; charset=utf-8", JSON.stringify({ error: "collection failed" }));
      process.stderr.write(`cmdcenter: request to ${pathname} failed: ${err.stack}\n`);
    }
  });

  return { server, token, port };
}

export function startServer(deps) {
  const { server, token, port } = createServer(deps);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, BIND_ADDRESS, () => {
      resolve({ server, token, port, url: `http://${BIND_ADDRESS}:${port}/` });
    });
  });
}

export { TOKEN_HEADER };
