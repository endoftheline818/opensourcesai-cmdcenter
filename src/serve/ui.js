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

/**
 * HUD palette copied from the social-image style guide.
 *
 * WHY A SECOND PALETTE, AND WHY THIS SURFACE USES IT
 * The site tokens below still govern semantic colour (success, error) and are
 * still pinned. But the dashboard's *chrome* now follows the social-image HUD
 * language — deep navy, corner brackets, monospace status lines — because that
 * is the visual identity this product already publishes, and because a HUD is
 * one of the few places where the treatment is functional rather than
 * decorative: this is a monitoring instrument.
 *
 * Pinned by fixtures/website-social-palette.json, PARSED from the style guide's
 * own colour table. A restyle there fails a test here.
 */
export const HUD = {
  backgroundDeep: "#060913",
  backgroundNavy: "#0b1225",
  panel: "#0f1b34",
  accentCyan: "#38bdf8",
  accentCyanGlow: "#67e8f9",
  headline: "#f8fafc",
  bodyText: "#cbd5e1",
  mutedText: "#94a3b8",
};

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
    <span class="badge-readonly" title="This tool can load and unload models. It never pulls, deletes or removes anything.">Load / unload only</span>
  </div>
</header>
<div class="layout shell">
  <nav id="sidenav" class="sidenav" aria-label="Dashboard sections"></nav>
  <main id="app" aria-busy="true">
    <pre class="hud-readout" id="hud-readout" aria-hidden="true">OSAI:// COMMAND CENTER
STATUS: <span class="v">READING MACHINE</span>
HOST:   <span class="v">LOOPBACK ONLY</span></pre>
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
  /* HUD chrome, from the social-image style guide. */
  --hud-deep: ${HUD.backgroundDeep};
  --hud-navy: ${HUD.backgroundNavy};
  --hud-panel: ${HUD.panel};
  --hud-cyan: ${HUD.accentCyan};
  --hud-glow: ${HUD.accentCyanGlow};
  --hud-headline: ${HUD.headline};
  --hud-body: ${HUD.bodyText};
  --hud-muted: ${HUD.mutedText};

  --color-bg: ${HUD.backgroundDeep};
  --color-surface: ${HUD.panel};
  --color-surface-soft: ${HUD.backgroundNavy};
  --color-border: rgba(56, 189, 248, 0.18);
  --color-text: ${HUD.headline};
  --color-text-muted: ${HUD.mutedText};
  --color-primary: ${HUD.accentCyan};
  --color-primary-hover: ${HUD.accentCyanGlow};
  /* Semantic colours stay on the SITE tokens — success and error mean the same
     thing everywhere, and are pinned against src/index.css. */
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
/* The HUD is a dark-only treatment by design — the social surfaces it inherits
   from have no light variant, and a light HUD reads as a mistake rather than a
   choice. The site's light tokens stay pinned and available; they are simply
   not what this instrument uses. */
@media (prefers-color-scheme: light) {
  :root { color-scheme: dark; }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--hud-deep);
  color: var(--color-text);
  font-family: var(--font-body);
  font-size: 1rem;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
  /* A single soft cyan bloom off the top, plus fine scanlines — the two
     background motifs the social renders carry. Both are pure CSS so nothing
     is fetched and the CSP stays default-src 'none'. */
  background-image:
    radial-gradient(120% 60% at 50% -10%, rgba(56, 189, 248, 0.10), transparent 60%),
    repeating-linear-gradient(
      to bottom,
      rgba(148, 163, 184, 0.035) 0 1px,
      transparent 1px 3px
    );
  background-attachment: fixed;
}
@media (prefers-reduced-motion: reduce), (prefers-contrast: more) {
  /* Scanlines are texture, not information. Anyone who has asked for reduced
     motion or higher contrast gets the flat field instead. */
  body { background-image: radial-gradient(120% 60% at 50% -10%, rgba(56,189,248,0.08), transparent 60%); }
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

/* The HUD readout, matching the social renders' top-left block: short
   monospace LABEL: value lines with the value in accent cyan. aria-hidden
   because every fact in it is stated in real prose elsewhere on the page —
   it is texture for sighted users, not a second source of truth. */
.hud-readout {
  font-family: var(--font-mono); font-size: var(--fs-overline);
  line-height: 1.7; letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--hud-muted); margin: 0 0 var(--space-4);
  white-space: pre; overflow-x: auto;
}
.hud-readout .v { color: var(--hud-cyan); }

.panel {
  position: relative;
  background: linear-gradient(180deg, var(--hud-panel), var(--hud-navy));
  border: 1px solid var(--color-border);
  border-radius: var(--radius-frame);
  padding: 1.25rem 1.4rem;
  margin-bottom: var(--space-4);
}
/* Four glowing cyan corner brackets — the HUD frame the social renders carry.
   Drawn with two pseudo-elements and border edges rather than eight nodes or
   an image, so it costs no markup and nothing is fetched. */
.panel::before, .panel::after {
  content: ""; position: absolute; width: 14px; height: 14px; pointer-events: none;
  border-color: var(--hud-cyan); border-style: solid; opacity: 0.55;
}
.panel::before {
  top: -1px; left: -1px; border-width: 1px 0 0 1px;
  border-top-left-radius: var(--radius-frame);
  box-shadow: -1px -1px 6px -2px var(--hud-cyan);
}
.panel::after {
  bottom: -1px; right: -1px; border-width: 0 1px 1px 0;
  border-bottom-right-radius: var(--radius-frame);
  box-shadow: 1px 1px 6px -2px var(--hud-cyan);
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

/* RADIAL GAUGES.
   A 270-degree arc drawn with conic-gradient and masked to a ring — no SVG, no
   canvas, no dependency. The arc starts at 135deg so the gap sits at the
   bottom, the way a physical instrument reads. */
.gauges {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
  gap: var(--space-6) var(--space-4); justify-items: center;
}
.gauge { display: flex; flex-direction: column; align-items: center; text-align: center; width: 100%; }
.dial {
  --p: 0;
  --arc: var(--hud-cyan);
  position: relative; width: 104px; height: 104px; border-radius: 50%;
  background: conic-gradient(
    from 135deg,
    var(--arc) 0 calc(var(--p) * 0.75 * 1%),
    rgba(148, 163, 184, 0.16) calc(var(--p) * 0.75 * 1%) 75%,
    transparent 75%
  );
  -webkit-mask: radial-gradient(farthest-side, transparent calc(50% - 9px), #000 calc(50% - 8px));
  mask: radial-gradient(farthest-side, transparent calc(50% - 9px), #000 calc(50% - 8px));
  transition: background 0.45s ease;
}
.dial.warn { --arc: #f5b544; }
.dial.critical { --arc: var(--color-error); }
.dial.unknown { --arc: rgba(148, 163, 184, 0.35); }
.dial-face {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 1px;
}
.dial-value {
  font-family: var(--font-mono); font-size: 1.4rem; font-weight: 600;
  color: var(--hud-headline); font-variant-numeric: tabular-nums; line-height: 1;
}
.dial-value.na { font-size: 1rem; color: var(--color-text-muted); }
.gauge-label {
  margin-top: 0.55rem; font-size: var(--fs-overline); font-weight: 600;
  letter-spacing: 0.08em; text-transform: uppercase; color: var(--hud-cyan);
}
.gauge-detail {
  font-size: var(--fs-overline); color: var(--color-text-muted); margin-top: 0.15rem;
  font-family: var(--font-mono);
}
@media (prefers-reduced-motion: reduce) { .dial { transition: none; } }

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

    const dial = el("div", "dial " + (gauge.available ? gauge.severity : "unknown"));
    // An unavailable gauge draws an EMPTY ring, not a zero-filled one. Same
    // rule as before, restated in the new form: nothing measurable must ever
    // render as a real reading of zero.
    dial.style.setProperty("--p", gauge.available ? gauge.percent : 0);
    dial.setAttribute("role", "img");
    dial.setAttribute("aria-label",
      gauge.label + ": " + (gauge.available ? gauge.percent + " percent" : "unavailable"));

    const face = el("div", "dial-face");
    face.append(el("div", "dial-value" + (gauge.available ? "" : " na"), gauge.available ? gauge.percent + "%" : "n/a"));
    dial.append(face);
    cell.append(dial);

    cell.append(el("div", "gauge-label", gauge.label));
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
  for (const h of ["Model", "In VRAM", "Residency", ""]) head.append(el("th", null, h));
  t.append(head);
  for (const m of live.loaded.models) {
    const row = el("tr");
    row.append(el("td", null, m.name));
    row.append(el("td", null, m.sizeVramGb + " / " + m.sizeGb + " GB"));
    row.append(el("td", m.spilled ? "spilled" : null,
      m.vramResidentPercent + "%" + (m.spilled ? " — partly on CPU, expect it to be slow" : "")));

    const actions = el("td");
    const unload = el("button", null, "Unload");
    unload.type = "button";
    unload.addEventListener("click", async () => {
      unload.disabled = true;
      unload.textContent = "Unloading…";
      try {
        const res = await fetch("/api/actions/unload", {
          method: "POST",
          headers: { "content-type": "application/json", "x-cmdcenter-token": TOKEN },
          body: JSON.stringify({ model: m.name }),
        });
        const b = await res.json();
        if (!b.ok) { unload.textContent = "Failed"; return; }
      } catch { unload.textContent = "Failed"; return; }
      // Repaint straight away rather than waiting up to two seconds for the
      // next tick — an action with a visibly delayed effect reads as broken.
      poll();
    });
    actions.append(unload);
    row.append(actions);
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

// ---------------------------------------------------------------------------
// The one part of this interface that changes anything. Everything else
// observes; this loads and unloads. It is deliberately explicit about that.
// ---------------------------------------------------------------------------
function switcherPanel(d) {
  const p = panel("Load a model");

  const installed = (d.installed || []).map((m) => m.name);
  if (!d.report.ollama.installed || !installed.length) {
    p.append(el("p", "empty", "No installed models to load."));
    return p;
  }

  const row = el("div", "cmd");
  const select = el("select");
  select.id = "switcher-model";
  select.setAttribute("aria-label", "Model to load");
  for (const name of installed) {
    const opt = el("option", null, name);
    opt.value = name;
    select.append(opt);
  }
  const go = el("button", null, "Load");
  go.type = "button";
  row.append(select, go);
  p.append(row);

  const status = el("p", "explain");
  status.id = "switcher-status";
  p.append(status);

  // The confirm text is built from LIVE state, so it names what is actually
  // resident right now rather than what was resident at page load.
  const describeConsequence = () => {
    const loaded = (lastLive && lastLive.loaded.reachable ? lastLive.loaded.models : []);
    const target = select.value;
    if (loaded.some((m) => m.name === target)) return target + " is already loaded.";
    if (!loaded.length) return "Nothing is loaded right now, so this only adds " + target + " to memory.";
    return "Loading " + target + " may evict " + loaded.map((m) => m.name).join(", ") + " to make room.";
  };

  const refreshConsequence = () => { status.textContent = describeConsequence(); };
  select.addEventListener("change", refreshConsequence);
  refreshConsequence();

  go.addEventListener("click", async () => {
    const model = select.value;
    go.disabled = true;
    status.textContent = "Loading " + model + "… this can take a while for a large model.";
    try {
      const res = await fetch("/api/actions/load", {
        method: "POST",
        headers: { "content-type": "application/json", "x-cmdcenter-token": TOKEN },
        body: JSON.stringify({ model: model }),
      });
      const body = await res.json();
      status.textContent = body.ok
        ? model + " loaded in " + Math.round(body.elapsedMs / 100) / 10 + "s."
        : "Could not load " + model + ": " + body.reason;
    } catch (err) {
      status.textContent = "Could not load " + model + ": " + err.message;
    } finally {
      go.disabled = false;
      poll();
    }
  });

  p.append(el("p", "explain", "Loading and unloading are the only things this tool changes. It never pulls, deletes or removes a model."));
  return p;
}

function toolsPanel(d) {
  const t = d.tools;
  const p = panel("MCP servers");

  const g = el("div", "grid");
  g.append(kv("Clients configured", t.summary.clientsConfigured));
  g.append(kv("Servers configured", t.summary.serversConfigured, true));
  g.append(kv("Distinct servers", t.summary.distinctServers));
  g.append(kv("Holding credentials", t.summary.serversHoldingCredentials));
  p.append(g);

  if (!t.servers.length) {
    p.append(el("p", "empty", "No MCP servers found in any known client configuration."));
    return p;
  }

  const table = el("table");
  const head = el("tr");
  for (const h of ["Server", "Client", "Transport", "Package", "Needs"]) head.append(el("th", null, h));
  table.append(head);
  for (const s of t.servers) {
    const row = el("tr");
    row.append(el("td", null, s.name));
    row.append(el("td", "muted", s.client));
    row.append(el("td", "mono", s.transport));
    row.append(el("td", "mono", s.packageHint || (s.command ? s.command : "—")));
    const needs = el("td");
    if (!s.envVarNames.length) {
      needs.append(el("span", "muted", "—"));
    } else {
      needs.append(el("div", "mono muted", s.envVarNames.join(", ")));
      if (s.secretShapedEnvCount > 0) {
        needs.append(el("div", "explain", "Names only — this tool never reads their values."));
      }
    }
    row.append(needs);
    table.append(row);
  }
  p.append(table);
  return p;
}

function localToolsPanel(d) {
  const p = panel("Local AI tools");
  const table = el("table");
  const head = el("tr");
  for (const h of ["Tool", "Detected"]) head.append(el("th", null, h));
  table.append(head);
  for (const tool of d.tools.tools) {
    const row = el("tr");
    row.append(el("td", null, tool.name));
    const status = el("td");
    status.append(el("span", "pill " + (tool.installed ? "known" : "unlisted"), tool.installed ? "installed" : "not found"));
    row.append(status);
    table.append(row);
  }
  p.append(table);
  // Absence here is genuinely weaker evidence than presence, and saying so
  // matters more than looking comprehensive.
  if (d.tools.note) p.append(el("p", "explain", d.tools.note));
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
    build: (d) => [
      livePanelShell("gauges", "Live system"),
      livePanelShell("loaded", "Loaded right now"),
      switcherPanel(d),
      ollamaPanel(d),
    ],
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
    id: "tools",
    label: "Tools",
    count: (d) => d.tools.summary.serversConfigured,
    build: (d) => [toolsPanel(d), localToolsPanel(d)],
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

function hudReadout(d) {
  const pre = el("pre", "hud-readout");
  pre.setAttribute("aria-hidden", "true");
  const line = (label, value) => {
    pre.append(document.createTextNode(label.padEnd(8)));
    pre.append(el("span", "v", value));
    pre.append(document.createTextNode("\\n"));
  };
  pre.append(document.createTextNode("OSAI:// COMMAND CENTER\\n"));
  line("STATUS:", d.report.ollama.installed ? "OLLAMA " + (d.report.ollama.version || "UP") : "OLLAMA DOWN");
  line("HOST:", (d.report.platform.os || "?") + " · " + (d.hardware.basis === "apple-unified-usable" ? "APPLE UNIFIED" : (d.report.gpu ? d.report.gpu.name : "NO GPU")));
  line("MODE:", "LOAD / UNLOAD ONLY · LOOPBACK");
  return pre;
}

function renderView(id) {
  const view = VIEWS.find((v) => v.id === id) ?? VIEWS[0];
  activeView = view.id;

  app.textContent = "";
  app.append(hudReadout(dashboardData));
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
    " (" + d.catalog.modelCount + " models) · nothing leaves this machine";
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
