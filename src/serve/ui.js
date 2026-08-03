// The dashboard UI, served from memory as three fixed assets.
//
// No framework, no build step, no bundler, and no external request of any kind —
// consistent with the package's zero-dependency rule and enforced at runtime by
// the CSP in security.js. Everything here is a plain string, so serving it needs
// no filesystem access and no path resolution, which is also why path traversal
// has no surface to attack.
//
// The token is injected into the HTML at serve time. It is never placed in a
// URL the browser would keep in history, and never written to storage.

export const HTML = (token) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OpenSourcesAI Command Center</title>
<link rel="stylesheet" href="/app.css">
</head>
<body>
<header>
  <h1>Command Center</h1>
  <p class="sub">Read-only diagnostic for this machine. Nothing here changes anything.</p>
</header>
<main id="app" aria-busy="true">
  <p class="loading">Reading this machine…</p>
</main>
<footer>
  <span id="meta"></span>
</footer>
<script id="bootstrap" type="application/json">${JSON.stringify({ token })}</script>
<script src="/app.js"></script>
</body>
</html>`;

export const CSS = `:root {
  --bg: #0f1115; --panel: #171a21; --line: #262b35; --text: #e6e9ef;
  --muted: #9aa3b2; --good: #4ade80; --warn: #fbbf24; --bad: #f87171; --info: #60a5fa;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: light) {
  :root { --bg:#f6f7f9; --panel:#fff; --line:#e2e5ea; --text:#12151a; --muted:#5b6472; }
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--text);
  font: 15px/1.55 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
}
header, main, footer { max-width: 1040px; margin: 0 auto; padding: 0 20px; }
header { padding-top: 28px; padding-bottom: 8px; }
h1 { margin: 0; font-size: 22px; letter-spacing: -0.01em; }
.sub { margin: 4px 0 0; color: var(--muted); font-size: 13px; }
footer { padding: 24px 20px 40px; color: var(--muted); font-size: 12px; }
.loading { color: var(--muted); }
.panel {
  background: var(--panel); border: 1px solid var(--line);
  border-radius: 10px; padding: 16px 18px; margin: 16px 0;
}
.panel h2 { margin: 0 0 12px; font-size: 13px; text-transform: uppercase;
  letter-spacing: 0.07em; color: var(--muted); font-weight: 600; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 14px; }
.kv .k { color: var(--muted); font-size: 12px; }
.kv .v { font-size: 15px; margin-top: 2px; word-break: break-word; }
.kv .v.big { font-size: 20px; font-weight: 600; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th { text-align: left; color: var(--muted); font-weight: 600; font-size: 12px;
  text-transform: uppercase; letter-spacing: 0.05em; padding: 6px 8px; border-bottom: 1px solid var(--line); }
td { padding: 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
tr:last-child td { border-bottom: 0; }
.pill { display: inline-block; padding: 2px 9px; border-radius: 999px;
  font-size: 11px; font-weight: 600; letter-spacing: 0.02em; white-space: nowrap; }
.pill.comfortable { background: rgba(74,222,128,.15); color: var(--good); }
.pill.tight       { background: rgba(251,191,36,.15); color: var(--warn); }
.pill.partial     { background: rgba(96,165,250,.15); color: var(--info); }
.pill.too_large   { background: rgba(248,113,113,.15); color: var(--bad); }
.pill.known { background: rgba(74,222,128,.15); color: var(--good); }
.pill.derived { background: rgba(96,165,250,.15); color: var(--info); }
.pill.unlisted { background: rgba(154,163,178,.15); color: var(--muted); }
.muted { color: var(--muted); }
.explain { color: var(--muted); font-size: 13px; margin-top: 3px; }
code, .mono { font-family: var(--mono); font-size: 12.5px; }
.cmd { display: flex; gap: 8px; align-items: center; margin-top: 6px; }
.cmd code { background: rgba(127,127,127,.12); padding: 3px 7px; border-radius: 5px; }
button {
  font: inherit; font-size: 12px; padding: 4px 10px; cursor: pointer;
  background: transparent; color: var(--text);
  border: 1px solid var(--line); border-radius: 6px;
}
button:hover { border-color: var(--muted); }
.notice { border-left: 3px solid var(--warn); padding-left: 12px; margin: 10px 0; font-size: 13px; }
.limits li { color: var(--muted); font-size: 13px; margin-bottom: 4px; }
.readonly {
  display: inline-block; margin-left: 8px; padding: 2px 8px; border-radius: 999px;
  font-size: 11px; background: rgba(96,165,250,.15); color: var(--info); font-weight: 600;
}
.spilled { color: var(--warn); }
`;

export const JS = `"use strict";
const TOKEN = JSON.parse(document.getElementById("bootstrap").textContent).token;
const app = document.getElementById("app");

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  // textContent everywhere, never innerHTML: every string below originates
  // from the machine (GPU names, model names, Ollama output) and must not be
  // able to become markup.
  if (text !== undefined && text !== null) n.textContent = String(text);
  return n;
};

function kv(label, value, big) {
  const wrap = el("div", "kv");
  wrap.append(el("div", "k", label), el("div", "v" + (big ? " big" : ""), value));
  return wrap;
}

function panel(title, extraClass) {
  const p = el("section", "panel" + (extraClass ? " " + extraClass : ""));
  if (title) p.append(el("h2", null, title));
  return p;
}

function machinePanel(d) {
  const p = panel("This machine");
  const g = el("div", "grid");
  const r = d.report;
  g.append(kv("Platform", (r.platform.distro || r.platform.os) + " (" + r.platform.arch + ")"));
  g.append(kv("CPU", r.cpu.model || "unknown"));
  g.append(kv("System memory", r.memory.totalGb != null ? r.memory.totalGb + " GB" : "unknown"));
  if (r.appleMemory) {
    g.append(kv("Unified memory", r.appleMemory.totalMemoryGb + " GB"));
    g.append(kv("Usable for models", r.appleMemory.usableModelMemoryGb + " GB", true));
  } else if (r.gpu) {
    g.append(kv("GPU", r.gpu.name));
    g.append(kv("VRAM", r.gpu.nameplateGb + " GB", true));
  } else {
    g.append(kv("GPU", "none detected"));
  }
  p.append(g);
  p.append(el("p", "explain", d.hardware.note));
  return p;
}

function disagreementPanel(d) {
  if (!d.report.disagreements.length) return null;
  const p = panel("Sources disagree about this GPU");
  for (const dis of d.report.disagreements) {
    const n = el("div", "notice");
    n.append(el("div", null, dis.card + " — " + dis.spreadGib + " GiB spread (" + dis.ratio + "x)"));
    for (const c of dis.claims) {
      const line = el("div", "mono muted");
      line.textContent = "  " + c.source + " = " + c.gib + " GiB" + (c.knownUnreliable ? "   (known-unreliable source)" : "");
      n.append(line);
    }
    p.append(n);
  }
  p.append(el("p", "explain", "Kept visible rather than resolved silently. The figure used above comes from the most corroborated source."));
  return p;
}

function ollamaPanel(d) {
  const p = panel("Ollama");
  const o = d.report.ollama;
  const g = el("div", "grid");
  g.append(kv("Status", o.installed ? "running" : "not detected"));
  g.append(kv("Version", o.version || "unknown"));
  g.append(kv("Installed models", o.installedModelCount != null ? o.installedModelCount : "—"));
  g.append(kv("Loaded now", d.loaded.length));
  if (o.modelStore && o.modelStore.freeGb != null) {
    g.append(kv("Disk free", o.modelStore.freeGb + " / " + o.modelStore.totalGb + " GB"));
  }
  p.append(g);

  if (d.loaded.length) {
    const t = el("table");
    const head = el("tr");
    for (const h of ["Loaded model", "In VRAM", "Residency"]) head.append(el("th", null, h));
    t.append(head);
    for (const m of d.loaded) {
      const row = el("tr");
      row.append(el("td", null, m.name));
      row.append(el("td", null, m.sizeVramGb + " / " + m.sizeGb + " GB"));
      const res = el("td", m.spilled ? "spilled" : null,
        m.vramResidentPercent + "%" + (m.spilled ? " — partly on CPU" : ""));
      row.append(res);
      t.append(row);
    }
    p.append(t);
  }
  return p;
}

function installedPanel(d) {
  if (!d.installed.length) return null;
  const p = panel("Installed models");
  const t = el("table");
  const head = el("tr");
  for (const h of ["Model", "Catalog", "Fit here"]) head.append(el("th", null, h));
  t.append(head);
  for (const m of d.installed) {
    const row = el("tr");
    row.append(el("td", null, m.name));
    const status = el("td");
    status.append(el("span", "pill " + m.status, m.status));
    row.append(status);
    const fit = el("td");
    if (m.grade) {
      fit.append(el("span", "pill " + m.grade.fit, m.grade.fit.replace("_", " ")));
      fit.append(el("div", "explain", m.grade.explanation));
    } else {
      fit.append(el("span", "muted", m.status === "derived" ? "local build — not in the catalog" : "not in the catalog"));
    }
    row.append(fit);
    t.append(row);
  }
  p.append(t);
  return p;
}

function catalogPanel(d) {
  const p = panel("What this machine can run");
  const t = el("table");
  const head = el("tr");
  for (const h of ["Model", "Fit", "Quant", "Needs", "Run it"]) head.append(el("th", null, h));
  t.append(head);
  for (const m of d.models) {
    const row = el("tr");
    const name = el("td");
    name.append(el("div", null, m.name + (m.sparseMoe ? "  (sparse MoE)" : "")));
    name.append(el("div", "explain", m.explanation));
    row.append(name);
    const fit = el("td");
    fit.append(el("span", "pill " + m.fit, m.fit.replace("_", " ")));
    row.append(fit);
    row.append(el("td", "mono", m.quant || "—"));
    row.append(el("td", null, m.requiredVramGb != null ? m.requiredVramGb + " GB" : "—"));
    const cmd = el("td");
    if (m.runCommand) {
      const box = el("div", "cmd");
      box.append(el("code", null, m.runCommand));
      const btn = el("button", null, "Copy");
      btn.type = "button";
      btn.addEventListener("click", () => {
        navigator.clipboard.writeText(m.runCommand).then(
          () => { btn.textContent = "Copied"; setTimeout(() => { btn.textContent = "Copy"; }, 1200); },
          () => { btn.textContent = "Copy failed"; },
        );
      });
      box.append(btn);
      cmd.append(box);
    } else {
      cmd.append(el("span", "muted", "—"));
    }
    row.append(cmd);
    t.append(row);
  }
  p.append(t);
  return p;
}

function limitsPanel(d) {
  if (!d.report.limits.length) return null;
  const p = panel("What this report does not claim");
  const ul = el("ul", "limits");
  for (const l of d.report.limits) ul.append(el("li", null, l));
  p.append(ul);
  return p;
}

function sharePanel(d) {
  const p = panel("Shareable summary");
  p.append(el("p", "explain", "Coarse bands only — no exact specs. Safe to paste into a public issue or forum thread."));
  const box = el("div", "cmd");
  const text = Object.entries(d.report.exportable).map(([k, v]) => k + ": " + v).join("  |  ");
  box.append(el("code", null, text));
  const btn = el("button", null, "Copy");
  btn.type = "button";
  btn.addEventListener("click", () => {
    navigator.clipboard.writeText(text).then(() => { btn.textContent = "Copied"; setTimeout(() => { btn.textContent = "Copy"; }, 1200); });
  });
  box.append(btn);
  p.append(box);
  return p;
}

async function load() {
  const res = await fetch("/api/dashboard", { headers: { "x-cmdcenter-token": TOKEN } });
  if (!res.ok) throw new Error("request failed: " + res.status);
  const d = await res.json();

  app.textContent = "";
  for (const build of [machinePanel, disagreementPanel, ollamaPanel, installedPanel, catalogPanel, limitsPanel, sharePanel]) {
    const node = build(d);
    if (node) app.append(node);
  }
  app.setAttribute("aria-busy", "false");

  const meta = document.getElementById("meta");
  meta.textContent =
    "cmdcenter " + d.clientVersion +
    " · report contract v" + d.reportContractVersion +
    " · catalog snapshot " + (d.catalog.generatedAt || "unknown") +
    " (" + d.catalog.modelCount + " models) · read-only";
}

load().catch((err) => {
  app.textContent = "";
  const p = el("section", "panel");
  p.append(el("h2", null, "Could not read this machine"));
  p.append(el("p", null, String(err.message)));
  app.append(p);
  app.setAttribute("aria-busy", "false");
});
`;
