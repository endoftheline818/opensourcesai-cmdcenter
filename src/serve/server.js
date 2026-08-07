// The local dashboard server.
//
// Binds to loopback only, everything behind the checks in security.js. The
// route surface, exhaustively: static assets, read-only JSON routes, the two
// mutating action routes (load/unload, security.js ACTION_PATHS), and the two
// pure inspection routes (bench-result validation, INSPECT_PATHS — POST as
// transport for a file's content, mutating nothing). No route takes a path or
// a command, request bodies are bounded per route while being read, and every
// other verb is rejected before routing.
//
// (The previous version of this header still claimed "no route that mutates
// anything" a phase after that stopped being true — the same stale-claim class
// as the READ-ONLY badge. If you change the route surface, change this
// paragraph in the same commit.)

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

/** Hard cap on an ACTION body. An action payload is two short strings. */
const MAX_BODY_BYTES = 4096;

/**
 * Cap on an INSPECT body — a whole osai-bench result file (or two, for a
 * comparison). Real results run tens of kilobytes; 2 MiB leaves room for
 * protocol growth without letting a stuck client buffer the moon. Sized per
 * route rather than raised globally, so the action cap stays exactly as tight
 * as an action payload warrants.
 */
const MAX_INSPECT_BODY_BYTES = 2 * 1024 * 1024;

/**
 * Cap on a CHAT body. A pasted prompt legitimately exceeds the action cap by
 * orders of magnitude; 300 KiB comfortably holds the conversation store's own
 * per-message bound (256 KiB of text) plus JSON envelope, and nothing more.
 */
const MAX_CHAT_BODY_BYTES = 300 * 1024;

/**
 * Read and parse a JSON request body, bounded.
 *
 * The size limit is enforced while reading rather than after, so an oversized
 * body is refused before it is buffered — an unbounded read on a local server
 * is a trivial way to exhaust memory.
 */
function readJsonBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        // Stop BUFFERING, but keep draining. Destroying the socket here was a
        // real bug: it killed the connection before the 400 could be written,
        // so the client saw a transport error instead of the explanation — and
        // because undici pools connections, it also poisoned the next request
        // on that socket, which made two unrelated tests fail alongside it.
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (tooLarge) {
        reject(new Error("request body too large"));
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(new Error("request body is not valid JSON"));
      }
    });
    req.on("error", () => reject(new Error("request failed")));
  });
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
  actions = null,
  inspect = null,
  chat = null,
  settings = null,
  now = () => new Date().toISOString(),
  monotonic = () => Date.now(),
  token = createSessionToken(),
  port = DEFAULT_PORT,
}) {
  const routes = createRoutes({ collect, catalog, now, telemetry, monotonic, chat, inspect, settings });

  // Mirrors security.js's ACTION_PATHS exactly. Two places name these routes —
  // the authorizer and the dispatcher — and a test asserts the two lists agree,
  // so neither can grow without the other.
  const actionRoutes = actions
    ? {
        "/api/actions/load": (body) => actions.load(body?.model),
        "/api/actions/unload": (body) => actions.unload(body?.model),
      }
    : {};

  // Mirrors security.js's INSPECT_PATHS the same way, under the same test
  // discipline. These are POST as TRANSPORT only: the handlers are pure
  // functions over the request body — no state held, nothing written, nothing
  // called. The larger body cap exists because the payload is a whole bench
  // result file, not because these routes are any less bounded.
  const inspectRoutes = inspect
    ? {
        "/api/bench/inspect": (body) => inspect.inspectResult(body),
        "/api/bench/compare": (body) =>
          inspect.compareResults(body?.left, body?.right, {
            sameMachineAttested: body?.sameMachineAttested === true,
          }),
        // By NAME, never by path: the handler reads one file from the known
        // results directory behind a pattern-and-containment gate.
        "/api/bench/results/inspect": (body) => inspect.inspectStored(body?.name),
      }
    : {};

  // Mirrors security.js's CHAT_PATHS (MAINTAINING §4b). history and delete are
  // ordinary JSON handlers; send is the one STREAMING route in the package and
  // is dispatched separately below — it writes NDJSON as the generation runs,
  // and a client disconnect aborts the upstream request so a closed tab stops
  // the model rather than leaving it generating for nobody.
  const chatJsonRoutes = chat
    ? {
        "/api/chat/history": (body) => chat.history(body?.id ?? null),
        "/api/chat/delete": (body) => chat.remove(body?.id ?? null),
      }
    : {};
  const CHAT_SEND_PATH = "/api/chat/send";

  // Mirrors security.js's SETTINGS_PATHS, same discipline again. The pair
  // manages exactly one recorded setting — the manual bandwidth figure in the
  // tool's own data directory — and mutates no machine state.
  const settingsRoutes = settings
    ? {
        "/api/settings/bandwidth/set": (body) => settings.set(body),
        "/api/settings/bandwidth/clear": () => settings.clear(),
      }
    : {};

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
    const auth = authorize(req, { token, port, requireToken: !isAsset, pathname });
    if (!auth.ok) {
      send(res, auth.status, "text/plain; charset=utf-8", auth.reason);
      return;
    }

    if (req.method === "POST") {
      // The streaming route. The response is NDJSON written as the generation
      // runs; the security headers still apply, and a client disconnect aborts
      // the upstream request via the service's abort hook.
      if (pathname === CHAT_SEND_PATH && chat) {
        let body;
        try {
          body = await readJsonBody(req, MAX_CHAT_BODY_BYTES);
        } catch (err) {
          send(res, 400, "application/json; charset=utf-8", JSON.stringify({ ok: false, reason: err.message }));
          return;
        }
        res.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", ...securityHeaders() });
        let abortUpstream = null;
        res.on("close", () => {
          if (abortUpstream && !res.writableEnded) abortUpstream();
        });
        try {
          await chat.send(
            {
              conversationId: body?.conversationId ?? null,
              runtime: body?.runtime ?? "ollama",
              model: body?.model,
              text: body?.text,
              numCtx: body?.numCtx ?? null,
            },
            {
              writeLine: (line) => {
                if (!res.writableEnded) res.write(`${JSON.stringify(line)}\n`);
              },
              onUpstreamAbort: (abort) => {
                abortUpstream = abort;
              },
            },
          );
        } catch (err) {
          // Generic on the wire; the specifics go to stderr like every other
          // handler failure — an error string can carry a filesystem path.
          if (!res.writableEnded) res.write(`${JSON.stringify({ done: true, failure: "the send failed" })}\n`);
          process.stderr.write(`cmdcenter: chat send failed: ${err.stack}\n`);
        }
        res.end();
        return;
      }

      const isInspect = pathname in inspectRoutes;
      const isChat = pathname in chatJsonRoutes;
      const isSettings = pathname in settingsRoutes;
      const handler = isInspect
        ? inspectRoutes[pathname]
        : isChat
          ? chatJsonRoutes[pathname]
          : isSettings
            ? settingsRoutes[pathname]
            : actionRoutes[pathname];
      if (!handler) {
        send(res, 404, "text/plain; charset=utf-8", "not found");
        return;
      }
      let body;
      try {
        body = await readJsonBody(
          req,
          isInspect ? MAX_INSPECT_BODY_BYTES : isChat ? MAX_CHAT_BODY_BYTES : MAX_BODY_BYTES,
        );
      } catch (err) {
        send(res, 400, "application/json; charset=utf-8", JSON.stringify({ ok: false, reason: err.message }));
        return;
      }
      const result = await handler(body);
      send(res, result.ok ? 200 : (result.status ?? 400), "application/json; charset=utf-8", JSON.stringify(result));
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
