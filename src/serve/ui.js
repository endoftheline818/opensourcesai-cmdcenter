// The dashboard UI, served from memory as fixed assets.
//
// No framework, no build step, no bundler, and no external request of any kind —
// consistent with the package's zero-dependency rule and enforced at runtime by
// the CSP in security.js. Everything here is a plain string, so serving it needs
// no filesystem access and no path resolution, which is also why path traversal
// has no surface to attack.
//
// DESIGN SYSTEM
// The tokens below are lifted from opensourcesai.com's src/index.css so this
// surface reads as part of the platform rather than a separate tool. They are a
// COPY, not an import (this package has a hard repo boundary), and are pinned by
// fixtures/website-design-tokens.json + test/design.test.js the same way the
// band vocabulary and fit engine are — so a drift is a failing test, not a
// gradual divergence nobody notices.
//
// Two deliberate deviations, both forced by constraints rather than taste:
//   - Inter and JetBrains Mono are referenced by NAME with the site's own
//     fallback stack, but not fetched. The site loads them via next/font; this
//     package may make no external request, so a machine without them installed
//     gets the same fallbacks the site's stack already declares.
//   - The site's light theme is available, but this defaults to dark and follows
//     the OS, because a diagnostic is usually opened next to a terminal.

/** Design tokens copied from opensourcesai.com src/index.css. */
export const TOKENS = {
  light: {
    bg: "#f8fafc",
    surface: "#ffffff",
    surfaceSoft: "#f1f5f9",
    border: "#dbe3ef",
    text: "#0f172a",
    textMuted: "#475569",
    primary: "#0f766e",
    primaryHover: "#115e59",
    success: "#166634",
    error: "#991b1b",
  },
  dark: {
    bg: "#111110",
    surface: "#18171a",
    surfaceSoft: "#1e1d20",
    border: "#2e2d30",
    text: "#e2e1de",
    textMuted: "#a8a29e",
    primary: "#22d3ee",
    primaryHover: "#67e8f9",
    success: "#86efac",
    error: "#fca5a5",
  },
  radiusCard: "12px",
  radiusFrame: "16px",
  content: "1120px",
};

export const HTML = (token) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Command Center — OpenSourcesAI</title>
<link rel="icon" href="/brand-icon.png">
<link rel="stylesheet" href="/app.css">
</head>
<body>
<header class="topbar">
  <div class="topbar-inner">
    <span class="brand">
      <img src="/brand-icon.png" alt="" width="28" height="28" decoding="async">
      <span>OpenSourcesAI</span>
    </span>
    <span class="brand-divider" aria-hidden="true"></span>
    <span class="product">Command Center</span>
    <span id="livestrip" class="livestrip" aria-live="off"></span>
    <span class="badge-readonly">Read-only</span>
  </div>
</header>
<div class="layout shell">
  <nav id="sidenav" class="sidenav" aria-label="Dashboard sections"></nav>
  <main id="app" aria-busy="true">
    <p class="loading">Reading this machine…</p>
  </main>
</div>
<footer class="shell">
  <span id="meta"></span>
</footer>
<script id="bootstrap" type="application/json">${JSON.stringify({ token })}</script>
<script src="/app.js"></script>
</body>
</html>`;

export const CSS = `:root {
  --color-bg: ${TOKENS.dark.bg};
  --color-surface: ${TOKENS.dark.surface};
  --color-surface-soft: ${TOKENS.dark.surfaceSoft};
  --color-border: ${TOKENS.dark.border};
  --color-text: ${TOKENS.dark.text};
  --color-text-muted: ${TOKENS.dark.textMuted};
  --color-primary: ${TOKENS.dark.primary};
  --color-primary-hover: ${TOKENS.dark.primaryHover};
  --color-success: ${TOKENS.dark.success};
  --color-error: ${TOKENS.dark.error};

  --font-body: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, 'Cascadia Code', Consolas, 'Courier New', monospace;

  --fs-h3: 1.25rem;
  --fs-small: 0.875rem;
  --fs-overline: 0.75rem;
  --track-tight: -0.02em;

  --radius-card: ${TOKENS.radiusCard};
  --radius-frame: ${TOKENS.radiusFrame};
  --content: ${TOKENS.content};

  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-6: 1.5rem;
  --space-8: 2rem;

  --accent-wash: color-mix(in srgb, var(--color-primary) 8%, transparent);
  --accent-border: color-mix(in srgb, var(--color-primary) 38%, transparent);
  color-scheme: dark;
}
@media (prefers-color-scheme: light) {
  :root {
    --color-bg: ${TOKENS.light.bg};
    --color-surface: ${TOKENS.light.surface};
    --color-surface-soft: ${TOKENS.light.surfaceSoft};
    --color-border: ${TOKENS.light.border};
    --color-text: ${TOKENS.light.text};
    --color-text-muted: ${TOKENS.light.textMuted};
    --color-primary: ${TOKENS.light.primary};
    --color-primary-hover: ${TOKENS.light.primaryHover};
    --color-success: ${TOKENS.light.success};
    --color-error: ${TOKENS.light.error};
    color-scheme: light;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-body);
  font-size: 1rem;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}
.shell { max-width: var(--content); margin: 0 auto; padding: 0 var(--space-4); }

.topbar {
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
  position: sticky; top: 0; z-index: 10;
}
.topbar-inner {
  max-width: var(--content); margin: 0 auto; padding: 0 var(--space-4);
  min-height: 64px; display: flex; align-items: center; gap: 0.55rem;
}
.brand {
  display: inline-flex; align-items: center; gap: 0.55rem;
  font-weight: 700; font-size: 1rem; color: var(--color-text); white-space: nowrap;
}
.brand img { width: 28px; height: 28px; border-radius: 999px; }
.brand-divider {
  width: 1px; height: 22px; background: var(--color-border); margin: 0 0.35rem;
}
.product { font-weight: 500; font-size: 1rem; color: var(--color-text-muted); }
/* Compact live readout that follows the user across every view. Without it,
   switching away from Overview would hide the telemetry — which is the one
   thing worth seeing no matter what you are looking at. */
.livestrip {
  margin-left: auto; display: flex; gap: 1rem; align-items: baseline;
  font-size: var(--fs-overline); color: var(--color-text-muted);
  font-variant-numeric: tabular-nums; white-space: nowrap;
}
.livestrip b { color: var(--color-text); font-weight: 600; }
.livestrip .warn { color: #f5b544; }
.livestrip .critical { color: var(--color-error); }

.layout {
  display: grid; grid-template-columns: 190px minmax(0, 1fr);
  gap: var(--space-6); align-items: start;
  padding-top: var(--space-6); padding-bottom: var(--space-6);
}
.sidenav { display: flex; flex-direction: column; gap: 2px; position: sticky; top: 84px; }
.sidenav button {
  text-align: left; width: 100%; border: 1px solid transparent; background: transparent;
  color: var(--color-text-muted); padding: 0.5rem 0.7rem; border-radius: 0.5rem;
  font-size: var(--fs-small); font-weight: 500; letter-spacing: 0;
}
.sidenav button:hover { background: var(--color-surface-soft); color: var(--color-text); }
.sidenav button[aria-current="page"] {
  background: var(--accent-wash); color: var(--color-primary); border-color: var(--accent-border);
}
.sidenav .count { float: right; opacity: 0.7; font-weight: 400; }

.filters { display: flex; gap: var(--space-2); flex-wrap: wrap; margin-bottom: var(--space-4); }
.filters button { font-weight: 500; }
.filters button[aria-pressed="true"] {
  background: var(--accent-wash); border-color: var(--color-primary);
}

@media (max-width: 900px) {
  .layout { grid-template-columns: minmax(0, 1fr); gap: var(--space-4); }
  .sidenav {
    position: static; flex-direction: row; overflow-x: auto;
    border-bottom: 1px solid var(--color-border); padding-bottom: var(--space-2);
  }
  .sidenav button { width: auto; white-space: nowrap; }
  .sidenav .count { display: none; }
  .livestrip { display: none; }
  .badge-readonly { margin-left: auto; }
}

.badge-readonly {
  font-size: var(--fs-overline); font-weight: 600; letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 0.25rem 0.6rem; border-radius: 999px;
  color: var(--color-primary);
  background: var(--accent-wash);
  border: 1px solid var(--accent-border);
}

main.shell { padding-top: var(--space-6); padding-bottom: var(--space-6); }
footer.shell { padding-bottom: var(--space-8); color: var(--color-text-muted); font-size: var(--fs-overline); }
.loading { color: var(--color-text-muted); }

.panel {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-frame);
  padding: 1.25rem 1.4rem;
  margin-bottom: var(--space-4);
}
.panel > h2 {
  margin: 0 0 var(--space-4);
  font-size: var(--fs-overline);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-primary);
}
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: var(--space-4); }
.kv .k { color: var(--color-text-muted); font-size: var(--fs-small); }
.kv .v { font-size: 1rem; margin-top: 2px; word-break: break-word; }
.kv .v.big { font-size: var(--fs-h3); font-weight: 600; letter-spacing: var(--track-tight); }

table { width: 100%; border-collapse: collapse; font-size: var(--fs-small); }
th {
  text-align: left; color: var(--color-text-muted); font-weight: 600;
  font-size: var(--fs-overline); text-transform: uppercase; letter-spacing: 0.05em;
  padding: 0.5rem 0.6rem; border-bottom: 1px solid var(--color-border);
}
td { padding: 0.6rem; border-bottom: 1px solid var(--color-border); vertical-align: top; }
tr:last-child td { border-bottom: 0; }

.pill {
  display: inline-block; padding: 0.15rem 0.6rem; border-radius: 999px;
  font-size: var(--fs-overline); font-weight: 600; letter-spacing: 0.02em; white-space: nowrap;
  border: 1px solid transparent;
}
.pill.comfortable { background: color-mix(in srgb, var(--color-success) 14%, transparent); color: var(--color-success); border-color: color-mix(in srgb, var(--color-success) 32%, transparent); }
.pill.tight { background: var(--accent-wash); color: var(--color-primary); border-color: var(--accent-border); }
.pill.partial { background: color-mix(in srgb, var(--color-text-muted) 14%, transparent); color: var(--color-text-muted); border-color: color-mix(in srgb, var(--color-text-muted) 30%, transparent); }
.pill.too_large { background: color-mix(in srgb, var(--color-error) 14%, transparent); color: var(--color-error); border-color: color-mix(in srgb, var(--color-error) 32%, transparent); }
.pill.known { background: color-mix(in srgb, var(--color-success) 14%, transparent); color: var(--color-success); }
.pill.derived { background: var(--accent-wash); color: var(--color-primary); }
.pill.unlisted { background: color-mix(in srgb, var(--color-text-muted) 14%, transparent); color: var(--color-text-muted); }

.gauges { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: var(--space-4) var(--space-6); }
.gauge-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-2); }
.gauge-label { font-size: var(--fs-small); color: var(--color-text-muted); }
.gauge-value { font-size: var(--fs-small); font-weight: 600; font-variant-numeric: tabular-nums; }
.gauge-track {
  height: 6px; margin-top: 0.4rem; border-radius: 999px;
  background: var(--color-surface-soft); overflow: hidden;
}
.gauge-fill {
  height: 100%; border-radius: 999px; background: var(--color-primary);
  transition: width 0.4s ease;
}
.gauge-fill.warn { background: #f5b544; }
.gauge-fill.critical { background: var(--color-error); }
.gauge-detail { font-size: var(--fs-overline); color: var(--color-text-muted); margin-top: 0.3rem; }
.gauge.unavailable .gauge-value { color: var(--color-text-muted); font-weight: 400; }

.live-dot {
  display: inline-block; width: 7px; height: 7px; border-radius: 999px;
  background: var(--color-primary); margin-right: 0.4rem; vertical-align: 1px;
}
.live-dot.stale { background: var(--color-text-muted); }
.panel-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-4); }
.panel-head h2 { margin-bottom: 0; }
.panel-head .live-meta {
  font-size: var(--fs-overline); color: var(--color-text-muted); font-variant-numeric: tabular-nums;
}
.empty { color: var(--color-text-muted); font-size: var(--fs-small); margin: 0; }

.muted { color: var(--color-text-muted); }
.explain { color: var(--color-text-muted); font-size: var(--fs-small); margin-top: 3px; }
code, .mono { font-family: var(--font-mono); font-size: 0.8125rem; }
.cmd { display: flex; gap: var(--space-2); align-items: center; margin-top: 0.4rem; flex-wrap: wrap; }
.cmd code {
  background: var(--color-surface-soft); padding: 0.2rem 0.45rem;
  border-radius: 0.4rem; border: 1px solid var(--color-border);
}
button {
  font: inherit; font-size: var(--fs-overline); font-weight: 600;
  padding: 0.3rem 0.7rem; cursor: pointer;
  background: transparent; color: var(--color-primary);
  border: 1px solid var(--accent-border); border-radius: 0.5rem;
  transition: background-color 0.15s ease, border-color 0.15s ease;
}
button:hover { background: var(--accent-wash); border-color: var(--color-primary); }
button:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }

.notice {
  border-left: 3px solid var(--color-primary);
  border-radius: 0;
  padding: 0.1rem 0 0.1rem 0.85rem;
  margin: 0.7rem 0;
  font-size: var(--fs-small);
}
.limits { margin: 0; padding-left: 1.1rem; }
.limits li { color: var(--color-text-muted); font-size: var(--fs-small); margin-bottom: 0.25rem; }
.spilled { color: var(--color-primary); }
.footer-link { color: var(--color-primary); text-decoration: none; }
.footer-link:hover { color: var(--color-primary-hover); text-decoration: underline; }

@media (prefers-reduced-motion: reduce) {
  button { transition: none; }
}
@media (max-width: 720px) {
  .panel { padding: 1rem; }
  .product { display: none; }
}
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

function panel(title) {
  const p = el("section", "panel");
  if (title) p.append(el("h2", null, title));
  return p;
}

function copyButton(text) {
  const btn = el("button", null, "Copy");
  btn.type = "button";
  btn.addEventListener("click", () => {
    navigator.clipboard.writeText(text).then(
      () => { btn.textContent = "Copied"; setTimeout(() => { btn.textContent = "Copy"; }, 1200); },
      () => { btn.textContent = "Copy failed"; },
    );
  });
  return btn;
}

function machinePanel(d) {
  const p = panel("This machine");
  const g = el("div", "grid");
  const r = d.report;
  g.append(kv("Platform", (r.platform.distro || r.platform.os) + " (" + r.platform.arch + ")"));
  g.append(kv("CPU", r.cpu.model || "unknown"));
  g.append(kv("System memory", r.memory.totalGb != null ? r.memory.totalGb + " GB" : "unknown"));
  if (r.appleMemory) {
    g.append(kv("Chip", r.appleMemory.chip || "Apple silicon"));
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
      line.textContent = c.source + " = " + c.gib + " GiB" + (c.knownUnreliable ? "   (known-unreliable source)" : "");
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
  if (o.modelStore && o.modelStore.freeGb != null) {
    g.append(kv("Disk free", o.modelStore.freeGb + " / " + o.modelStore.totalGb + " GB"));
  }
  p.append(g);
  return p;
}

// ---------------------------------------------------------------------------
// Live panels. These are rebuilt on every poll, so they are kept separate from
// the static ones above — re-rendering the whole page twice a second would
// fight the user's scroll position and drop any text selection they had.
// ---------------------------------------------------------------------------

function livePanelShell(id, title) {
  const p = el("section", "panel");
  const head = el("div", "panel-head");
  head.append(el("h2", null, title));
  const meta = el("span", "live-meta");
  meta.id = id + "-meta";
  head.append(meta);
  p.append(head);
  const body = el("div");
  body.id = id + "-body";
  p.append(body);
  return p;
}

function renderGauges(live) {
  const body = document.getElementById("gauges-body");
  if (!body) return;
  body.textContent = "";

  const wrap = el("div", "gauges");
  for (const gauge of live.gauges) {
    const cell = el("div", "gauge" + (gauge.available ? "" : " unavailable"));
    const head = el("div", "gauge-head");
    head.append(el("span", "gauge-label", gauge.label));
    head.append(el("span", "gauge-value", gauge.available ? gauge.percent + "%" : "—"));
    cell.append(head);

    const track = el("div", "gauge-track");
    const fill = el("div", "gauge-fill" + (gauge.severity === "normal" ? "" : " " + gauge.severity));
    // Width is the only thing animated; an unavailable gauge stays at zero
    // width and says why underneath rather than implying an idle reading.
    fill.style.width = (gauge.available ? gauge.percent : 0) + "%";
    track.append(fill);
    cell.append(track);

    cell.append(el("div", "gauge-detail", gauge.available ? (gauge.detail || "") : gauge.reason));
    wrap.append(cell);
  }
  body.append(wrap);
}

function renderLoaded(live) {
  const body = document.getElementById("loaded-body");
  if (!body) return;
  body.textContent = "";

  if (!live.loaded.reachable) {
    body.append(el("p", "empty", "Ollama is not responding, so nothing can be reported as loaded."));
    return;
  }
  if (!live.loaded.models.length) {
    body.append(el("p", "empty", "No model is resident right now. Ollama unloads a model after a few minutes idle — run one and this fills in."));
    return;
  }

  const t = el("table");
  const head = el("tr");
  for (const h of ["Model", "In VRAM", "Residency"]) head.append(el("th", null, h));
  t.append(head);
  for (const m of live.loaded.models) {
    const row = el("tr");
    row.append(el("td", null, m.name));
    row.append(el("td", null, m.sizeVramGb + " / " + m.sizeGb + " GB"));
    row.append(el("td", m.spilled ? "spilled" : null,
      m.vramResidentPercent + "%" + (m.spilled ? " — partly on CPU, expect it to be slow" : "")));
    t.append(row);
  }
  body.append(t);
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

// Default to hiding what cannot run here. Measured on the reference machine,
// this one table was 63% of the whole page at 32 rows — and most of the hidden
// rows are models the user has no decision to make about. "Everything" stays
// one click away, because silently omitting data is its own kind of dishonesty.
let showAllModels = false;

function catalogPanel(d) {
  const p = panel("What this machine can run");

  const runnable = d.models.filter((m) => m.fit !== "too_large");
  const hidden = d.models.length - runnable.length;

  const filters = el("div", "filters");
  const mkFilter = (label, isAll) => {
    const b = el("button", null, label);
    b.type = "button";
    b.setAttribute("aria-pressed", String(showAllModels === isAll));
    b.addEventListener("click", () => {
      if (showAllModels === isAll) return;
      showAllModels = isAll;
      renderView(activeView);
    });
    return b;
  };
  // String concatenation, not template literals. This whole bundle is carried
  // inside a template literal in ui.js, so a nested backtick closes it early
  // and a nested interpolation is evaluated at module scope by the outer
  // template instead of at runtime in the browser. Note this comment cannot
  // spell that syntax out either, for exactly the same reason.
  filters.append(
    mkFilter("Runs here (" + runnable.length + ")", false),
    mkFilter("Everything (" + d.models.length + ")", true),
  );
  p.append(filters);

  const rows = showAllModels ? d.models : runnable;
  const t = el("table");
  const head = el("tr");
  for (const h of ["Model", "Fit", "Quant", "Needs", "Run it"]) head.append(el("th", null, h));
  t.append(head);
  for (const m of rows) {
    const row = el("tr");
    const name = el("td");
    name.append(el("div", null, m.name + (m.sparseMoe ? "  (sparse MoE)" : "")));
    // The explanation is shown only where it changes a decision. For a
    // comfortable fit the pill and the "Needs" column already say everything,
    // and repeating "fits with N GB to spare" 27 times was the single largest
    // contributor to this table's height without adding information.
    if (m.fit !== "comfortable") name.append(el("div", "explain", m.explanation));
    row.append(name);
    const fit = el("td");
    fit.append(el("span", "pill " + m.fit, m.fit.replace("_", " ")));
    row.append(fit);
    row.append(el("td", "mono", m.quant || "—"));
    row.append(el("td", null, m.requiredVramGb != null ? m.requiredVramGb + " GB" : "—"));
    const cmd = el("td");
    if (m.runCommand) {
      const box = el("div", "cmd");
      box.append(el("code", null, m.runCommand), copyButton(m.runCommand));
      cmd.append(box);
    } else {
      cmd.append(el("span", "muted", "—"));
    }
    row.append(cmd);
    t.append(row);
  }
  p.append(t);
  if (!showAllModels && hidden > 0) {
    p.append(el("p", "explain",
      hidden + " model" + (hidden === 1 ? "" : "s") +
      " in the catalog need more memory than this machine has. Choose Everything to see them and what they would require."));
  }
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
  box.append(el("code", null, text), copyButton(text));
  p.append(box);
  return p;
}

const POLL_INTERVAL_MS = 2000;
let pollTimer = null;
let consecutiveFailures = 0;
let lastLive = null;

function stampLiveMeta(live) {
  const stamp = live.sampledAt ? new Date(live.sampledAt).toLocaleTimeString() : "";
  for (const id of ["gauges-meta", "loaded-meta"]) {
    const meta = document.getElementById(id);
    if (!meta) continue;
    meta.textContent = "";
    meta.append(el("span", "live-dot"), document.createTextNode("live · " + stamp));
  }
}

/**
 * The compact header readout. This is what makes view-switching acceptable:
 * leaving Overview must not mean losing sight of the machine.
 */
function renderLiveStrip(live) {
  const strip = document.getElementById("livestrip");
  if (!strip) return;
  strip.textContent = "";

  const wanted = ["cpu", "gpu", "vram"];
  for (const id of wanted) {
    const g = live.gauges.find((x) => x.id === id);
    if (!g || !g.available) continue;
    const item = el("span");
    item.append(document.createTextNode(g.label + " "));
    const value = el("b", g.severity === "normal" ? null : g.severity, g.percent + "%");
    item.append(value);
    strip.append(item);
  }

  const count = live.loaded.reachable ? live.loaded.models.length : null;
  if (count !== null) {
    const item = el("span");
    item.append(el("b", null, String(count)), document.createTextNode(count === 1 ? " model loaded" : " models loaded"));
    strip.append(item);
  }
}

async function poll() {
  try {
    const res = await fetch("/api/live", { headers: { "x-cmdcenter-token": TOKEN } });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const live = await res.json();
    if (!live.available) throw new Error(live.reason || "unavailable");

    consecutiveFailures = 0;
    lastLive = live;
    renderGauges(live);
    renderLoaded(live);
    renderLiveStrip(live);
    stampLiveMeta(live);
  } catch (err) {
    consecutiveFailures += 1;
    // Say it went stale rather than freezing on a number that is no longer
    // true. A monitor silently showing old values is worse than one admitting
    // it lost contact.
    for (const id of ["gauges-meta", "loaded-meta"]) {
      const meta = document.getElementById(id);
      if (!meta) continue;
      meta.textContent = "";
      meta.append(el("span", "live-dot stale"), document.createTextNode("stale — " + String(err.message)));
    }
    // Back off rather than hammering a server that is clearly unhappy.
    if (consecutiveFailures >= 5) stopPolling();
  }
}

function startPolling() {
  if (pollTimer !== null) return;
  poll();
  pollTimer = setInterval(poll, POLL_INTERVAL_MS);
}

function stopPolling() {
  if (pollTimer === null) return;
  clearInterval(pollTimer);
  pollTimer = null;
}

// Stop sampling when the tab is not visible. Polling nvidia-smi twice a second
// behind a hidden tab costs the user real CPU for nothing.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopPolling();
  else { consecutiveFailures = 0; startPolling(); }
});

// ---------------------------------------------------------------------------
// Views. One section rendered at a time, because the single-page layout reached
// 13.4 screens of scroll on the reference machine. A sidebar that merely jumps
// between anchors would not have fixed that — it would only be a faster way to
// travel the same distance.
// ---------------------------------------------------------------------------

const VIEWS = [
  {
    id: "overview",
    label: "Overview",
    build: (d) => [livePanelShell("gauges", "Live system"), livePanelShell("loaded", "Loaded right now"), ollamaPanel(d)],
  },
  // Installed and catalog are separate views rather than one "Models" section:
  // together they were 75% of the original page, and they answer different
  // questions — "what do I already have" versus "what could I get".
  {
    id: "installed",
    label: "Installed",
    count: (d) => d.installed.length,
    build: (d) => [installedPanel(d)],
  },
  {
    id: "catalog",
    label: "Catalog",
    count: (d) => d.models.filter((m) => m.fit !== "too_large").length,
    build: (d) => [catalogPanel(d)],
  },
  {
    id: "hardware",
    label: "Hardware",
    // Surfaced in the nav because an unresolved source disagreement is
    // something the user should know exists without hunting for it.
    count: (d) => (d.report.disagreements.length ? d.report.disagreements.length : null),
    build: (d) => [machinePanel(d), disagreementPanel(d)],
  },
  {
    id: "report",
    label: "Report",
    build: (d) => [limitsPanel(d), sharePanel(d)],
  },
];

let dashboardData = null;
let activeView = "overview";

function renderView(id) {
  const view = VIEWS.find((v) => v.id === id) ?? VIEWS[0];
  activeView = view.id;

  app.textContent = "";
  for (const node of view.build(dashboardData)) {
    if (node) app.append(node);
  }

  for (const button of document.querySelectorAll("#sidenav button")) {
    const isActive = button.dataset.view === view.id;
    if (isActive) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }

  // The live panels only exist inside Overview, so repaint them from the last
  // sample on arrival rather than leaving them blank until the next tick.
  if (lastLive) { renderGauges(lastLive); renderLoaded(lastLive); stampLiveMeta(lastLive); }
}

function buildSideNav(d) {
  const nav = document.getElementById("sidenav");
  nav.textContent = "";
  for (const view of VIEWS) {
    const b = el("button", null, view.label);
    b.type = "button";
    b.dataset.view = view.id;
    const n = view.count ? view.count(d) : null;
    if (n !== null && n !== undefined) b.append(el("span", "count", n));
    b.addEventListener("click", () => {
      // Writing the hash drives the render through hashchange, so a click and
      // a pasted link take exactly the same path.
      if (location.hash === "#" + view.id) renderView(view.id);
      else location.hash = view.id;
    });
    nav.append(b);
  }
}

function viewFromHash() {
  const id = location.hash.replace(/^#/, "");
  return VIEWS.some((v) => v.id === id) ? id : "overview";
}

window.addEventListener("hashchange", () => {
  if (dashboardData) renderView(viewFromHash());
});

async function load() {
  const res = await fetch("/api/dashboard", { headers: { "x-cmdcenter-token": TOKEN } });
  if (!res.ok) throw new Error("request failed: " + res.status);
  dashboardData = await res.json();
  const d = dashboardData;

  buildSideNav(d);
  renderView(viewFromHash());
  app.setAttribute("aria-busy", "false");
  startPolling();

  const meta = document.getElementById("meta");
  meta.textContent =
    "Command Center " + d.clientVersion +
    " · report contract v" + d.reportContractVersion +
    " · catalog snapshot " + (d.catalog.generatedAt || "unknown") +
    " (" + d.catalog.modelCount + " models) · read-only, nothing leaves this machine";
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
