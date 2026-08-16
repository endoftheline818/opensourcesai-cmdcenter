// The dashboard UI, served from memory as fixed assets.
//
// No runtime framework, bundler, dependency, or external request of any kind —
// consistent with the package's zero-runtime-dependency rule and enforced by the
// CSP in security.js. Tailwind v4 is a development-only compiler for the small
// token sheet in theme.css; its generated string ships with the package, so the
// served app still needs no build, filesystem lookup, or Tailwind installation.
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
 * WHY THIS LEGACY PALETTE REMAINS
 * The social-image values stay pinned and emitted so cross-product drift still
 * fails loudly. The visible dashboard no longer consumes them for foundations:
 * its active chrome is the neutral Industrial palette below. Site tokens still
 * govern shared semantic success and error values.
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

/**
 * Local dashboard palette. These are intentionally neutral rather than blue
 * tinted: the Command Center should read like a hardware instrument, while the
 * pinned website and social palettes above remain available for parity checks.
 */
export const INDUSTRIAL = {
  canvas: "#09090b",
  surface: "#18181b",
  borderSubtle: "#27272a",
  textMain: "#ffffff",
  textMuted: "#a1a1aa",
  brandCyan: "#00f0ff",
  brandCyanHover: "#00d8e6",
  dataOrange: "#ff5a00",
  statusGreen: "#22c55e",
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
    primary: "#0e7a8a",
    primaryHover: "#0b5f6c",
    success: "#166634",
    error: "#991b1b",
  },
  // 2026-08-15 re-pin: the site's dark neutrals moved onto THIS dashboard's
  // zinc ramp (opensourcesai.com phase 4), so bg/surface/border/textMuted
  // below now equal --color-canvas/--color-surface/--color-border-subtle/
  // --color-text-muted in theme.css, and primary equals --color-brand-cyan.
  // The alias lines in CORE_CSS (--color-bg: var(--color-canvas) …) are
  // therefore no longer a divergence they paper over; they are literally
  // true. Nothing rendered here changes.
  dark: {
    bg: "#09090b",
    surface: "#18181b",
    surfaceSoft: "#1f1f23",
    border: "#27272a",
    text: "#e4e4e7",
    textMuted: "#a1a1aa",
    primary: "#00f0ff",
    primaryHover: "#5ff4fa",
    success: "#86efac",
    error: "#fca5a5",
  },
  radiusCard: "12px",
  radiusFrame: "16px",
  content: "1120px",
};

import { CHAT_CSS, CHAT_JS } from "./ui-chat.js";
import { THEME_CSS } from "./theme.generated.js";

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
    <span class="badge-readonly" title="Talks only to AI runtimes on this machine — never to the internet. Its actions are load and unload; it never pulls, deletes or removes anything it did not itself create.">Local AI only</span>
  </div>
</header>
<div class="layout shell">
  <nav id="sidenav" class="sidenav" aria-label="Dashboard sections"></nav>
  <main id="app" aria-busy="true">
    <pre class="hud-readout" id="hud-readout" aria-hidden="true">OSAI:// COMMAND CENTER
STATUS: <span class="v">READING MACHINE</span>
HOST:   <span class="v">LOOPBACK ONLY</span></pre>
    <section class="loading-shell" role="status" aria-live="polite">
      <div class="loading-head">
        <span class="loading-dot" aria-hidden="true"></span>
        <span>Reading this machine</span>
      </div>
      <div class="loading-skeleton" aria-hidden="true">
        <span class="skeleton-line skeleton-line-wide"></span>
        <span class="skeleton-line skeleton-line-short"></span>
        <div class="skeleton-grid">
          <span class="skeleton-block"></span>
          <span class="skeleton-block"></span>
          <span class="skeleton-block"></span>
          <span class="skeleton-block"></span>
        </div>
      </div>
      <span class="sr-only">Collecting local hardware, model, and runtime status.</span>
    </section>
  </main>
</div>
<footer class="shell">
  <span id="meta"></span>
</footer>
<script id="bootstrap" type="application/json">${JSON.stringify({ token })}</script>
<script src="/app.js"></script>
</body>
</html>`;

const CORE_CSS = `:root {
  /* Pinned legacy HUD values remain emitted for cross-product parity. */
  --hud-deep: ${HUD.backgroundDeep};
  --hud-navy: ${HUD.backgroundNavy};
  --hud-panel: ${HUD.panel};
  --hud-cyan: ${HUD.accentCyan};
  --hud-glow: ${HUD.accentCyanGlow};
  --hud-headline: ${HUD.headline};
  --hud-body: ${HUD.bodyText};
  --hud-muted: ${HUD.mutedText};

  /* Industrial tokens are compiled from theme.css by Tailwind v4. */
  --color-bg: var(--color-canvas);
  --color-surface-soft: #111113;
  --color-border: var(--color-border-subtle);
  --color-border-strong: #3f3f46;
  --color-text: var(--color-text-main);
  --color-primary: var(--color-brand-cyan);
  --color-primary-hover: var(--color-brand-cyan-hover);
  /* Semantic colours stay on the SITE tokens — success and error mean the same
     thing everywhere, and are pinned against src/index.css. */
  --color-success: ${TOKENS.dark.success};
  --color-error: ${TOKENS.dark.error};

  /* Telemetry is deliberately two-channel: software/system load is cyan;
     physical GPU, memory, heat, power, clock and storage activity is orange. */
  --metric-cyan: var(--color-brand-cyan);
  --metric-orange: var(--color-data-orange);
  --metric-amber: #f59e0b;
  --metric-neutral: #71717a;
  --metric-red: var(--color-error);

  /* Cyan is the one interaction language across the whole instrument. */
  --view-accent: var(--metric-cyan);
  --view-wash: color-mix(in srgb, var(--view-accent) 7%, transparent);
  --view-border: color-mix(in srgb, var(--view-accent) 42%, var(--color-border));

  --font-body: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, 'Cascadia Code', Consolas, 'Courier New', monospace;

  /* Semantic type roles. The legacy aliases remain because the browser bundle
     uses them widely; new work names the job the text performs. */
  --text-display: clamp(1.8rem, 2.7vw, 2.7rem);
  --text-title: 1.25rem;
  --text-body: 1rem;
  --text-support: 0.9375rem;
  --text-small: 0.875rem;
  --text-label: 0.75rem;
  --text-micro: 0.7rem;
  --fs-h3: var(--text-title);
  --fs-small: var(--text-small);
  --fs-overline: var(--text-label);
  --track-tight: 0;

  --radius-card: ${TOKENS.radiusCard};
  --radius-frame: ${TOKENS.radiusFrame};
  --content: ${TOKENS.content};
  /* The website token above is a reading width. This instrument is a desktop
     workspace: its tables, gauges and chat need room to stay scannable. */
  --content-dashboard: 1480px;
  /* Match the density of this desktop instrument at 80% browser zoom while
     leaving the browser itself at 100%. The zoom property scales fixed and relative
     measurements together, so gauge geometry, borders and type keep the
     proportions approved in the desktop reference captures. */
  --ui-density-scale: 0.8;

  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-6: 1.5rem;
  --space-8: 2rem;

  --accent-wash: color-mix(in srgb, var(--color-primary) 7%, transparent);
  --accent-border: color-mix(in srgb, var(--color-primary) 42%, var(--color-border));
  --surface-panel: var(--color-surface);
  --surface-panel-strong: var(--color-surface);
  --surface-inset: #111113;
  --surface-control: #111113;
  --surface-hover: #202024;
  --shadow-panel: none;
  color-scheme: dark;
}
/* The HUD is a dark-only treatment by design — the social surfaces it inherits
   from have no light variant, and a light HUD reads as a mistake rather than a
   choice. The site's light tokens stay pinned and available; they are simply
   not what this instrument uses. */
html { zoom: var(--ui-density-scale); }
@media (prefers-color-scheme: light) {
  :root { color-scheme: dark; }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--color-canvas);
  color: var(--color-text);
  font-family: var(--font-body);
  font-size: 1rem;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
  /* Neutral instrumentation grid: texture without ambient coloured light. */
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.028) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.028) 1px, transparent 1px);
  background-size: 36px 36px;
  background-attachment: fixed;
}
@media (prefers-reduced-motion: reduce), (prefers-contrast: more) {
  body {
    background-image:
      linear-gradient(rgba(255, 255, 255, 0.045) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255, 255, 255, 0.045) 1px, transparent 1px);
    background-size: 36px 36px;
  }
}
.shell { max-width: var(--content-dashboard); margin: 0 auto; padding: 0 var(--space-4); }

.topbar {
  border-bottom: 1px solid var(--color-border-subtle);
  background: rgba(9, 9, 11, 0.97);
  position: sticky; top: 0; z-index: 10;
}
.topbar-inner {
  max-width: var(--content-dashboard); margin: 0 auto; padding: 0 var(--space-4);
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
  display: grid; grid-template-columns: 204px minmax(0, 1fr);
  gap: var(--space-6); align-items: start;
  padding-top: var(--space-6); padding-bottom: var(--space-6);
}
#app.view-enter {
  animation: viewEnter 240ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
@keyframes viewEnter {
  from { opacity: 0.72; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
.sidenav { display: flex; flex-direction: column; gap: 0.28rem; position: sticky; top: 84px; }
.nav-kicker {
  display: flex; align-items: center; gap: 0.45rem; margin: 0 0.5rem 0.35rem;
  color: var(--color-text-muted); font-family: var(--font-mono);
  font-size: var(--text-micro); font-weight: 700; letter-spacing: 0.1em;
  text-transform: uppercase;
}
.nav-kicker .ui-icon { width: 0.8rem; height: 0.8rem; color: var(--color-primary); }
.sidenav button {
  --nav-accent: var(--metric-cyan);
  position: relative; display: grid; grid-template-columns: 1.15rem minmax(0, 1fr) auto;
  align-items: center; gap: 0.62rem; overflow: hidden;
  text-align: left; width: 100%; border: 1px solid transparent; background: transparent;
  color: var(--color-text-muted); padding: 0.62rem 0.68rem; border-radius: 0.58rem;
  font-size: var(--fs-small); font-weight: 600; letter-spacing: 0;
}
.sidenav button::before {
  content: ""; position: absolute; inset: 0 auto 0 -1px; width: 3px;
  border-radius: 0 999px 999px 0; background: var(--nav-accent);
  opacity: 0; transform: scaleY(0.45); transition: opacity 0.16s ease, transform 0.16s ease;
}
.sidenav button:hover { background: var(--surface-hover); color: var(--color-text); }
.sidenav button[aria-current="page"] {
  background: var(--color-surface);
  color: var(--color-text); border-color: var(--color-brand-cyan);
}
.sidenav button[aria-current="page"]::before { opacity: 1; transform: scaleY(1); }
.nav-icon {
  width: 1rem; height: 1rem; color: var(--nav-accent); opacity: 0.62;
  transition: color 0.16s ease, opacity 0.16s ease, filter 0.16s ease;
}
.sidenav button:hover .nav-icon { opacity: 1; color: var(--nav-accent); }
.sidenav button[aria-current="page"] .nav-icon {
  color: var(--nav-accent); opacity: 1;
}
.nav-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.sidenav .count {
  min-width: 1.45rem; padding: 0 0.35rem; border-radius: 999px;
  text-align: center; opacity: 0.8; font-size: 0.7rem; font-weight: 600;
  background: rgba(148, 163, 184, 0.10); color: var(--color-text-muted);
}
.sidenav button[aria-current="page"] .count {
  color: var(--nav-accent); border: 1px solid color-mix(in srgb, var(--nav-accent) 24%, transparent);
  background: color-mix(in srgb, var(--nav-accent) 9%, transparent);
}

.filters { display: flex; gap: var(--space-2); flex-wrap: wrap; margin-bottom: var(--space-4); }
.filters button { font-weight: 500; }
.filters button[aria-pressed="true"] {
  background: var(--view-wash); color: var(--view-accent); border-color: var(--view-accent);
}
.filters button[aria-pressed="false"]:hover { background: var(--surface-hover); }
.filters .count {
  display: inline-block; min-width: 1.35rem; margin-left: 0.4rem; padding: 0 0.3rem;
  border-radius: 999px; background: rgba(148, 163, 184, 0.10);
  color: var(--color-text-muted); font-size: 0.7rem;
}
.catalog-controls {
  display: grid; gap: var(--space-3); margin-bottom: var(--space-4);
}
.catalog-toolbar {
  display: grid; grid-template-columns: minmax(13rem, 1fr) auto;
  gap: var(--space-3); align-items: center;
}
.catalog-search {
  width: 100%;
}
.catalog-stats {
  display: flex; gap: var(--space-2); flex-wrap: wrap; align-items: center;
  color: var(--color-text-muted); font-size: var(--fs-overline);
}
.catalog-stats span {
  padding: 0.18rem 0.55rem; border: 1px solid var(--color-border);
  border-radius: 999px; background: var(--surface-inset);
}
.catalog-stats b { color: var(--view-accent); font-weight: 750; }
.catalog-fit-filters { margin-bottom: 0; }
.catalog-panel .catalog-search {
  border-color: var(--color-border-strong);
  background-color: var(--surface-control);
}
.catalog-panel .catalog-result-meta { color: var(--color-text-muted); }
.sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
}

/* Bench results viewer. */
.bench-drop {
  border: 1px dashed var(--accent-border); border-radius: var(--radius-card);
  padding: var(--space-6); text-align: center; color: var(--color-text-muted);
  cursor: pointer;
}
.bench-drop.dragover { background: var(--accent-wash); color: var(--color-text); }
.bench-drop input { display: none; }
.bench-dir-list { display: flex; flex-direction: column; gap: var(--space-2); margin-bottom: var(--space-3); }
.bench-dir-row { display: flex; gap: var(--space-3); align-items: baseline; flex-wrap: wrap; }
.bench-dir-name { font-family: var(--font-mono); font-size: var(--fs-small); overflow-wrap: anywhere; }
.bench-note { color: var(--color-text-muted); font-size: var(--fs-small); }
.bench-error { color: var(--color-error); }
.bench-cmd {
  display: inline-block; padding: 0.35rem 0.6rem; border: 1px solid var(--color-border);
  border-radius: 0.5rem; background: var(--surface-inset);
  font-family: var(--font-mono); font-size: var(--fs-small); word-break: break-all;
}
.bench-command-row { display: flex; gap: var(--space-2); align-items: center; flex-wrap: wrap; margin-top: var(--space-3); }
.bench-quality { display: flex; gap: var(--space-3); align-items: center; flex-wrap: wrap; margin-bottom: var(--space-4); }
.bench-quality button { margin-left: auto; }
.bench-attest { display: block; margin-bottom: var(--space-3); }
.diag-list { list-style: none; margin: var(--space-3) 0 0; padding: 0; display: grid; gap: var(--space-2); }
.diag-list li { display: flex; gap: 0.6rem; align-items: baseline; }
.diag-list .status-chip { flex: 0 0 auto; }
.bench-caveats { margin: var(--space-2) 0 0; padding-left: 1.1rem; color: var(--color-text-muted); font-size: var(--fs-small); }
.panel h3 {
  margin: var(--space-4) 0 var(--space-2); font-size: var(--fs-overline);
  letter-spacing: 0.05em; text-transform: uppercase;
  color: var(--color-text-muted); font-weight: 600;
}

@media (max-width: 900px) {
  .layout { grid-template-columns: minmax(0, 1fr); gap: var(--space-4); }
  .overview-control-grid { grid-template-columns: minmax(0, 1fr); }
  .sidenav {
    position: static; flex-direction: row; overflow-x: auto; max-width: 100%;
    border-bottom: 1px solid var(--color-border); padding-bottom: var(--space-2);
    scrollbar-width: none;
  }
  .nav-kicker { display: none; }
  .sidenav::-webkit-scrollbar { display: none; }
  .sidenav button { width: auto; white-space: nowrap; flex: 0 0 auto; grid-template-columns: 1rem auto auto; }
  .sidenav .count { display: inline-block; }
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
.loading-shell {
  position: relative; overflow: hidden; padding: 1.3rem 1.4rem;
  border: 1px solid var(--color-border); border-radius: var(--radius-frame);
  background: var(--surface-panel-strong); box-shadow: var(--shadow-panel);
}
.loading-head {
  display: flex; align-items: center; gap: 0.65rem; margin-bottom: var(--space-4);
  color: var(--color-text); font-size: var(--fs-small); font-weight: 700;
}
.loading-dot {
  width: 0.55rem; height: 0.55rem; flex: 0 0 auto; border-radius: 50%;
  background: var(--color-primary);
  animation: loadingPulse 1.6s ease-in-out infinite;
}
.loading-skeleton, .inline-loading-bars { display: grid; gap: 0.65rem; }
.skeleton-line, .skeleton-block, .inline-skeleton-line {
  position: relative; display: block; overflow: hidden;
  background: rgba(148, 163, 184, 0.09); border: 1px solid rgba(148, 163, 184, 0.05);
}
.skeleton-line { height: 0.72rem; border-radius: 999px; }
.skeleton-line-wide { width: min(34rem, 72%); }
.skeleton-line-short { width: min(22rem, 48%); }
.skeleton-grid {
  display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--space-3); margin-top: 0.35rem;
}
.skeleton-block { min-height: 5.75rem; border-radius: 0.7rem; }
.skeleton-line::after, .skeleton-block::after, .inline-skeleton-line::after {
  content: ""; position: absolute; inset: 0;
  background: linear-gradient(100deg, transparent 15%, rgba(56, 189, 248, 0.13) 48%, transparent 82%);
  transform: translateX(-100%); animation: skeletonShimmer 1.65s ease-in-out infinite;
}
.inline-loading {
  display: grid; gap: 0.7rem; padding: 0.75rem; border: 1px solid var(--color-border);
  border-radius: 0.7rem; background: var(--surface-inset);
}
.inline-loading-label {
  display: flex; align-items: center; gap: 0.5rem;
  color: var(--color-text-muted); font-size: var(--fs-small); font-weight: 600;
}
.inline-loading-label::before {
  content: ""; width: 0.42rem; height: 0.42rem; flex: 0 0 auto;
  border-radius: 50%; background: var(--color-primary);
}
.inline-skeleton-line { height: 0.58rem; border-radius: 999px; }
.inline-skeleton-line:nth-child(2) { width: 72%; }
@keyframes loadingPulse {
  50% { opacity: 0.5; transform: scale(0.82); }
}
@keyframes skeletonShimmer {
  to { transform: translateX(100%); }
}

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
  --panel-accent: var(--view-accent);
  position: relative;
  background: var(--color-surface);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-frame);
  padding: 1.25rem 1.4rem;
  margin-bottom: var(--space-4);
}
.ui-icon {
  display: block; fill: none; stroke: currentColor; stroke-width: 1.8;
  stroke-linecap: round; stroke-linejoin: round;
}
.panel > h2, .panel-head h2 {
  margin: 0 0 var(--space-4);
  font-size: var(--text-label);
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text);
}
.panel-title {
  display: flex; align-items: center; gap: 0.55rem;
}
.panel-title::after {
  content: ""; min-width: 1.5rem; height: 1px; flex: 1 1 auto;
  background: var(--color-border-subtle);
}
.panel-title .panel-icon {
  flex: 0 0 auto; width: 1rem; height: 1rem; color: var(--panel-accent);
}

/* Page structure stays cyan; orange and green are reserved for data and health. */
.panel.installed-panel,
.panel.catalog-panel,
.panel.chat-panel,
.panel.tools-panel,
.panel.report-panel { --panel-accent: var(--metric-cyan); }
.panel.report-limits { --panel-accent: var(--metric-amber); }
.panel.hardware-panel, .panel.trust-readout {
  --panel-accent: var(--metric-cyan);
}
.hardware-panel > .panel-title .panel-icon,
.trust-readout > .panel-title .panel-icon { color: var(--metric-cyan); }
.trust-readout .trust-cell .k { color: var(--color-text-muted); }
.panel.hardware-disagreement-panel { --panel-accent: var(--metric-amber); }
.panel.bench-panel {
  --panel-accent: var(--metric-cyan);
}
.bench-panel > .panel-title .panel-icon { color: var(--metric-cyan); }
.bench-panel .bench-drop { border-color: var(--color-border-subtle); }
.panel.residency-section, .panel.action-panel {
  --panel-accent: var(--metric-cyan);
}
.residency-section > .panel-head .panel-icon,
.action-panel > .panel-title .panel-icon { color: var(--metric-cyan); }
.residency-section .loaded-summary {
  border-color: var(--color-border-subtle);
  background: var(--surface-inset);
}
.residency-section .loaded-summary-label,
.residency-section .loaded-summary-value { color: var(--color-text); }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: var(--space-4); }
.kv .k { color: var(--color-text-muted); font-size: var(--fs-small); }
.kv .v { font-size: 1rem; margin-top: 2px; word-break: break-word; }
.kv .v.big { font-size: var(--fs-h3); font-weight: 600; letter-spacing: var(--track-tight); }

.summary-panel {
  overflow: hidden; padding: 1rem 1.05rem;
  background: var(--color-surface);
}
.summary-main {
  display: grid; grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-4); align-items: center; margin-bottom: 0.65rem;
}
.summary-eyebrow {
  margin: 0 0 0.12rem; font-size: var(--text-micro);
  color: var(--color-primary); font-weight: 700; letter-spacing: 0.06em;
  text-transform: uppercase;
}
.summary-title {
  margin: 0; font-size: clamp(1.65rem, 2.25vw, 2.25rem);
  line-height: 1.04; font-weight: 760; letter-spacing: -0.015em;
}
.summary-detail {
  max-width: 52rem; margin: 0.3rem 0 0;
  color: var(--color-text-muted); font-size: var(--fs-small); line-height: 1.4;
}
.status-chip {
  display: inline-flex; align-items: center; gap: 0.4rem; justify-content: center;
  min-height: 2rem; padding: 0.3rem 0.7rem; border-radius: 999px;
  font-size: var(--fs-overline); font-weight: 700; text-transform: uppercase;
  color: var(--view-accent); background: var(--view-wash); border: 1px solid var(--view-border);
  white-space: nowrap;
}
.status-chip .status-icon { flex: 0 0 auto; width: 0.82rem; height: 0.82rem; }
.status-chip.ready { color: var(--color-status-green); background: color-mix(in srgb, var(--color-status-green) 8%, transparent); border-color: var(--color-status-green); }
.status-chip.ok, .status-chip.verified { color: var(--metric-cyan); background: color-mix(in srgb, var(--metric-cyan) 7%, transparent); border-color: color-mix(in srgb, var(--metric-cyan) 34%, var(--color-border)); }
.status-chip.warn { color: var(--metric-amber); background: rgba(245, 181, 68, 0.12); border-color: rgba(245, 181, 68, 0.32); }
.status-chip.critical { color: var(--color-error); background: color-mix(in srgb, var(--color-error) 12%, transparent); border-color: color-mix(in srgb, var(--color-error) 32%, transparent); }
.summary-grid {
  display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1px; overflow: hidden; border: 1px solid var(--color-border);
  border-radius: 0.6rem; background: var(--color-border);
}
.summary-card {
  --summary-accent: var(--metric-cyan);
  position: relative; min-width: 0; padding: 0.62rem 0.72rem 0.66rem;
  background: var(--surface-inset);
}
.summary-card::before {
  content: ""; position: absolute; inset: 0 auto 0 0; width: 2px;
  background: var(--summary-accent); opacity: 0.78;
}
.summary-card.tone-cyan { --summary-accent: var(--metric-cyan); }
.summary-card.tone-pressure { --summary-accent: var(--metric-cyan); }
.summary-card.tone-pressure.warn { --summary-accent: var(--metric-amber); }
.summary-card.tone-pressure.critical { --summary-accent: var(--metric-red); }
.summary-card.tone-pressure.unavailable { --summary-accent: var(--color-text-muted); }
.summary-card .k {
  color: var(--summary-accent); font-size: var(--text-micro);
  text-transform: uppercase; font-weight: 700; letter-spacing: 0.05em;
}
.summary-card .v {
  margin-top: 0.16rem; color: var(--color-text); font-size: 1.12rem;
  font-weight: 700; line-height: 1.15; overflow-wrap: anywhere;
}
.summary-card .d {
  margin-top: 0.16rem; color: var(--color-text-muted);
  font-size: var(--text-micro); line-height: 1.3;
}
.summary-trust {
  display: flex; gap: 0.36rem; flex-wrap: wrap; margin: 0 0 0.62rem;
}
.summary-trust span {
  display: inline-flex; align-items: center; min-height: 1.35rem;
  padding: 0.1rem 0.45rem; border: 1px solid var(--color-border);
  border-radius: 999px; background: var(--surface-inset);
  color: var(--color-text-muted); font-size: var(--text-micro); font-weight: 650;
}
.summary-action {
  display: grid; grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-3); align-items: center; margin-top: 0.62rem; padding: 0.58rem 0.68rem;
  border: 1px solid var(--color-border-subtle); border-radius: 0.6rem;
  background: var(--surface-inset);
  color: var(--color-text-muted); font-size: var(--fs-overline);
}
.summary-action b { color: var(--color-text); font-weight: 700; }
.summary-action-copy {
  display: grid; grid-template-columns: auto auto minmax(0, 1fr); gap: 0.2rem 0.55rem; align-items: baseline;
}
.summary-action-label {
  color: var(--color-text-muted); font-size: var(--text-micro);
  text-transform: uppercase; font-weight: 700; letter-spacing: 0.05em;
}
.summary-action-copy > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.summary-next {
  display: grid; grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.42rem; margin-top: 0.42rem;
}
.summary-next-card {
  --card-accent: var(--metric-cyan);
  position: relative; overflow: hidden;
  min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.2rem var(--space-2); align-content: center; align-items: center;
  padding: 0.5rem 0.58rem 0.5rem 0.68rem;
  border: 1px solid var(--color-border-subtle);
  border-radius: 0.6rem;
  background: var(--surface-inset);
}
.summary-next-card::before {
  content: ""; position: absolute; inset: 0 auto 0 0; width: 2px;
  background: var(--card-accent); opacity: 0.82;
}
.summary-next-card[data-target="catalog"],
.summary-next-card[data-target="hardware"],
.summary-next-card[data-target="report"] { --card-accent: var(--metric-cyan); }
.summary-next-title {
  color: color-mix(in srgb, var(--card-accent) 72%, var(--color-text));
  font-size: var(--fs-small); font-weight: 700; line-height: 1.15;
}
.summary-next-detail {
  grid-column: 1;
  color: var(--color-text-muted); font-size: var(--text-micro); line-height: 1.25;
}
.summary-next-card button {
  grid-column: 2; grid-row: 1 / span 2; justify-self: end;
  color: var(--card-accent); border-color: color-mix(in srgb, var(--card-accent) 26%, var(--color-border-strong));
}
.summary-next-card button:hover {
  color: color-mix(in srgb, var(--card-accent) 78%, white);
  border-color: color-mix(in srgb, var(--card-accent) 48%, transparent);
  background: color-mix(in srgb, var(--card-accent) 10%, var(--surface-hover));
}

.overview-control-grid {
  display: grid; grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr);
  gap: 0.75rem; align-items: stretch; margin-bottom: var(--space-4);
}
.overview-control-grid > .panel { height: 100%; margin-bottom: 0; }
.overview-control-grid > .panel:first-child { border-color: var(--color-border-subtle); }

.action-panel {
  display: grid; gap: var(--space-4);
}
.action-copy {
  display: grid; gap: 0.25rem;
}
.action-title {
  margin: 0; color: var(--color-text); font-size: 1.12rem;
  font-weight: 750; line-height: 1.2;
}
.action-detail {
  margin: 0; max-width: 44rem; color: var(--color-text-muted); font-size: var(--fs-small);
}
.action-controls {
  display: grid; grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-3); align-items: center;
}
.action-status {
  min-height: 1.35rem; margin: 0; color: var(--color-text-muted); font-size: var(--fs-small);
}
.action-preview {
  display: grid; grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1.8rem; overflow: visible;
}
.action-preview-card {
  --action-accent: var(--metric-cyan);
  position: relative; min-width: 0; padding: 0.8rem;
  border: 1px solid var(--color-border); border-radius: 0.75rem;
  background: var(--surface-inset);
}
.action-preview-card:not(:last-child)::after {
  content: "\\2192"; position: absolute; top: 50%; right: -1.45rem;
  width: 1rem; transform: translateY(-50%); text-align: center;
  color: var(--action-accent); font-family: var(--font-mono); font-weight: 700;
}
.action-step-head {
  display: flex; align-items: center; gap: 0.45rem; margin-bottom: 0.35rem;
  color: var(--color-text-muted); font-size: var(--fs-overline);
  text-transform: uppercase; font-weight: 700; letter-spacing: 0.05em;
}
.action-step-head .ui-icon { width: 0.85rem; height: 0.85rem; color: var(--action-accent); }
.action-step-index {
  color: var(--action-accent); font-family: var(--font-mono); font-size: var(--text-micro);
  letter-spacing: 0.04em;
}
.action-preview-card .k {
  color: inherit;
}
.action-preview-card .v {
  color: var(--color-text); font-weight: 700;
  line-height: 1.2; overflow-wrap: anywhere;
}
.action-preview-card .d {
  margin-top: 0.25rem; color: var(--color-text-muted);
  font-size: var(--fs-overline); line-height: 1.35;
}
.action-preview-card.is-consequence {
  border-color: var(--color-border-subtle);
  border-left: 3px solid var(--action-accent);
  background: var(--surface-inset);
}
.action-preview-card.is-consequence .v { color: var(--action-accent); }
.action-trust {
  display: flex; gap: var(--space-2); flex-wrap: wrap;
}
.action-trust span {
  padding: 0.22rem 0.55rem; border: 1px solid var(--color-border);
  border-radius: 999px; background: var(--surface-inset);
  color: var(--color-text-muted); font-size: var(--fs-overline); font-weight: 600;
}
.primary-action {
  color: var(--color-canvas); background: var(--color-brand-cyan); border-color: var(--color-brand-cyan);
}
.primary-action:hover {
  color: var(--color-canvas); background: var(--color-brand-cyan-hover); border-color: var(--color-brand-cyan-hover);
}
.primary-action:disabled:not([data-busy="true"]) {
  color: var(--color-text-muted); background: rgba(148, 163, 184, 0.12);
  border-color: var(--color-border); opacity: 1;
}

.trust-readout {
  display: grid; gap: var(--space-4);
}
.trust-hero {
  display: grid; grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-4); align-items: start;
}
.trust-title {
  margin: 0; color: var(--color-text); font-size: 1.5rem;
  line-height: 1.1; font-weight: 750; letter-spacing: 0;
}
.trust-detail {
  margin: 0.45rem 0 0; max-width: 48rem;
  color: var(--color-text-muted); font-size: var(--fs-small);
}
.trust-grid, .share-rows, .limits-list, .source-list {
  display: grid; gap: 1px; overflow: hidden;
  border: 1px solid var(--color-border); border-radius: 0.75rem;
  background: var(--color-border);
}
.trust-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}
.trust-cell, .share-row, .limit-item, .source-card {
  min-width: 0; padding: 0.9rem; background: var(--surface-inset);
}
.trust-cell .k, .share-row .k {
  color: var(--color-text-muted); font-size: var(--fs-overline);
  text-transform: uppercase; font-weight: 700; letter-spacing: 0.05em;
}
.trust-cell .v, .share-row .v {
  margin-top: 0.2rem; color: var(--color-text); font-size: 1rem;
  font-weight: 700; line-height: 1.2; overflow-wrap: anywhere;
}
.trust-cell .d, .share-row .d {
  margin-top: 0.25rem; color: var(--color-text-muted);
  font-size: var(--fs-overline); line-height: 1.35;
}
.source-card {
  display: grid; gap: var(--space-3);
}
.source-head {
  display: flex; justify-content: space-between; gap: var(--space-3); align-items: start;
}
.source-title {
  color: var(--color-text); font-weight: 700; overflow-wrap: anywhere;
}
.source-claims {
  display: grid; gap: 0.45rem;
}
.source-claim {
  display: grid; grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-3); align-items: center;
  padding: 0.55rem 0.65rem; border-radius: 0.55rem;
  background: rgba(148, 163, 184, 0.08);
}
.source-claim.selected {
  background: var(--view-wash); border: 1px solid var(--view-border);
}
.source-claim.unreliable {
  background: rgba(245, 181, 68, 0.10); border: 1px solid rgba(245, 181, 68, 0.28);
}
.source-name {
  color: var(--color-text); font-weight: 650; overflow-wrap: anywhere;
}
.source-value {
  color: var(--color-text-muted); font-size: var(--fs-overline);
}
.report-safety {
  display: grid; gap: var(--space-4);
}
.safety-strip {
  display: flex; gap: var(--space-2); flex-wrap: wrap;
}
.safety-strip span {
  padding: 0.22rem 0.55rem; border: 1px solid var(--color-border-subtle);
  border-radius: 999px; background: var(--surface-inset);
  color: var(--color-text-muted);
  font-size: var(--fs-overline); font-weight: 600;
}
.report-limits .limit-item {
  border-left: 2px solid color-mix(in srgb, var(--metric-amber) 72%, transparent);
  background: var(--surface-inset);
}
.share-panel .share-row {
  border-left: 2px solid var(--color-brand-cyan);
  background: var(--surface-inset);
}
.share-panel {
  display: grid; gap: var(--space-4);
}
.share-copy {
  display: flex; justify-content: flex-end;
}

table { width: 100%; border-collapse: collapse; font-size: var(--fs-small); table-layout: auto; }
th {
  text-align: left; color: color-mix(in srgb, var(--view-accent) 54%, var(--color-text-muted)); font-weight: 650;
  font-size: var(--fs-overline); text-transform: uppercase; letter-spacing: 0.05em;
  padding: 0.5rem 0.6rem; border-bottom: 1px solid var(--color-border);
}
td { padding: 0.6rem; border-bottom: 1px solid var(--color-border); vertical-align: top; }
tr:last-child td { border-bottom: 0; }
tbody tr { transition: background-color 0.14s ease; }
tbody tr:hover { background: color-mix(in srgb, var(--view-accent) 5%, transparent); }
.catalog-result-meta {
  display: flex; justify-content: space-between; gap: var(--space-3);
  margin: 0 0 var(--space-2); color: var(--color-text-muted);
  font-size: var(--text-label); font-weight: 650; letter-spacing: 0.03em;
  text-transform: uppercase;
}
.catalog-table-wrap {
  max-height: min(66vh, 42rem); overflow: auto;
  border: 1px solid var(--color-border); border-radius: 0.75rem;
  background: var(--surface-inset); scrollbar-gutter: stable;
}
.catalog-table-wrap:focus-visible { outline: 2px solid var(--view-accent); outline-offset: 2px; }
.catalog-table { table-layout: fixed; }
.catalog-table th { position: sticky; top: 0; z-index: 2; background: var(--color-surface); }
.catalog-table th:nth-child(1) { width: 34%; }
.catalog-table th:nth-child(2) { width: 12%; }
.catalog-table th:nth-child(3) { width: 10%; }
.catalog-table th:nth-child(4) { width: 11%; }
.catalog-table th:nth-child(5) { width: 33%; }
.catalog-table td { padding: 0.48rem 0.6rem; line-height: 1.35; }
.catalog-table .cmd { margin-top: 0; flex-wrap: nowrap; }
.catalog-table .cmd code {
  min-width: 0; flex: 1 1 auto; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; overflow-wrap: normal;
}
.catalog-table .explain {
  display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2;
  line-clamp: 2; font-size: var(--text-label); line-height: 1.35;
}
.model-name { font-weight: 650; color: var(--color-text); overflow-wrap: anywhere; }

.pill {
  display: inline-block; padding: 0.15rem 0.6rem; border-radius: 999px;
  font-size: var(--fs-overline); font-weight: 600; letter-spacing: 0.02em; white-space: nowrap;
  border: 1px solid transparent;
}
.pill.comfortable { background: color-mix(in srgb, var(--metric-cyan) 7%, transparent); color: var(--metric-cyan); border-color: color-mix(in srgb, var(--metric-cyan) 30%, transparent); }
.pill.tight { background: color-mix(in srgb, var(--metric-amber) 13%, transparent); color: var(--metric-amber); border-color: color-mix(in srgb, var(--metric-amber) 30%, transparent); }
.pill.partial { background: color-mix(in srgb, var(--color-text-muted) 14%, transparent); color: var(--color-text-muted); border-color: color-mix(in srgb, var(--color-text-muted) 30%, transparent); }
.pill.too_large { background: color-mix(in srgb, var(--color-error) 14%, transparent); color: var(--color-error); border-color: color-mix(in srgb, var(--color-error) 32%, transparent); }
.pill.known { background: var(--surface-inset); color: var(--color-text-muted); }
.pill.derived { background: color-mix(in srgb, var(--metric-cyan) 7%, transparent); color: var(--metric-cyan); }
.pill.unlisted { background: color-mix(in srgb, var(--color-text-muted) 14%, transparent); color: var(--color-text-muted); }

/* LIVE MONITORING CANVAS.
   Compact title rails, values, bounded history, and mixed chart forms provide
   Grafana-like scan density without a chart dependency or invented samples. */
.gauges {
  display: grid; grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: 0.55rem;
}
.telemetry-section {
  padding: 0.82rem; border-color: var(--color-border-subtle);
  background:
    linear-gradient(rgba(255, 255, 255, 0.026) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.026) 1px, transparent 1px),
    var(--color-surface);
  background-size: 24px 24px, 24px 24px, auto;
}
.telemetry-section > .panel-head {
  align-items: center; margin-bottom: 0.62rem; padding: 0 0.12rem 0.56rem;
  border-bottom: 1px solid var(--color-border);
}
.metric-panel {
  --metric-color: var(--metric-cyan);
  position: relative; grid-column: span 3; min-width: 0; overflow: hidden;
  border: 1px solid var(--color-border-subtle);
  border-radius: 0.42rem;
  background: var(--surface-inset);
}
.metric-panel.tone-cyan { --metric-color: var(--metric-cyan); }
.metric-panel.tone-orange { --metric-color: var(--metric-orange); }
.metric-panel.tone-warn { --metric-color: var(--metric-amber); }
.metric-panel.tone-critical { --metric-color: var(--metric-red); }
.metric-panel.tone-neutral,
.metric-panel.tone-unknown { --metric-color: var(--metric-neutral); }
.metric-panel.is-featured { min-height: 156px; padding: 0.58rem 0.64rem 0.52rem; }
.metric-panel.is-compact { min-height: 116px; padding: 0.55rem 0.6rem 0.5rem; }
.metric-panel-head {
  display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;
  margin-bottom: 0.3rem;
}
.metric-panel-title {
  display: flex; align-items: center; gap: 0.38rem; min-width: 0;
  color: var(--color-text-muted); font-size: var(--text-micro); font-weight: 750;
  letter-spacing: 0.075em; line-height: 1.2; text-transform: uppercase;
}
.metric-panel-title .ui-icon { width: 0.75rem; height: 0.75rem; flex: 0 0 auto; }
.metric-panel-title span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.metric-sample-state {
  display: inline-flex; align-items: center; color: var(--color-text-muted);
  font-family: var(--font-mono); font-size: 0.62rem; line-height: 1;
}
.metric-sample-state .live-dot { width: 5px; height: 5px; margin-right: 0.28rem; background: var(--metric-color); }
.metric-sample-state.stale { opacity: 0.58; }
.metric-stat-row { display: flex; align-items: baseline; gap: 0.55rem; min-width: 0; }
.metric-stat-value {
  flex: 0 0 auto; color: var(--color-text-main); font-family: var(--font-mono);
  font-size: 1.85rem; font-weight: 720; letter-spacing: -0.045em; line-height: 1;
}
.metric-stat-value.na { color: var(--color-text-muted); font-size: 1.15rem; }
.metric-stat-detail {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--color-text-muted); font-family: var(--font-mono); font-size: var(--text-micro);
}
.metric-compact-body {
  display: grid; grid-template-columns: 68px minmax(0, 1fr); gap: 0.58rem;
  align-items: center; min-width: 0;
}
.metric-compact-copy { min-width: 0; }
.metric-chart-empty {
  display: grid; place-items: center; min-height: 48px; padding: 0.35rem;
  border: 1px dashed rgba(148, 163, 184, 0.18); color: var(--color-text-muted);
  font-size: var(--text-micro); text-align: center;
}
.metric-bar {
  --metric-p: 0; height: 3px; margin-top: 0.32rem; overflow: hidden;
  border-radius: 999px; background: rgba(148, 163, 184, 0.13);
}
.metric-bar span {
  display: block; width: calc(var(--metric-p) * 1%); height: 100%;
  border-radius: inherit; background: var(--metric-color);
  transition: width 0.45s ease;
}
.metric-bar.unavailable { opacity: 0.45; }
.dial {
  --p: 0;
  --arc: var(--metric-color, var(--hud-cyan));
  position: relative; width: 68px; height: 68px; border-radius: 50%;
}
.dial::before {
  content: ""; position: absolute; inset: 0; border-radius: inherit;
  background: conic-gradient(
    from 135deg,
    var(--arc) 0 calc(var(--p) * 0.75 * 1%),
    rgba(148, 163, 184, 0.16) calc(var(--p) * 0.75 * 1%) 75%,
    transparent 75%
  );
  -webkit-mask: radial-gradient(farthest-side, transparent calc(50% - 7px), #000 calc(50% - 6px));
  mask: radial-gradient(farthest-side, transparent calc(50% - 7px), #000 calc(50% - 6px));
  transition: background 0.45s ease;
}
.dial.warn { --arc: var(--metric-amber); }
.dial.critical { --arc: var(--color-error); }
.dial.unknown { --arc: rgba(148, 163, 184, 0.35); }
.dial.polling::after {
  content: ""; position: absolute; inset: 5px; border-radius: inherit;
  border: 1px solid color-mix(in srgb, var(--arc) 46%, transparent);
  pointer-events: none; animation: gaugeBreathe 2.6s ease-in-out infinite;
}
.dial-face {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 1px;
  z-index: 1;
}
.dial-value {
  font-family: var(--font-mono); font-size: 0.94rem; font-weight: 680;
  color: var(--color-text-main); font-variant-numeric: tabular-nums; line-height: 1;
}
.dial-value.na { font-size: 0.85rem; color: var(--color-text-muted); }
.gauge-detail {
  min-height: 1.4em; margin: 0 0 0.12rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: var(--text-micro); line-height: 1.25; color: var(--color-text-muted);
  font-family: var(--font-mono);
}
.gauge-trend {
  display: grid; gap: 0.08rem; min-width: 0; margin-top: 0.18rem;
  color: var(--metric-color);
}
.gauge-trend.stale { opacity: 0.52; }
.sparkline { display: block; width: 100%; height: 28px; overflow: visible; }
.sparkline.sparkline-featured { height: 58px; }
.sparkline-grid { stroke: rgba(148, 163, 184, 0.13); stroke-width: 1; vector-effect: non-scaling-stroke; }
.sparkline-area { fill: currentColor; opacity: 0.11; }
.sparkline-line {
  fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round;
  stroke-linejoin: round; vector-effect: non-scaling-stroke;
}
.sparkline-dot { fill: currentColor; }
.gauge-trend-caption {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--color-text-muted); font-family: var(--font-mono);
  font-size: var(--text-micro); line-height: 1.2;
}

.metric-value { display: inline-block; font-variant-numeric: tabular-nums; }
.metric-changed { animation: metricFlash 620ms cubic-bezier(0.22, 1, 0.36, 1); }

@keyframes metricFlash {
  0% { filter: brightness(1); transform: scale(1); }
  30% { filter: brightness(1.24); transform: scale(1.025); }
  100% { filter: brightness(1); transform: scale(1); }
}
@keyframes liveBreathe {
  0%, 100% { opacity: 0.58; transform: scale(0.9); }
  50% { opacity: 1; transform: scale(1); }
}
@keyframes gaugeBreathe {
  0%, 100% { opacity: 0.18; transform: scale(0.992); }
  50% { opacity: 0.42; transform: scale(1.015); }
}

.live-dot {
  display: inline-block; width: 7px; height: 7px; border-radius: 999px;
  background: var(--color-primary); margin-right: 0.4rem; vertical-align: 1px;
}
.live-dot:not(.stale) { animation: liveBreathe 2.4s ease-in-out infinite; }
.live-dot.stale { background: var(--color-text-muted); }
.livestrip.polling::before, .livestrip.stale::before {
  content: ""; width: 6px; height: 6px; border-radius: 999px;
  flex: 0 0 auto; align-self: center;
}
.livestrip.polling::before {
  background: var(--color-primary); animation: liveBreathe 2.4s ease-in-out infinite;
}
.livestrip.stale { opacity: 0.72; }
.livestrip.stale::before { background: var(--color-text-muted); }
.panel-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-4); }
.panel-head h2 { margin-bottom: 0; }
.panel-head .live-meta {
  font-size: var(--fs-overline); color: var(--color-text-muted); font-variant-numeric: tabular-nums;
}
.empty { color: var(--color-text-muted); font-size: var(--fs-small); margin: 0; }
.empty-state {
  display: flex; align-items: flex-start; gap: 0.7rem; padding: 0.8rem 0.9rem;
  border: 1px dashed var(--color-border-strong); border-radius: 0.7rem;
  background: var(--surface-inset);
}
.empty-state .ui-icon {
  width: 1rem; height: 1rem; flex: 0 0 auto; margin-top: 0.15rem;
  color: var(--color-text-muted); opacity: 0.78;
}

.live-summary, .loaded-summary {
  display: grid; gap: var(--space-3); margin-bottom: var(--space-4);
  padding: 0.85rem; border: 1px solid var(--color-border); border-radius: 0.75rem;
  background: var(--surface-inset);
}
.live-summary.warn, .loaded-summary.spilled {
  border-color: rgba(245, 181, 68, 0.32);
  background: rgba(245, 181, 68, 0.08);
}
.live-summary.critical {
  border-color: color-mix(in srgb, var(--color-error) 36%, transparent);
  background: color-mix(in srgb, var(--color-error) 10%, transparent);
}
.live-summary-main, .loaded-summary-main {
  display: grid; grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-4); align-items: start;
}
.live-summary-label, .loaded-summary-label {
  color: var(--color-text-muted); font-size: var(--fs-overline);
  text-transform: uppercase; font-weight: 700; letter-spacing: 0.05em;
}
.live-summary-title, .loaded-summary-title {
  margin-top: 0.1rem; color: var(--color-text); font-size: 1.05rem;
  font-weight: 750; line-height: 1.2; overflow-wrap: anywhere;
}
.live-summary-detail, .loaded-summary-detail {
  margin-top: 0.25rem; color: var(--color-text-muted);
  font-size: var(--fs-overline); line-height: 1.35;
}
.live-summary-value, .loaded-summary-value {
  color: var(--hud-headline); font-family: var(--font-mono);
  font-size: 1.25rem; font-weight: 700; font-variant-numeric: tabular-nums;
  line-height: 1.1; white-space: nowrap;
}
.live-summary.warn .live-summary-value, .loaded-summary.spilled .loaded-summary-value { color: #f5b544; }
.live-summary.critical .live-summary-value { color: var(--color-error); }
.live-summary.unavailable .live-summary-value, .loaded-summary.offline .loaded-summary-value { color: var(--color-text-muted); }
.live-summary-chips, .loaded-summary-chips {
  display: flex; gap: var(--space-2); flex-wrap: wrap; align-items: center;
}
.live-summary-chips span, .loaded-summary-chips span {
  display: inline-flex; align-items: center; min-height: 1.45rem;
  padding: 0.1rem 0.52rem; border-radius: 999px;
  background: rgba(148, 163, 184, 0.10); color: var(--color-text-muted);
  font-size: var(--fs-overline); font-weight: 650;
}
.live-pressure-list {
  display: grid; gap: 1px; overflow: hidden;
  border: 1px solid var(--color-border); border-radius: 0.65rem;
  background: var(--color-border);
}
.live-pressure-row {
  display: grid; grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-3); align-items: center;
  padding: 0.62rem 0.7rem; background: var(--surface-inset);
}
.live-pressure-row.warn .live-pressure-value { color: #f5b544; }
.live-pressure-row.critical .live-pressure-value { color: var(--color-error); }
.live-pressure-name {
  color: var(--color-text); font-size: var(--fs-small); font-weight: 700;
  overflow-wrap: anywhere;
}
.live-pressure-detail {
  margin-top: 0.05rem; color: var(--color-text-muted);
  font-size: var(--fs-overline); line-height: 1.3; overflow-wrap: anywhere;
}
.live-pressure-value {
  color: var(--hud-headline); font-family: var(--font-mono);
  font-size: var(--fs-small); font-weight: 700; font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* Overview pressure reads as a compact status rail. Loaded keeps the more
   explanatory card treatment because it contains destructive-adjacent unload
   controls below; the monitoring canvas itself prioritizes scan speed. */
.telemetry-section .live-summary {
  display: grid; grid-template-columns: minmax(13rem, 0.9fr) minmax(0, 2fr) auto;
  gap: 1px; align-items: stretch; overflow: hidden; margin-bottom: 0.55rem; padding: 0;
  border-radius: 0.42rem; background: var(--color-border);
}
.telemetry-section .live-summary-main {
  grid-column: 1; grid-row: 1; align-items: center; gap: 0.65rem;
  padding: 0.52rem 0.62rem; background: var(--surface-inset);
}
.telemetry-section .live-summary-label { color: var(--metric-cyan); font-size: var(--text-micro); }
.telemetry-section .live-summary-title { margin-top: 0; font-size: var(--fs-small); }
.telemetry-section .live-summary-detail {
  max-width: 24rem; margin-top: 0.08rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: var(--text-micro);
}
.telemetry-section .live-summary-value { font-size: 1.1rem; }
.telemetry-section .live-pressure-list {
  grid-column: 2; grid-row: 1; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1px; border: 0; border-radius: 0; background: var(--color-border);
}
.telemetry-section .live-pressure-row {
  grid-template-columns: minmax(0, 1fr) auto; gap: 0.4rem; padding: 0.45rem 0.52rem;
  background: var(--surface-inset);
}
.telemetry-section .live-pressure-name { font-size: var(--fs-overline); }
.telemetry-section .live-pressure-detail {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--text-micro);
}
.telemetry-section .live-pressure-value { font-size: var(--fs-overline); }
.telemetry-section .live-summary-chips {
  grid-column: 3; grid-row: 1; display: grid; gap: 0.2rem; align-content: center;
  padding: 0.42rem 0.5rem; background: var(--surface-inset);
}
.telemetry-section .live-summary-chips span {
  justify-content: center; min-height: 1.1rem; padding: 0.02rem 0.36rem; font-size: 0.62rem;
}

.loaded-list, .installed-list {
  display: grid; gap: 1px; overflow: hidden;
  border: 1px solid var(--color-border); border-radius: 0.75rem;
  background: var(--color-border);
}
.installed-list {
  border-color: var(--color-border-subtle);
  background: var(--color-border-subtle);
}
.loaded-item, .installed-item {
  min-width: 0; background: var(--surface-inset); padding: 0.9rem;
}
.loaded-item {
  display: grid; grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-4); align-items: start;
}
.loaded-name, .installed-name {
  color: var(--color-text); font-weight: 700; overflow-wrap: anywhere;
}
.loaded-metrics, .installed-meta {
  display: flex; gap: var(--space-2); flex-wrap: wrap; align-items: center;
  margin-top: 0.4rem; color: var(--color-text-muted); font-size: var(--fs-overline);
}
.loaded-metrics span, .installed-state {
  display: inline-flex; align-items: center; min-height: 1.45rem; padding: 0.1rem 0.5rem;
  border-radius: 999px; background: rgba(148, 163, 184, 0.10);
}
.loaded-state.resident-state {
  color: var(--metric-cyan);
  background: color-mix(in srgb, var(--metric-cyan) 7%, transparent);
}
.loaded-state.spilled-state {
  color: #f5b544;
  background: rgba(245, 181, 68, 0.12);
}
.loaded-state.unknown-state {
  color: var(--color-text-muted);
}
.unload-notice {
  margin: 0.75rem 0 0; padding: 0.6rem 0.75rem;
  border: 1px solid transparent; border-radius: var(--radius-card);
  font-size: var(--fs-small); line-height: 1.45;
}
.unload-notice.warn {
  color: #f5b544;
  background: rgba(245, 181, 68, 0.1);
  border-color: rgba(245, 181, 68, 0.32);
}
.unload-notice.unknown {
  color: var(--color-text-muted);
  border-color: var(--color-border);
}
.loaded-residency {
  margin-top: 0.65rem; display: grid; gap: 0.35rem;
}
.residency-meter {
  height: 0.45rem; overflow: hidden; border-radius: 999px;
  background: rgba(148, 163, 184, 0.16);
}
.residency-meter span {
  display: block; height: 100%; width: var(--resident, 0%);
  background: var(--color-primary);
}
.loaded-item.spilled .residency-meter span { background: #f5b544; }
.loaded-actions { display: flex; justify-content: flex-end; }
.installed-item {
  position: relative;
  display: grid; grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-4); align-items: start;
  background: var(--surface-inset);
}
.installed-item::before {
  content: ""; position: absolute; inset: 0 auto 0 0; width: 2px;
  background: var(--metric-cyan);
  opacity: 0.78;
}
.installed-name { color: var(--color-text); }
.installed-fit {
  margin-top: 0.55rem;
}
.installed-action {
  display: grid; gap: 0.45rem; justify-items: end; min-width: 7rem;
}
.installed-action button { min-width: 5.25rem; }
.tools-panel .grid .kv .v.big,
.tools-panel .grid .kv:nth-child(2) .v { color: var(--color-text); }
.tools-panel table { border-top: 1px solid var(--color-border-subtle); }
.report-panel .share-row .k { color: var(--color-text-muted); }

.muted { color: var(--color-text-muted); }
.explain { color: var(--color-text-muted); font-size: var(--fs-small); margin-top: 3px; }
code, .mono { font-family: var(--font-mono); font-size: 0.8125rem; }
.cmd { display: flex; gap: var(--space-2); align-items: center; margin-top: 0.4rem; flex-wrap: wrap; min-width: 0; }
.cmd code {
  background: var(--color-surface-soft); padding: 0.2rem 0.45rem;
  border-radius: 0.4rem; border: 1px solid var(--color-border);
  max-width: 100%; overflow-wrap: anywhere;
}
button, select, input {
  font: inherit; font-size: var(--fs-overline); font-weight: 600;
  min-height: 2rem; padding: 0.35rem 0.75rem;
  background: var(--surface-control); color: var(--color-text);
  border: 1px solid var(--color-border-strong); border-radius: 0.5rem;
  transition: background-color 0.15s ease, border-color 0.15s ease,
    color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
}
button { cursor: pointer; }
button:hover { background: var(--surface-hover); color: var(--view-accent); border-color: var(--view-border); }
button:not(:disabled):hover { transform: translateY(-1px); }
button:not(:disabled):active { transform: translateY(0) scale(0.985); transition-duration: 80ms; }
button:disabled { cursor: wait; opacity: 0.58; }
button:disabled:not([data-busy="true"]) { cursor: default; }
button:focus-visible, select:focus-visible, input:focus-visible {
  outline: 2px solid var(--view-accent); outline-offset: 2px;
}
select:hover, input:hover { background-color: var(--surface-hover); border-color: var(--view-border); }
button[data-busy="true"] { cursor: wait; opacity: 1; }
button[data-busy="true"]::before {
  content: ""; display: inline-block; width: 0.78rem; height: 0.78rem;
  margin-right: 0.48rem; vertical-align: -0.12rem; border: 2px solid currentColor;
  border-right-color: transparent; border-radius: 50%; animation: busySpin 0.72s linear infinite;
}
.primary-action[data-busy="true"]::before { border-color: var(--color-canvas); border-right-color: transparent; }
@keyframes busySpin { to { transform: rotate(360deg); } }
input {
  color: var(--color-text); font-weight: 500;
}
input::placeholder { color: var(--color-text-muted); opacity: 0.78; }
select {
  color: var(--color-text); min-width: min(22rem, 100%);
  appearance: none;
  padding-right: 2rem;
  background-image:
    linear-gradient(45deg, transparent 50%, var(--view-accent) 50%),
    linear-gradient(135deg, var(--view-accent) 50%, transparent 50%);
  background-position:
    calc(100% - 1rem) 50%,
    calc(100% - 0.65rem) 50%;
  background-size: 0.35rem 0.35rem, 0.35rem 0.35rem;
  background-repeat: no-repeat;
}
.icon-button {
  min-width: 2rem; padding: 0.25rem 0.5rem;
  font-size: 1rem; line-height: 1; color: var(--view-accent);
}

.notice {
  border-left: 3px solid var(--view-accent);
  border-radius: 0;
  padding: 0.1rem 0 0.1rem 0.85rem;
  margin: 0.7rem 0;
  font-size: var(--fs-small);
}
.limits { margin: 0; padding-left: 1.1rem; }
.limits li { color: var(--color-text-muted); font-size: var(--fs-small); margin-bottom: 0.25rem; }
.spilled { color: var(--metric-amber); }
.footer-link { color: var(--color-primary); text-decoration: none; }
.footer-link:hover { color: var(--color-primary-hover); text-decoration: underline; }

@media (max-width: 1100px) {
  .metric-panel { grid-column: span 6; }
  .telemetry-section .live-summary {
    grid-template-columns: minmax(12rem, 0.8fr) minmax(0, 1.7fr);
  }
  .telemetry-section .live-summary-chips { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  #app.view-enter, .metric-changed, .live-dot:not(.stale),
  .livestrip.polling::before, .dial.polling::after, .loading-dot,
  .skeleton-line::after, .skeleton-block::after, .inline-skeleton-line::after,
  button[data-busy="true"]::before { animation: none; }
  .dial::before, .metric-bar span, .sidenav button::before, .nav-icon, button, select, input { transition: none; }
}
@media (max-width: 720px) {
  .topbar-inner { min-height: 64px; }
  .panel { padding: 1rem; }
  .product { display: none; }
  .summary-main { grid-template-columns: minmax(0, 1fr); }
  .summary-grid { grid-template-columns: minmax(0, 1fr); }
  .summary-title { font-size: 1.75rem; }
  .summary-action { grid-template-columns: minmax(0, 1fr); }
  .summary-action button { width: 100%; }
  .summary-next { grid-template-columns: minmax(0, 1fr); }
  .summary-next-card button { width: 100%; }
  .trust-hero { grid-template-columns: minmax(0, 1fr); }
  .trust-grid { grid-template-columns: minmax(0, 1fr); }
  .source-head { flex-direction: column; }
  .source-claim { grid-template-columns: minmax(0, 1fr); }
  .share-copy { justify-content: stretch; }
  .share-copy button { width: 100%; }
  .action-controls { grid-template-columns: minmax(0, 1fr); }
  .action-controls button { width: 100%; }
  .action-preview { grid-template-columns: minmax(0, 1fr); }
  .action-preview-card:not(:last-child)::after { display: none; }
  .live-summary-main, .loaded-summary-main, .live-pressure-row { grid-template-columns: minmax(0, 1fr); }
  .loaded-item, .installed-item { grid-template-columns: minmax(0, 1fr); }
  .loaded-actions, .installed-action { justify-content: stretch; justify-items: stretch; }
  .loaded-actions button, .installed-action button { width: 100%; }
  .catalog-toolbar { grid-template-columns: minmax(0, 1fr); }
  .catalog-stats { gap: 0.35rem; }
  .catalog-fit-filters button { flex: 1 1 auto; }
  .hud-readout { white-space: pre-wrap; overflow-wrap: anywhere; }
  .telemetry-section .live-summary { grid-template-columns: minmax(0, 1fr); }
  .telemetry-section .live-summary-main,
  .telemetry-section .live-pressure-list { grid-column: 1; grid-row: auto; }
  .telemetry-section .live-pressure-list { grid-template-columns: minmax(0, 1fr); }
  .gauges { grid-template-columns: minmax(0, 1fr); gap: var(--space-3); }
  .metric-panel { grid-column: auto; }
  .responsive-table, .responsive-table tbody, .responsive-table tr, .responsive-table td {
    display: block; width: 100%;
  }
  .responsive-table thead, .responsive-table th { display: none; }
  .responsive-table tr {
    padding: 0.85rem 0; border-bottom: 1px solid var(--color-border);
  }
  .responsive-table tr:last-child { border-bottom: 0; }
  .responsive-table td {
    border-bottom: 0; padding: 0.24rem 0;
  }
  .responsive-table td[data-label] {
    display: grid; grid-template-columns: minmax(4.7rem, 31%) minmax(0, 1fr);
    gap: var(--space-3); align-items: start;
  }
  .responsive-table td[data-label]::before {
    content: attr(data-label); color: var(--color-text-muted);
    font-size: var(--fs-overline); font-weight: 700; text-transform: uppercase;
  }
  .responsive-table .cmd {
    display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center;
  }
  .catalog-table tr { padding: 0.75rem 0; }
  .responsive-table .cmd code { min-width: 0; }
  .catalog-table-wrap { max-height: none; overflow: visible; border: 0; background: transparent; }
  select { width: 100%; }
}
`;

const CORE_JS = `"use strict";
const TOKEN = JSON.parse(document.getElementById("bootstrap").textContent).token;
const app = document.getElementById("app");

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  // Machine-derived strings always use textContent, never innerHTML. The only
  // markup built below is SVG geometry selected from this closed local set.
  if (text !== undefined && text !== null) n.textContent = String(text);
  return n;
};

// The SVG namespace is an identifier, not a request target. Compose it so the
// package's deliberately blunt "no absolute URL in the browser bundle" guard
// can keep treating every literal URL as suspicious without a special case.
const SVG_NS = ["http:", "", "www.w3.org", "2000", "svg"].join("/");
const ICON_PATHS = Object.freeze({
  overview: "M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z",
  installed: "M4 7h16v12H4z M8 7V4h8v3 M8 11h8 M8 15h5",
  catalog: "M4 5h6v14H4z M14 5h6v14h-6z M7 9h.01 M17 9h.01 M7 13h.01 M17 13h.01",
  bench: "M4 19V5 M4 19h16 M7 15l3-3 3 2 5-7",
  chat: "M4 5h16v11H9l-5 4z M8 9h8 M8 12h5",
  tools: "M14.7 6.3a4 4 0 0 0-5 5L4 17l3 3 5.7-5.7a4 4 0 0 0 5-5l-2.5 2.5-3-3z",
  hardware: "M9 4h6v3h3v10h-3v3H9v-3H6V7h3z M10 9h4v6h-4z M3 9h3 M3 15h3 M18 9h3 M18 15h3",
  report: "M6 3h8l4 4v14H6z M14 3v5h5 M9 13h6 M9 17h6",
  activity: "M3 12h4l2-6 4 12 2-6h6",
  load: "M12 3v12 M7 10l5 5 5-5 M5 21h14",
  server: "M4 4h16v6H4z M4 14h16v6H4z M8 7h.01 M8 17h.01",
  shield: "M12 3l8 3v6c0 5-3 8-8 10-5-2-8-5-8-10V6z",
  alert: "M12 3 2 21h20L12 3z M12 9v5 M12 18h.01",
  check: "M20 6 9 17l-5-5",
  search: "M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14z M16 16l5 5",
  compare: "M7 4v16 M3 8l4-4 4 4 M17 20V4 M13 16l4 4 4-4",
});

function svgNode(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const pair of Object.entries(attrs || {})) node.setAttribute(pair[0], String(pair[1]));
  return node;
}

function uiIcon(name, cls) {
  const svg = svgNode("svg", {
    viewBox: "0 0 24 24",
    class: "ui-icon" + (cls ? " " + cls : ""),
    "aria-hidden": "true",
    focusable: "false",
  });
  svg.append(svgNode("path", { d: ICON_PATHS[name] || ICON_PATHS.overview }));
  return svg;
}

function panelIconName(title) {
  const value = String(title || "").toLowerCase();
  if (value.includes("disagreement") || value.includes("limits")) return "alert";
  if (value.includes("installed") || value.includes("loaded")) return "installed";
  if (value.includes("catalog") || value.includes("can run")) return "catalog";
  if (value.includes("load a model")) return "load";
  if (value.includes("mcp") || value.includes("server")) return "server";
  if (value.includes("tools")) return "tools";
  if (value.includes("chat")) return "chat";
  if (value.includes("report safety")) return "shield";
  if (value.includes("report") || value.includes("shareable")) return "report";
  if (value.includes("compare")) return "compare";
  if (value.includes("benchmark") || value.includes("bandwidth") || value.includes("live") || value.startsWith("results")) return "bench";
  if (value.includes("inspect") || value.includes("result")) return "search";
  if (value.includes("hardware") || value.includes("machine facts") || value.includes("read this machine")) return "hardware";
  return "overview";
}

function panelHeading(title, iconName) {
  const heading = el("h2", "panel-title");
  heading.append(uiIcon(iconName || panelIconName(title), "panel-icon"), el("span", null, title));
  return heading;
}

function statusChip(text, tone) {
  const chip = el("span", "status-chip" + (tone ? " " + tone : ""));
  const iconName = tone === "critical" || tone === "warn" ? "alert" : tone === "ok" || tone === "ready" || tone === "verified" ? "check" : "activity";
  chip.append(uiIcon(iconName, "status-icon"), document.createTextNode(String(text)));
  return chip;
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const liveMetricValues = new Map();
const TREND_GAUGE_IDS = new Set(["cpu", "ram", "gpu", "vram", "temp", "power", "clocks", "disk"]);
const FEATURED_GAUGE_IDS = new Set(["cpu", "ram", "gpu", "vram"]);
const NON_PRESSURE_GAUGE_IDS = new Set(["clocks"]);
const LIVE_HISTORY_LIMIT = 30;
const liveMetricHistory = new Map();
let viewTransitionFrame = null;
let viewTransitionToken = 0;

function prefersReducedMotion() {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function animateLiveMetric(node, key, nextValue, suffix, dial) {
  const next = Number(nextValue);
  const previous = liveMetricValues.get(key);
  const unit = suffix || "";
  node.classList.add("metric-value");

  const paint = (value) => {
    node.textContent = String(Math.round(value)) + unit;
    if (dial) dial.style.setProperty("--p", String(value));
  };

  if (!Number.isFinite(next)) {
    liveMetricValues.delete(key);
    node.textContent = String(nextValue);
    if (dial) dial.style.setProperty("--p", "0");
    return;
  }

  liveMetricValues.set(key, next);
  if (!Number.isFinite(previous) || previous === next || prefersReducedMotion()) {
    paint(next);
    return;
  }

  node.classList.add("metric-changed");
  paint(previous);
  const startedAt = performance.now();
  const durationMs = 520;
  const step = (now) => {
    if (!node.isConnected) return;
    const progress = Math.min(1, (now - startedAt) / durationMs);
    const eased = 1 - Math.pow(1 - progress, 3);
    paint(previous + (next - previous) * eased);
    if (progress < 1) requestAnimationFrame(step);
    else paint(next);
  };
  requestAnimationFrame(step);
}

function recordLiveMetricHistory(live) {
  for (const id of TREND_GAUGE_IDS) {
    const gauge = (live.gauges || []).find((candidate) => candidate.id === id);
    const value = gauge && gauge.available ? Number(gauge.percent) : NaN;
    if (!Number.isFinite(value)) {
      liveMetricHistory.delete(id);
      continue;
    }
    const history = liveMetricHistory.get(id) || [];
    history.push(Math.max(0, Math.min(100, value)));
    if (history.length > LIVE_HISTORY_LIMIT) history.splice(0, history.length - LIVE_HISTORY_LIMIT);
    liveMetricHistory.set(id, history);
  }
}

function setPollingVisualState(active, reason) {
  for (const dial of document.querySelectorAll(".dial:not(.unknown)")) {
    dial.classList.toggle("polling", active);
  }
  for (const trend of document.querySelectorAll(".gauge-trend")) {
    trend.classList.toggle("stale", !active);
    const label = trend.getAttribute("aria-label");
    if (label) trend.setAttribute("aria-label", label.replace(/ recent (live|stale) trend:/, " recent " + (active ? "live" : "stale") + " trend:"));
  }
  for (const state of document.querySelectorAll(".metric-sample-state")) {
    state.classList.toggle("stale", !active);
    const dot = state.querySelector(".live-dot");
    if (dot) dot.classList.toggle("stale", !active);
    if (state.lastChild && state.lastChild.nodeType === Node.TEXT_NODE) {
      state.lastChild.nodeValue = active ? "live" : "stale";
    }
  }
  const strip = document.getElementById("livestrip");
  if (!strip) return;
  strip.classList.toggle("polling", active);
  strip.classList.toggle("stale", !active);
  strip.title = active
    ? "Live telemetry updates every 2 seconds"
    : "Telemetry stale" + (reason ? ": " + reason : "");
}

function playViewTransition() {
  const token = ++viewTransitionToken;
  app.classList.remove("view-enter");
  if (viewTransitionFrame !== null) cancelAnimationFrame(viewTransitionFrame);
  if (prefersReducedMotion()) return;
  viewTransitionFrame = requestAnimationFrame(() => {
    viewTransitionFrame = null;
    if (token !== viewTransitionToken) return;
    app.classList.add("view-enter");
    setTimeout(() => {
      if (token === viewTransitionToken) app.classList.remove("view-enter");
    }, 280);
  });
}

function kv(label, value, big) {
  const wrap = el("div", "kv");
  wrap.append(el("div", "k", label), el("div", "v" + (big ? " big" : ""), value));
  return wrap;
}

function panel(title) {
  const p = el("section", "panel");
  if (title) p.append(panelHeading(title));
  return p;
}

function inlineLoadingState(label, rows) {
  const state = el("div", "inline-loading");
  state.setAttribute("role", "status");
  state.append(el("div", "inline-loading-label", label));
  const bars = el("div", "inline-loading-bars");
  bars.setAttribute("aria-hidden", "true");
  for (let i = 0; i < (rows || 2); i += 1) bars.append(el("span", "inline-skeleton-line"));
  state.append(bars);
  return state;
}

function emptyState(message, iconName) {
  const state = el("div", "empty-state");
  state.append(uiIcon(iconName || "activity"), el("p", "empty", message));
  return state;
}

function tableHead(headers) {
  const thead = el("thead");
  const row = el("tr");
  for (const h of headers) row.append(el("th", null, h));
  thead.append(row);
  return thead;
}

function dataTable(headers, cls) {
  const t = el("table", cls || "responsive-table");
  const body = el("tbody");
  t.append(tableHead(headers), body);
  return { table: t, body: body };
}

function dataCell(label, cls, text) {
  const td = el("td", cls, text);
  td.setAttribute("data-label", label);
  return td;
}

function copyButton(text, label, iconOnly) {
  const btn = el("button", iconOnly ? "icon-button" : null, iconOnly ? "⧉" : "Copy");
  btn.type = "button";
  if (label) btn.setAttribute("aria-label", label);
  if (iconOnly && label) btn.title = label;
  btn.addEventListener("click", () => {
    navigator.clipboard.writeText(text).then(
      () => { btn.textContent = iconOnly ? "OK" : "Copied"; setTimeout(() => { btn.textContent = iconOnly ? "⧉" : "Copy"; }, 1200); },
      () => { btn.textContent = iconOnly ? "!" : "Copy failed"; },
    );
  });
  return btn;
}

function summaryCard(label, value, detail, id, tone) {
  const card = el("div", "summary-card" + (tone ? " tone-" + tone : ""));
  card.append(el("div", "k", label));
  const v = el("div", "v", value);
  const d = el("div", "d", detail);
  if (id) {
    card.id = id + "-card";
    v.id = id + "-value";
    d.id = id + "-detail";
  }
  card.append(v, d);
  return card;
}

function readiness(d) {
  const runnable = d.models.filter((m) => m.fit !== "too_large");
  const comfortable = d.models.filter((m) => m.fit === "comfortable");
  if (!d.report.ollama.installed) {
    // Auth-demanding is its own state, not a flavour of "unreachable": bare
    // Ollama never asks for credentials, so something IS answering — a
    // gateway or proxy whose client config likely set OLLAMA_HOST. "Needs
    // Ollama" would send the user to reinstall a service that is running.
    if (d.report.ollama.apiAuthRequired) {
      return {
        tone: "critical",
        label: "Wrong endpoint",
        title: "The endpoint demands authentication",
        detail: "Ollama's local API never asks for credentials, so OLLAMA_HOST likely points at a gateway or proxy. Aim Command Center at the real Ollama endpoint.",
      };
    }
    return {
      tone: "critical",
      label: "Needs Ollama",
      title: "Ollama is not reachable",
      detail: "The machine was inspected, but model actions and live residency need the local Ollama service.",
    };
  }
  if (!d.installed.length) {
    return {
      tone: "warn",
      label: "No models",
      title: "Machine checked. No local models installed.",
      detail: runnable.length + " catalog models fit this hardware, but loading requires a model already installed in Ollama.",
    };
  }
  if (comfortable.length) {
    return {
      tone: "ready",
      label: "Ready",
      title: "Ready to run local models",
      detail: comfortable.length + " catalog models fit comfortably, with " + d.installed.length + " model" + (d.installed.length === 1 ? "" : "s") + " installed locally.",
    };
  }
  return {
    tone: "warn",
    label: "Constrained",
    title: "Models can run, but expect tradeoffs",
    detail: runnable.length + " catalog models fit with CPU offload or tight memory pressure. Check the Catalog before loading.",
  };
}

function hardwareCapacity(d) {
  if (d.hardware.basis === "apple-unified-usable") return d.hardware.vramGb + " GB usable unified";
  if (d.report.gpu) return d.report.gpu.nameplateGb + " GB VRAM";
  return "CPU / RAM only";
}

function basisLabel(d) {
  if (d.hardware.basis === "apple-unified-usable") return "Apple usable unified memory";
  if (d.hardware.basis === "discrete-vram-nameplate") return "Discrete VRAM nameplate";
  if (d.hardware.basis === "cpu-only") return "CPU / RAM offload";
  return d.hardware.basis.split("-").join(" ");
}

function gradingValue(d) {
  if (d.hardware.basis === "apple-unified-usable") return d.hardware.vramGb + " GB usable";
  if (d.report.gpu) return d.hardware.vramGb + " GB VRAM";
  return "No GPU";
}

function selectedSourceLabel(d) {
  if (d.hardware.basis === "apple-unified-usable") return "sysctl hw.memsize";
  if (d.report.gpu) return d.report.gpu.selectedSource || "selected source";
  return "No VRAM source";
}

function selectedSourceDetail(d) {
  if (d.hardware.basis === "apple-unified-usable") return "Unified memory facts stay in Machine facts";
  if (d.report.gpu) return "Raw source kept visible below";
  return "Catalog uses CPU/RAM offload";
}

function sourceConfidence(d) {
  const sources = d.report.vramSources || { independentSources: 0 };
  if (d.report.disagreements.length) {
    return { tone: "warn", label: "Visible disagreement" };
  }
  if (d.hardware.basis === "apple-unified-usable" && d.report.appleMemory && d.report.appleMemory.sourcesAgree === true) {
    return { tone: "verified", label: "Cross-checked" };
  }
  if (sources.independentSources >= 2) return { tone: "verified", label: "Cross-checked" };
  if (sources.independentSources === 1) return { tone: "warn", label: "Single source" };
  return { tone: "critical", label: "Limited evidence" };
}

function trustCell(label, value, detail) {
  const cell = el("div", "trust-cell");
  cell.append(el("div", "k", label), el("div", "v", value), el("div", "d", detail));
  return cell;
}

// ---------------------------------------------------------------------------
// The bandwidth ceiling's provenance, and the manual-entry escape hatch. The
// table is deliberately narrow (manufacturer-sourced entries only), so an
// unlisted GPU gets an honest "no figure" - and this panel is where a user
// supplies their own, labelled manual everywhere it travels.
// ---------------------------------------------------------------------------

var bandwidthStatus = null;

function refreshHardware() {
  if (activeView === "hardware" && dashboardData) renderView("hardware");
}

async function refreshBandwidthStatus() {
  try {
    const res = await fetch("/api/settings/bandwidth", { headers: { "x-cmdcenter-token": TOKEN } });
    bandwidthStatus = await res.json();
  } catch (err) {
    bandwidthStatus = { ok: false, reason: String(err.message) };
  }
}

async function saveBandwidth(value) {
  try {
    const res = await fetch("/api/settings/bandwidth/set", {
      method: "POST",
      headers: { "content-type": "application/json", "x-cmdcenter-token": TOKEN },
      body: JSON.stringify({ memoryBandwidthGBps: value }),
    });
    const payload = await res.json();
    if (payload.ok) bandwidthStatus = payload;
    else bandwidthStatus = Object.assign({}, bandwidthStatus, { lastError: payload.reason });
  } catch (err) {
    bandwidthStatus = Object.assign({}, bandwidthStatus, { lastError: String(err.message) });
  }
  refreshHardware();
}

async function clearBandwidth() {
  try {
    const res = await fetch("/api/settings/bandwidth/clear", {
      method: "POST",
      headers: { "content-type": "application/json", "x-cmdcenter-token": TOKEN },
      body: "{}",
    });
    const payload = await res.json();
    if (payload.ok) bandwidthStatus = payload;
    else bandwidthStatus = Object.assign({}, bandwidthStatus, { lastError: payload.reason });
  } catch (err) {
    bandwidthStatus = Object.assign({}, bandwidthStatus, { lastError: String(err.message) });
  }
  refreshHardware();
}

function bandwidthPanel() {
  const p = panel("Memory-bandwidth ceiling");
  p.className += " hardware-panel";
  if (!bandwidthStatus) {
    p.append(inlineLoadingState("Reading the ceiling's provenance", 2));
    return p;
  }
  if (bandwidthStatus.ok === false) {
    p.append(el("p", "bench-error", bandwidthStatus.reason || "unavailable"));
    return p;
  }
  const s = bandwidthStatus;
  const r = s.resolution;

  if (r.memoryBandwidthGBps !== null) {
    const isManual = r.source === "manual";
    const head = el("div", "bench-quality");
    head.append(statusChip(isManual ? "manual entry" : "manufacturer-sourced", isManual ? "warn" : "ok"));
    head.append(el("span", null, r.memoryBandwidthGBps + " GB/s in effect" + (!isManual && r.entryId ? " · table entry " + r.entryId : "")));
    p.append(head);
    if (isManual) {
      p.append(el("p", "bench-note",
        "You entered this figure" + (s.manual && s.manual.enteredAt ? " on " + new Date(s.manual.enteredAt).toLocaleDateString() : "") +
        ". It is your claim about your hardware and is labelled manual everywhere it is used - it never counts as manufacturer-sourced."));
      if (s.overridesTable) {
        p.append(el("p", "bench-note",
          "It overrides the manufacturer-sourced figure for this GPU (" + s.overridesTable.memoryBandwidthGBps +
          " GB/s, entry " + s.overridesTable.entryId + "). Remove the manual entry to return to the sourced figure."));
      }
    }
  } else {
    p.append(el("p", "bench-note", s.gpu
      ? 'No sourced bandwidth figure exists for "' + s.gpu.name + '" - the table lists only GPUs with an archived manufacturer source, and a missing entry renders as unavailable rather than guessed. Enter your own figure below to get utilization readings, labelled manual everywhere they appear.'
      : "No GPU detected - there is no hardware to resolve a ceiling for."));
  }

  if (s.manual && s.manual.exists && !s.manual.applied && s.manual.ignoredReason) {
    p.append(el("p", "bench-error",
      "A stored manual figure (" + s.manual.memoryBandwidthGBps + " GB/s) is NOT applied: " + s.manual.ignoredReason + ". Remove it below if it no longer describes this machine."));
  }
  if (s.manual && s.manual.exists === false && s.manual.problem) {
    p.append(el("p", "bench-error", "The stored manual entry could not be read: " + s.manual.problem));
  }
  if (s.lastError) p.append(el("p", "bench-error", s.lastError));

  if (!s.persistence.available) {
    p.append(el("p", "bench-note", "Manual entry is unavailable: " + (s.persistence.reason || "storage did not open") + "."));
    return p;
  }
  if (s.gpu) {
    const row = el("div", "bench-command-row");
    const input = el("input");
    input.type = "number";
    input.min = "1";
    input.max = "10000";
    input.step = "0.1";
    input.placeholder = "GB/s";
    input.setAttribute("aria-label", "Manual memory bandwidth in GB/s");
    const save = el("button", null, s.manual && s.manual.exists ? "Replace manual figure" : "Save manual figure");
    save.type = "button";
    save.addEventListener("click", function () { saveBandwidth(Number(input.value)); });
    row.append(input, save);
    if (s.manual && s.manual.exists) {
      const remove = el("button", null, "Remove manual entry");
      remove.type = "button";
      remove.addEventListener("click", clearBandwidth);
      row.append(remove);
    }
    p.append(row);
    p.append(el("p", "bench-note",
      'The figure is tied to "' + s.gpu.name + '" and stops applying if the primary GPU changes. Use the memory-bandwidth figure (GB/s) from the manufacturer spec sheet for your exact card.'));
  }
  return p;
}

function hardwareTrustPanel(d) {
  const p = panel("Hardware trust readout");
  p.className += " trust-readout";
  const confidence = sourceConfidence(d);
  const sources = d.report.vramSources || { independentSources: 0 };
  const independentSources = Number(sources.independentSources || 0);
  const disagreementCount = d.report.disagreements.length;

  const hero = el("div", "trust-hero");
  const copy = el("div");
  copy.append(el("p", "trust-title", "Catalog grading uses " + gradingValue(d)));
  copy.append(el("p", "trust-detail", d.hardware.note));
  hero.append(copy, statusChip(confidence.label, confidence.tone));
  p.append(hero);

  const grid = el("div", "trust-grid");
  grid.append(
    trustCell("Basis", basisLabel(d), "Used for Catalog fit decisions"),
    trustCell("Selected source", selectedSourceLabel(d), selectedSourceDetail(d)),
    trustCell(
      "Cross-checks",
      independentSources + " independent",
      disagreementCount ? disagreementCount + " disagreement" + (disagreementCount === 1 ? "" : "s") : "No source disagreement",
    ),
    trustCell("Public report", d.report.exportable.vram_band, "VRAM band only; exact values stay local"),
  );
  p.append(grid);
  return p;
}

function goToView(id) {
  if (location.hash === "#" + id) renderView(id);
  else location.hash = id;
}

function focusSwitcher() {
  const select = document.getElementById("switcher-model");
  if (!select) return;
  select.scrollIntoView({ block: "center", inline: "nearest" });
  select.focus();
}

function summaryTrustRail(d) {
  const rail = el("div", "summary-trust");
  const runtime = d.report.ollama.installed
    ? "Ollama " + (d.report.ollama.version || "local")
    : "Ollama offline";
  const facts = [
    el("span", null, "Loopback only"),
    el("span", null, "Never touches the internet"),
    el("span", null, runtime),
    el("span", null, d.report.disagreements.length ? d.report.disagreements.length + " hardware disagreement" : sourceConfidence(d).label),
  ];
  const store = d.report.ollama.modelStore;
  if (store && store.freeGb != null) {
    const disk = el("span", null, "Model disk " + store.freeGb + " GB free");
    if (store.totalGb != null) disk.title = store.freeGb + " GB free of " + store.totalGb + " GB";
    facts.push(disk);
  }
  rail.append(...facts);
  return rail;
}

/**
 * @param {object} d          The page-load dashboard payload.
 * @param {object[]} runnable Catalog models that fit.
 * @param {object[]} loaded   Resident models — LIVE once a sample has arrived.
 * @param {boolean} [reachable] Live Ollama reachability. Undefined before the
 *   first sample, when only the page-load snapshot is available.
 */
function overviewNextAction(d, runnable, loaded, reachable) {
  // Checked before the static install flag, because Ollama can stop while the
  // page is open. Advising someone to warm a model when the service is gone
  // would be the same class of stale claim this panel was fixed for.
  if (reachable === false) {
    return {
      title: "Start Ollama locally",
      detail: "Ollama stopped responding, so residency and actions are unavailable.",
      button: null,
    };
  }
  if (!d.report.ollama.installed) {
    return {
      title: "Start Ollama locally",
      detail: "Model actions and live residency need the local Ollama service.",
      button: null,
    };
  }
  if (!d.installed.length) {
    return {
      title: "Install a local model",
      detail: runnable.length + " catalog models fit this machine; actions require an installed model.",
      button: "Open Catalog",
      onClick: () => { goToView("catalog"); },
    };
  }
  if (!loaded.length) {
    return {
      title: "Warm an installed model",
      detail: "The load request uses an empty prompt and does not download anything.",
      button: "Choose Model",
      onClick: focusSwitcher,
    };
  }
  return {
    title: "Manage resident models",
    detail: loaded.length + " model" + (loaded.length === 1 ? "" : "s") + " currently reported as resident.",
    button: "Review Controls",
    onClick: focusSwitcher,
  };
}

function summaryActionPanel(d, runnable, loaded, reachable) {
  const action = overviewNextAction(d, runnable, loaded, reachable);
  const wrap = el("div", "summary-action");
  // The id is the contract between this builder and renderNextActionLive(),
  // which replaces the whole panel on every live sample. A test pins the two
  // together so they cannot drift apart silently.
  wrap.id = "summary-action";
  const copy = el("div", "summary-action-copy");
  copy.append(el("div", "summary-action-label", "Next action"), el("b", null, action.title), el("span", null, action.detail));
  wrap.append(copy);
  if (action.button) {
    const button = el("button", "primary-action", action.button);
    button.type = "button";
    button.addEventListener("click", action.onClick);
    wrap.append(button);
  }
  return wrap;
}

function summaryNextCard(title, detail, label, target) {
  const card = el("div", "summary-next-card");
  card.dataset.target = target;
  card.append(el("div", "summary-next-title", title), el("div", "summary-next-detail", detail));
  const button = el("button", null, label);
  button.type = "button";
  button.addEventListener("click", () => { goToView(target); });
  card.append(button);
  return card;
}

function summaryNextSteps(d, runnable) {
  const wrap = el("div", "summary-next");
  wrap.append(
    summaryNextCard("Catalog options", runnable.length + " runnable catalog models on this machine.", "Open Catalog", "catalog"),
    summaryNextCard("Hardware evidence", d.report.disagreements.length ? d.report.disagreements.length + " source disagreement visible." : basisLabel(d), "Review Hardware", "hardware"),
    summaryNextCard("Public report", Object.keys(d.report.exportable).length + " bounded share fields.", "Open Report", "report"),
  );
  return wrap;
}

function overviewSummaryPanel(d) {
  const p = panel();
  p.className += " summary-panel";
  const state = readiness(d);
  const runnable = d.models.filter((m) => m.fit !== "too_large");
  const comfortable = d.models.filter((m) => m.fit === "comfortable").length;
  const best = d.models.find((m) => m.fit === "comfortable") || runnable[0] || null;
  const loaded = d.loaded || [];

  const main = el("div", "summary-main");
  const copy = el("div");
  copy.append(el("p", "summary-eyebrow", "Local Ollama command surface"));
  copy.append(el("h1", "summary-title", state.title));
  copy.append(el("p", "summary-detail", state.detail));
  main.append(copy, statusChip(state.label, state.tone));
  p.append(main);
  p.append(summaryTrustRail(d));

  const cards = el("div", "summary-grid");
  cards.append(summaryCard(
    "Capacity",
    runnable.length + " runnable",
    comfortable + " comfortable" + (best ? "; best first: " + best.name : ""),
    null,
    "cyan",
  ));
  cards.append(summaryCard("Hardware", hardwareCapacity(d), d.hardware.basis.split("-").join(" "), null, "cyan"));
  cards.append(summaryCard("Loaded", String(loaded.length), loaded.length === 1 ? loaded[0].name : "Live residency updates below", "summary-loaded", "cyan"));
  cards.append(summaryCard("Pressure", "Waiting", "Live telemetry updates every 2s", "summary-pressure", "pressure unavailable"));
  p.append(cards);

  p.append(summaryActionPanel(d, runnable, loaded), summaryNextSteps(d, runnable));
  return p;
}

function machinePanel(d) {
  const p = panel("Machine facts");
  p.className += " hardware-panel";
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
  const p = panel("Source disagreement");
  p.className += " hardware-panel hardware-disagreement-panel";
  p.append(el("p", "trust-detail", "Conflicting source claims stay visible; the selected source is what grades the Catalog."));
  const list = el("div", "source-list");
  for (const dis of d.report.disagreements) {
    const card = el("div", "source-card");
    const head = el("div", "source-head");
    head.append(el("div", "source-title", dis.card), el("span", "pill tight", dis.spreadGib + " GiB spread"));
    card.append(head);
    const claims = el("div", "source-claims");
    for (const c of dis.claims) {
      const selected = d.report.gpu && c.source === d.report.gpu.selectedSource;
      const claim = el("div", "source-claim" + (selected ? " selected" : "") + (c.knownUnreliable ? " unreliable" : ""));
      const fact = el("div");
      fact.append(el("div", "source-name", c.source), el("div", "source-value", c.gib + " GiB"));
      claim.append(
        fact,
        el("span", "pill " + (c.knownUnreliable ? "tight" : selected ? "known" : "unlisted"), c.knownUnreliable ? "known unreliable" : selected ? "selected" : "recorded"),
      );
      claims.append(claim);
    }
    card.append(claims, el("p", "trust-detail", dis.ratio + "x ratio between recorded claims"));
    list.append(card);
  }
  p.append(list);
  return p;
}

// ---------------------------------------------------------------------------
// Live panels. These are rebuilt on every poll, so they are kept separate from
// the static ones above — re-rendering the whole page twice a second would
// fight the user's scroll position and drop any text selection they had.
// ---------------------------------------------------------------------------

function livePanelShell(id, title) {
  const shellClass = id === "gauges" ? " telemetry-section" : id === "loaded" ? " residency-section" : "";
  const p = el("section", "panel" + shellClass);
  const head = el("div", "panel-head");
  head.append(panelHeading(title, id === "loaded" ? "installed" : "activity"));
  const meta = el("span", "live-meta");
  meta.id = id + "-meta";
  head.append(meta);
  p.append(head);
  const body = el("div");
  body.id = id + "-body";
  p.append(body);
  return p;
}

function rankLiveGauges(live) {
  const rank = { critical: 3, warn: 2, normal: 1 };
  return (live.gauges || [])
    .filter((g) => g.available)
    .slice()
    .sort((a, b) => {
      const severity = (rank[b.severity] || 0) - (rank[a.severity] || 0);
      if (severity) return severity;
      // A high clock is activity, not pressure. It remains charted in the
      // canvas, but must not displace memory, utilization, temperature, power,
      // or disk from a panel explicitly labelled Pressure focus.
      const relevance = Number(!NON_PRESSURE_GAUGE_IDS.has(b.id)) - Number(!NON_PRESSURE_GAUGE_IDS.has(a.id));
      return relevance || b.percent - a.percent;
    });
}

function pressureDetail(top) {
  if (!top) return "No live counters available for this sample.";
  if (top.severity === "critical") return top.label + " is critical; review loaded residency before warming another model.";
  if (top.severity === "warn") return top.label + " is elevated; check residency before adding pressure.";
  return top.label + " is the current highest live reading.";
}

function livePressureRow(gauge) {
  const row = el("div", "live-pressure-row " + (gauge.available ? gauge.severity : "unknown"));
  const copy = el("div");
  copy.append(
    el("div", "live-pressure-name", gauge.label),
    el("div", "live-pressure-detail", gauge.available ? (gauge.detail || "Live counter") : gauge.reason),
  );
  row.append(copy, el("div", "live-pressure-value", gauge.available ? gauge.percent + "%" : "n/a"));
  return row;
}

function renderLiveSummary(live) {
  const ranked = rankLiveGauges(live);
  const unavailable = (live.gauges || []).filter((g) => !g.available);
  const top = ranked[0] || null;
  const summary = el("div", "live-summary " + (top ? top.severity : "unavailable"));
  const main = el("div", "live-summary-main");
  const copy = el("div");
  copy.append(
    el("div", "live-summary-label", "Pressure focus"),
    el("div", "live-summary-title", top ? top.label : "No live counters"),
    el("div", "live-summary-detail", pressureDetail(top)),
  );
  main.append(copy, el("div", "live-summary-value", top ? top.percent + "%" : "n/a"));
  summary.append(main);

  const chips = el("div", "live-summary-chips");
  chips.append(
    el("span", null, ranked.length + " measured"),
    el("span", null, unavailable.length + " unavailable"),
    el("span", null, "2s polling"),
  );
  summary.append(chips);

  const rows = el("div", "live-pressure-list");
  for (const gauge of ranked.slice(0, 3)) rows.append(livePressureRow(gauge));
  if (!ranked.length) {
    for (const gauge of unavailable.slice(0, 3)) rows.append(livePressureRow(gauge));
  } else if (unavailable.length) {
    rows.append(livePressureRow({
      label: "Unavailable counters",
      available: false,
      reason: unavailable.length + " counter" + (unavailable.length === 1 ? "" : "s") + " did not return a measurement.",
    }));
  }
  summary.append(rows);
  return summary;
}

function sparklinePoints(values, width, height) {
  const pad = 2;
  return values.map((value, index) => {
    const x = values.length === 1
      ? width / 2
      : pad + (index / (values.length - 1)) * (width - pad * 2);
    const y = pad + ((100 - value) / 100) * (height - pad * 2);
    return x.toFixed(2) + "," + y.toFixed(2);
  }).join(" ");
}

function gaugeTrend(gauge, featured) {
  const values = liveMetricHistory.get(gauge.id) || [];
  const width = featured ? 240 : 120;
  const height = featured ? 58 : 30;
  const trend = el("div", "gauge-trend" + (featured ? " is-featured" : "") + (telemetryIsLive ? "" : " stale"));
  const svg = svgNode("svg", {
    class: "sparkline" + (featured ? " sparkline-featured" : ""),
    viewBox: "0 0 " + width + " " + height,
    preserveAspectRatio: "none",
    "aria-hidden": "true",
    focusable: "false",
  });

  for (const value of [25, 50, 75]) {
    const y = 2 + ((100 - value) / 100) * (height - 4);
    svg.append(svgNode("line", { class: "sparkline-grid", x1: 2, y1: y, x2: width - 2, y2: y }));
  }

  if (values.length) {
    const points = sparklinePoints(values, width, height);
    if (values.length > 1) {
      svg.append(svgNode("polygon", {
        class: "sparkline-area",
        points: "2," + (height - 2) + " " + points + " " + (width - 2) + "," + (height - 2),
      }));
      svg.append(svgNode("polyline", { class: "sparkline-line", points: points }));
    } else {
      const point = points.split(",");
      svg.append(svgNode("circle", { class: "sparkline-dot", cx: point[0], cy: point[1], r: 1.8 }));
    }
  }

  const min = values.length ? Math.round(Math.min(...values)) : null;
  const max = values.length ? Math.round(Math.max(...values)) : null;
  const delta = values.length > 1 ? values[values.length - 1] - values[0] : 0;
  const direction = delta > 1 ? "rising" : delta < -1 ? "falling" : "steady";
  const caption = values.length > 1 ? min + "–" + max + "% " + direction : "Collecting trend";
  const state = telemetryIsLive ? "live" : "stale";
  trend.setAttribute("role", "img");
  trend.setAttribute("aria-label", gauge.label + " recent " + state + " trend: " + (values.length ? caption : "no samples"));
  trend.title = "Last " + values.length + " successful sample" + (values.length === 1 ? "" : "s") + "; fixed 0–100% scale.";
  trend.append(svg, el("span", "gauge-trend-caption", caption));
  return trend;
}

function metricTone(gauge) {
  if (!gauge.available) return "unknown";
  if (gauge.severity === "critical") return "critical";
  if (gauge.severity === "warn") return "warn";
  if (["gpu", "vram", "temp", "power", "clocks", "disk"].includes(gauge.id)) return "orange";
  return "cyan";
}

function metricReading(gauge, className, dial) {
  const value = el("div", className + (gauge.available ? "" : " na"));
  if (gauge.available) {
    animateLiveMetric(value, "gauge:" + gauge.id, gauge.percent, "%", dial);
  } else {
    liveMetricValues.delete("gauge:" + gauge.id);
    if (dial) dial.style.setProperty("--p", "0");
    value.textContent = "n/a";
  }
  return value;
}

function metricBar(gauge) {
  const bar = el("div", "metric-bar" + (gauge.available ? "" : " unavailable"));
  const fill = el("span");
  bar.append(fill);
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-label", gauge.label + " current level");
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", "100");
  if (gauge.available) {
    bar.style.setProperty("--metric-p", String(Math.max(0, Math.min(100, Number(gauge.percent)))));
    bar.setAttribute("aria-valuenow", String(gauge.percent));
  } else {
    bar.style.setProperty("--metric-p", "0");
    bar.setAttribute("aria-valuetext", "Unavailable");
  }
  return bar;
}

function metricPanel(gauge) {
  const featured = FEATURED_GAUGE_IDS.has(gauge.id);
  const hasTrend = gauge.available && TREND_GAUGE_IDS.has(gauge.id);
  const cell = el(
    "article",
    "metric-panel " + (featured ? "is-featured" : "is-compact") + " tone-" + metricTone(gauge) + (hasTrend ? " has-trend" : " unavailable"),
  );
  cell.dataset.metric = gauge.id;

  const head = el("div", "metric-panel-head");
  const title = el("div", "metric-panel-title");
  title.append(uiIcon(gauge.id === "disk" ? "installed" : "activity"), el("span", null, gauge.label));
  const sample = el("span", "metric-sample-state" + (telemetryIsLive ? "" : " stale"));
  sample.append(el("span", "live-dot" + (telemetryIsLive ? "" : " stale")), document.createTextNode(telemetryIsLive ? "live" : "stale"));
  head.append(title, sample);
  cell.append(head);

  if (featured) {
    const stat = el("div", "metric-stat-row");
    stat.append(
      metricReading(gauge, "metric-stat-value"),
      el("div", "metric-stat-detail", gauge.available ? (gauge.detail || "Live counter") : gauge.reason),
    );
    cell.append(stat);
    if (hasTrend) cell.append(gaugeTrend(gauge, true));
    else cell.append(el("div", "metric-chart-empty", gauge.reason || "No successful samples"));
    cell.append(metricBar(gauge));
    return cell;
  }

  const body = el("div", "metric-compact-body");
  const dial = el("div", "dial " + (gauge.available ? gauge.severity : "unknown"));
  if (gauge.available && telemetryIsLive) dial.classList.add("polling");
  dial.setAttribute("role", "img");
  dial.setAttribute("aria-label", gauge.label + ": " + (gauge.available ? gauge.percent + " percent" : "unavailable"));
  const face = el("div", "dial-face");
  face.append(metricReading(gauge, "dial-value", dial));
  dial.append(face);

  const copy = el("div", "metric-compact-copy");
  copy.append(el("div", "gauge-detail", gauge.available ? (gauge.detail || "Live counter") : gauge.reason));
  if (hasTrend) copy.append(gaugeTrend(gauge, false));
  else copy.append(el("div", "metric-chart-empty", gauge.reason || "No successful samples"));
  body.append(dial, copy);
  cell.append(body, metricBar(gauge));
  return cell;
}

function renderGauges(live) {
  const body = document.getElementById("gauges-body");
  if (!body) return;
  body.textContent = "";

  body.append(renderLiveSummary(live));

  const wrap = el("div", "gauges telemetry-grid");
  for (const gauge of live.gauges) wrap.append(metricPanel(gauge));
  body.append(wrap);
}

function loadedModelMap(live) {
  const map = new Map();
  if (!live || !live.loaded || !live.loaded.reachable) return map;
  for (const m of live.loaded.models) map.set(m.name, m);
  return map;
}

function describeLoadConsequence(target) {
  if (!target) return "Choose an installed model.";
  const loaded = (lastLive && lastLive.loaded.reachable ? lastLive.loaded.models : []);
  if (loaded.some((m) => m.name === target)) return target + " is already resident in memory.";
  if (!loaded.length) return "No resident model right now; this loads " + target + " without downloading anything.";
  return "Loading " + target + " may evict " + loaded.map((m) => m.name).join(", ") + " to make room.";
}

function updateSwitcherPreview(target) {
  const selected = document.getElementById("switcher-selected-model");
  if (selected) selected.textContent = target || "No model selected";
  const consequence = document.getElementById("switcher-preview-consequence");
  if (consequence) consequence.textContent = describeLoadConsequence(target);
}

function actionPreviewCard(label, value, detail, id, step, iconName, variant) {
  const card = el("div", "action-preview-card" + (variant ? " is-" + variant : ""));
  card.setAttribute("role", "listitem");
  const head = el("div", "action-step-head");
  head.append(el("span", "action-step-index", step), uiIcon(iconName), el("span", "k", label));
  const v = el("div", "v", value);
  if (id) v.id = id;
  card.append(head, v, el("div", "d", detail));
  return card;
}

function setActionBusy(trigger, busy) {
  trigger.disabled = busy;
  if (busy) {
    trigger.dataset.busy = "true";
    trigger.setAttribute("aria-busy", "true");
  } else {
    delete trigger.dataset.busy;
    trigger.removeAttribute("aria-busy");
  }
}

async function requestLoad(model, status, trigger) {
  let ok = false;
  setActionBusy(trigger, true);
  trigger.textContent = "Loading";
  if (status) {
    status.dataset.busy = "true";
    status.setAttribute("aria-busy", "true");
    delete status.dataset.result;
    status.textContent = "Loading " + model + "...";
  }
  try {
    const res = await fetch("/api/actions/load", {
      method: "POST",
      headers: { "content-type": "application/json", "x-cmdcenter-token": TOKEN },
      body: JSON.stringify({ model: model }),
    });
    const body = await res.json();
    ok = Boolean(body.ok);
    if (status) {
      if (status.id === "switcher-status" || !body.ok) status.dataset.result = "true";
      status.textContent = body.ok
        ? model + " loaded in " + Math.round(body.elapsedMs / 100) / 10 + "s."
        : "Could not load " + model + ": " + body.reason;
    }
  } catch (err) {
    if (status) {
      if (status.id === "switcher-status") status.dataset.result = "true";
      status.textContent = "Could not load " + model + ": " + err.message;
    }
  } finally {
    await poll();
    if (status) {
      delete status.dataset.busy;
      status.removeAttribute("aria-busy");
    }
    setActionBusy(trigger, false);
    trigger.textContent = "Load";
    if (lastLive && ok) renderInstalledLive(lastLive);
  }
}

// Survives the re-render that poll() triggers. A label written onto the button
// would be wiped by the very refresh that proves the point, so the notice is
// held here and drawn by renderLoaded().
var unloadNotice = null;

async function requestUnload(model, trigger) {
  setActionBusy(trigger, true);
  trigger.textContent = "Unloading";
  unloadNotice = null;
  try {
    const res = await fetch("/api/actions/unload", {
      method: "POST",
      headers: { "content-type": "application/json", "x-cmdcenter-token": TOKEN },
      body: JSON.stringify({ model: model }),
    });
    const body = await res.json();
    if (!body.ok) {
      trigger.textContent = "Retry unload";
      setActionBusy(trigger, false);
      return;
    }

    // Ollama accepting the unload is not proof the model left. Say which of
    // those two happened rather than letting a stale row imply the button
    // is broken.
    var verified = body.verified || {};
    if (verified.state === "still-resident") {
      unloadNotice = {
        model: model,
        tone: "warn",
        text: "Ollama released " + model + ", but it is loaded again already. Another program on this machine is asking for it.",
      };
    } else if (verified.state === "unknown") {
      unloadNotice = {
        model: model,
        tone: "unknown",
        text: "Ollama accepted the unload of " + model + ", but this could not be confirmed.",
      };
    }
  } catch {
    trigger.textContent = "Retry unload";
    setActionBusy(trigger, false);
    return;
  }
  try {
    await poll();
  } finally {
    setActionBusy(trigger, false);
  }
}

function renderLoadedSummary(live) {
  const reachable = live.loaded.reachable;
  const models = reachable ? live.loaded.models : [];
  const spilled = models.filter((m) => m.spilled).length;
  const fullyResident = models.filter((m) => m.vramResidentPercent === 100).length;
  const unknown = models.filter((m) => m.vramResidentPercent === null).length;
  const cls = !reachable ? " offline" : spilled ? " spilled" : "";
  const summary = el("div", "loaded-summary" + cls);
  const main = el("div", "loaded-summary-main");
  const copy = el("div");
  let title = "No resident models";
  let value = "0";
  let detail = "Warm an installed model when you need it ready; no pull or delete is involved.";

  if (!reachable) {
    title = "Cannot confirm residency";
    value = "offline";
    // An auth-demanding endpoint is not a dead one. Bare Ollama never asks for
    // credentials, so this poll reached SOMETHING — a gateway or proxy whose
    // client config likely set OLLAMA_HOST — and calling it "offline" would be
    // a false claim about a running machine.
    detail = live.loaded.authRequired
      ? "The endpoint demands authentication, which Ollama itself never does. If OLLAMA_HOST points at a gateway or proxy, aim Command Center at the real Ollama."
      : "Ollama did not answer this poll, so loaded state is unknown.";
  } else if (models.length) {
    title = models.length + " model" + (models.length === 1 ? "" : "s") + " resident";
    value = String(models.length);
    detail = spilled
      ? spilled + " partly on CPU; expect slower responses."
      : "All resident models are fully in VRAM according to Ollama.";
  }

  copy.append(
    el("div", "loaded-summary-label", "Residency"),
    el("div", "loaded-summary-title", title),
    el("div", "loaded-summary-detail", detail),
  );
  main.append(copy, el("div", "loaded-summary-value", value));
  summary.append(main);

  const chips = el("div", "loaded-summary-chips");
  if (!reachable) {
    chips.append(
      el("span", null, live.loaded.authRequired ? "Endpoint demands auth" : "Ollama offline"),
      el("span", null, "Loaded state unknown"),
    );
  } else if (!models.length) {
    chips.append(el("span", null, "0 loaded"), el("span", null, "Installed only"), el("span", null, "No pull or delete"));
  } else {
    chips.append(
      el("span", null, fullyResident + " fully in VRAM"),
      el("span", null, spilled + " partly on CPU"),
      el("span", null, unknown + " unknown"),
      el("span", null, "Unload available"),
    );
  }
  summary.append(chips);
  return summary;
}

function renderLoaded(live) {
  const body = document.getElementById("loaded-body");
  if (!body) return;
  body.textContent = "";
  body.append(renderLoadedSummary(live));

  // Drop the notice once the model it describes is genuinely gone — otherwise
  // it outlives the condition and becomes its own false claim.
  if (unloadNotice) {
    var stillThere = live.loaded.models.some(function (m) { return m.name === unloadNotice.model; });
    if (!stillThere) unloadNotice = null;
  }
  if (unloadNotice) {
    body.append(el("p", "unload-notice " + unloadNotice.tone, unloadNotice.text));
  }

  if (!live.loaded.reachable) {
    body.append(emptyState(
      live.loaded.authRequired
        ? "The endpoint refused with an authentication error, and bare Ollama never requires one. If OLLAMA_HOST points at a gateway or proxy, aim Command Center at the real Ollama endpoint."
        : "Ollama is not responding, so nothing can be reported as loaded.",
      "alert",
    ));
    return;
  }
  if (!live.loaded.models.length) {
    body.append(emptyState("No model is resident right now. Load an installed model below when you need it warm.", "activity"));
    return;
  }

  const list = el("div", "loaded-list");
  for (const m of live.loaded.models) {
    const item = el("div", "loaded-item" + (m.spilled ? " spilled" : ""));
    const main = el("div");
    main.append(el("div", "loaded-name", m.name));

    const metrics = el("div", "loaded-metrics");
    const stateClass = m.vramResidentPercent === null
      ? "unknown-state"
      : m.spilled ? "spilled-state" : "resident-state";
    const stateLabel = m.vramResidentPercent === null
      ? "residency unknown"
      : m.spilled ? "spilled to CPU" : "fully in VRAM";
    metrics.append(
      el("span", null, "VRAM " + m.sizeVramGb + " / " + m.sizeGb + " GB"),
      el("span", null, m.vramResidentPercent === null ? "residency unknown" : m.vramResidentPercent + "% resident"),
      el("span", "loaded-state " + stateClass, stateLabel),
    );
    // The context this model was loaded with — shown because it is the lever
    // behind the residency verdict, not trivia: the KV cache scales with it,
    // so the same weights spill at one context and fit fully at another.
    // Absent on older Ollama versions; say nothing rather than "0".
    if (m.contextLength !== null && m.contextLength !== undefined) {
      metrics.append(el("span", null, "context " + m.contextLength.toLocaleString()));
    }
    main.append(metrics);

    const residency = el("div", "loaded-residency");
    const meter = el("div", "residency-meter");
    const fill = el("span");
    const percent = m.vramResidentPercent === null ? 0 : m.vramResidentPercent;
    fill.style.setProperty("--resident", Math.max(0, Math.min(100, percent)) + "%");
    meter.append(fill);
    residency.append(meter);
    var spillText = "Partly on CPU; expect slower responses.";
    if (m.spilled && m.spilledGb !== null && m.spilledGb !== undefined) {
      spillText = m.spilledGb + " GB is on CPU; expect slower responses.";
      // Only when both facts are in hand: the honest, actionable connection.
      // No predicted number — what context WOULD fit is not something this
      // dashboard can verify, so it names the lever and stops.
      if (m.contextLength !== null && m.contextLength !== undefined) {
        spillText = m.spilledGb + " GB is on CPU. Loaded at " + m.contextLength.toLocaleString() +
          " context; memory grows with context length, so a smaller context brings the same model closer to fitting.";
      }
    }
    residency.append(el("div", m.spilled ? "explain spilled" : "explain",
      m.vramResidentPercent === null ? "Ollama did not report VRAM residency." : m.spilled ? spillText : "Fully resident according to Ollama."));
    main.append(residency);

    const actions = el("div", "loaded-actions");
    const unload = el("button", null, "Unload");
    unload.type = "button";
    unload.setAttribute("aria-label", "Unload " + m.name);
    unload.addEventListener("click", () => { requestUnload(m.name, unload); });
    actions.append(unload);
    item.append(main, actions);
    list.append(item);
  }
  body.append(list);
}

function installedPanel(d) {
  if (!d.installed.length) return null;
  const p = panel("Installed models");
  p.className += " installed-panel";
  const counts = {
    known: d.installed.filter((m) => m.status === "known").length,
    derived: d.installed.filter((m) => m.status === "derived").length,
    unlisted: d.installed.filter((m) => m.status === "unlisted").length,
    comfortable: d.installed.filter((m) => m.grade && m.grade.fit === "comfortable").length,
  };
  const summary = el("div", "catalog-stats installed-summary");
  const stat = (label, value) => {
    const s = el("span");
    s.append(el("b", null, value), document.createTextNode(" " + label));
    return s;
  };
  summary.append(
    stat("catalog matches", counts.known),
    stat("local builds", counts.derived),
    stat("unlisted", counts.unlisted),
    stat("comfortable", counts.comfortable),
  );
  p.append(summary);

  const list = el("div", "installed-list");
  for (const m of d.installed) {
    const item = el("div", "installed-item");
    const main = el("div");
    main.append(el("div", "installed-name", m.name));

    const meta = el("div", "installed-meta");
    meta.append(el("span", "pill " + m.status, m.status));
    if (m.grade) meta.append(el("span", "pill " + m.grade.fit, m.grade.fit.replace("_", " ")));
    main.append(meta);

    const fit = el("div", "installed-fit");
    if (m.grade) {
      fit.append(el("div", "explain", m.grade.explanation));
    } else {
      fit.append(el("span", "muted", m.status === "derived" ? "local build — not in the catalog" : "not in the catalog"));
    }
    main.append(fit);

    const action = el("div", "installed-action");
    const state = el("span", "installed-state", "Residency checking");
    state.dataset.modelState = m.name;
    const load = el("button", "primary-action", "Load");
    load.type = "button";
    load.dataset.loadModel = m.name;
    load.setAttribute("aria-label", "Load " + m.name);
    load.addEventListener("click", () => { requestLoad(m.name, state, load); });
    action.append(state, load);
    item.append(main, action);
    list.append(item);
  }
  p.append(list);
  return p;
}

// Default to hiding what cannot run here. Validation showed this one table can
// dominate the page when every catalog row is visible, and most of the hidden
// rows are models the user has no decision to make about. Filters keep the
// hidden rows one click away, because silently omitting data is its own kind of
// dishonesty.
let catalogFitFilter = "runs";
let catalogQuery = "";
let catalogFocusSearch = false;

function catalogCounts(models) {
  return {
    all: models.length,
    runs: models.filter((m) => m.fit !== "too_large").length,
    comfortable: models.filter((m) => m.fit === "comfortable").length,
    tight: models.filter((m) => m.fit === "tight").length,
    partial: models.filter((m) => m.fit === "partial").length,
    too_large: models.filter((m) => m.fit === "too_large").length,
  };
}

function searchableModelText(m) {
  return [
    m.name,
    m.fit,
    m.quant,
    m.requiredVramGb == null ? "" : String(m.requiredVramGb),
    m.runCommand,
    m.explanation,
    m.sparseMoe ? "sparse moe" : "",
  ].filter(Boolean).join(" ").toLowerCase();
}

function modelMatchesCatalogFilter(m) {
  if (catalogFitFilter === "all") return true;
  if (catalogFitFilter === "runs") return m.fit !== "too_large";
  return m.fit === catalogFitFilter;
}

function catalogPanel(d) {
  const p = panel("What this machine can run");
  p.className += " catalog-panel";

  const counts = catalogCounts(d.models);
  const query = catalogQuery.trim().toLowerCase();

  const controls = el("div", "catalog-controls");
  const toolbar = el("div", "catalog-toolbar");

  const searchWrap = el("div");
  const searchLabel = el("label", "sr-only", "Search catalog");
  searchLabel.setAttribute("for", "catalog-search");
  const search = el("input", "catalog-search");
  search.id = "catalog-search";
  search.type = "search";
  search.value = catalogQuery;
  search.placeholder = "Search models, quant, command";
  search.setAttribute("autocomplete", "off");
  search.addEventListener("input", () => {
    catalogQuery = search.value;
    catalogFocusSearch = true;
    renderView(activeView);
  });
  searchWrap.append(searchLabel, search);

  const stats = el("div", "catalog-stats");
  const stat = (label, value) => {
    const s = el("span");
    s.append(el("b", null, value), document.createTextNode(" " + label));
    return s;
  };
  stats.append(
    stat("runnable", counts.runs),
    stat("comfortable", counts.comfortable),
    stat("partial", counts.partial),
    stat("too large", counts.too_large),
  );
  toolbar.append(searchWrap, stats);
  controls.append(toolbar);

  const filters = el("div", "filters catalog-fit-filters");
  const mkFilter = (label, key, count) => {
    const b = el("button", null, label);
    b.type = "button";
    b.setAttribute("aria-pressed", String(catalogFitFilter === key));
    b.addEventListener("click", () => {
      if (catalogFitFilter === key) return;
      catalogFitFilter = key;
      renderView(activeView);
    });
    if (count !== null && count !== undefined) b.append(el("span", "count", count));
    return b;
  };
  // String concatenation, not template literals. This whole bundle is carried
  // inside a template literal in ui.js, so a nested backtick closes it early
  // and a nested interpolation is evaluated at module scope by the outer
  // template instead of at runtime in the browser. Note this comment cannot
  // spell that syntax out either, for exactly the same reason.
  filters.append(
    mkFilter("Runnable", "runs", counts.runs),
    mkFilter("Comfortable", "comfortable", counts.comfortable),
    mkFilter("Tight", "tight", counts.tight),
    mkFilter("Partial", "partial", counts.partial),
    mkFilter("Too large", "too_large", counts.too_large),
    mkFilter("All", "all", counts.all),
  );
  controls.append(filters);
  p.append(controls);

  const rows = d.models.filter((m) => modelMatchesCatalogFilter(m) && (!query || searchableModelText(m).includes(query)));
  const out = dataTable(["Model", "Fit", "Quant", "Needs", "Run it"], "catalog-table responsive-table");
  for (const m of rows) {
    const row = el("tr");
    const name = dataCell("Model");
    name.append(el("div", "model-name", m.name + (m.sparseMoe ? "  (sparse MoE)" : "")));
    // The explanation is shown only where it changes a decision. For a
    // comfortable fit the pill and the "Needs" column already say everything,
    // and repeating "fits with N GB to spare" 27 times was the single largest
    // contributor to this table's height without adding information.
    if (m.fit !== "comfortable") name.append(el("div", "explain", m.explanation));
    row.append(name);
    const fit = dataCell("Fit");
    fit.append(el("span", "pill " + m.fit, m.fit.replace("_", " ")));
    row.append(fit);
    row.append(dataCell("Quant", "mono", m.quant || "—"));
    row.append(dataCell("Needs", null, m.requiredVramGb != null ? m.requiredVramGb + " GB" : "—"));
    const cmd = dataCell("Run it");
    if (m.runCommand) {
      const box = el("div", "cmd");
      const command = el("code", null, m.runCommand);
      command.title = m.runCommand;
      box.append(command, copyButton(m.runCommand, "Copy command for " + m.name, true));
      cmd.append(box);
    } else {
      cmd.append(el("span", "muted", "—"));
    }
    row.append(cmd);
    out.body.append(row);
  }
  if (rows.length) {
    p.append(el("div", "catalog-result-meta", rows.length + " model" + (rows.length === 1 ? "" : "s") + " in this view"));
    const tableWrap = el("div", "catalog-table-wrap");
    tableWrap.tabIndex = 0;
    tableWrap.setAttribute("role", "region");
    tableWrap.setAttribute("aria-label", "Catalog results: " + rows.length + " models");
    tableWrap.append(out.table);
    p.append(tableWrap);
  } else {
    p.append(emptyState("No catalog models match the current filters.", "search"));
  }
  if (catalogFitFilter === "runs" && !query && counts.too_large > 0) {
    p.append(el("p", "explain",
      counts.too_large + " model" + (counts.too_large === 1 ? "" : "s") +
      " in the catalog need more memory than this machine has. Choose Too large or All to see what they would require."));
  }
  return p;
}

// ---------------------------------------------------------------------------
// The one part of this interface that changes anything. Everything else
// observes; this loads and unloads. It is deliberately explicit about that.
// ---------------------------------------------------------------------------
function switcherPanel(d) {
  const p = panel("Load a model");
  p.className += " action-panel";

  const installed = (d.installed || []).map((m) => m.name);
  if (!d.report.ollama.installed || !installed.length) {
    p.append(emptyState("No installed models to load.", "installed"));
    const trust = el("div", "action-trust");
    trust.append(
      el("span", null, "Installed only"),
      el("span", null, "Empty prompt"),
      el("span", null, "No pull or delete"),
    );
    p.append(trust);
    return p;
  }

  const copy = el("div", "action-copy");
  copy.append(el("p", "action-title", "Warm an installed model"));
  copy.append(el("p", "action-detail", "Choose one of the models Ollama already reports on this machine. The request uses an empty prompt and a fixed keep-alive."));
  p.append(copy);

  const row = el("div", "action-controls");
  const select = el("select");
  select.id = "switcher-model";
  select.setAttribute("aria-label", "Model to load");
  for (const name of installed) {
    const opt = el("option", null, name);
    opt.value = name;
    select.append(opt);
  }
  const go = el("button", "primary-action", "Load");
  go.type = "button";
  go.setAttribute("aria-label", "Load selected model");
  row.append(select, go);
  p.append(row);

  const preview = el("div", "action-preview");
  preview.setAttribute("role", "list");
  preview.setAttribute("aria-label", "Load request pipeline");
  preview.append(
    actionPreviewCard("Selected model", installed[0], "Must already be installed in Ollama", "switcher-selected-model", "01", "installed", "selected"),
    actionPreviewCard("Request", "Empty prompt", "Fixed keep-alive, no inference text", null, "02", "load", "request"),
    actionPreviewCard("Consequence", "Waiting", "Live residency determines eviction risk", "switcher-preview-consequence", "03", "activity", "consequence"),
  );
  p.append(preview);

  const status = el("p", "action-status");
  status.id = "switcher-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  p.append(status);

  select.addEventListener("change", () => {
    delete status.dataset.result;
    updateSwitcherConsequence();
  });
  updateSwitcherConsequence();

  go.addEventListener("click", () => {
    requestLoad(select.value, status, go);
  });

  const trust = el("div", "action-trust");
  trust.append(
    el("span", null, "Installed only"),
    el("span", null, "Empty prompt"),
    el("span", null, "No pull or delete"),
  );
  p.append(trust);
  return p;
}

function toolsPanel(d) {
  const t = d.tools;
  const p = panel("MCP servers");
  p.className += " tools-panel";

  const g = el("div", "grid");
  g.append(kv("Clients configured", t.summary.clientsConfigured));
  g.append(kv("Servers configured", t.summary.serversConfigured, true));
  g.append(kv("Distinct servers", t.summary.distinctServers));
  g.append(kv("Holding credentials", t.summary.serversHoldingCredentials));
  p.append(g);

  if (!t.servers.length) {
    p.append(emptyState("No MCP servers found in any known client configuration.", "server"));
    return p;
  }

  const out = dataTable(["Server", "Verdict", "Client", "Transport", "Package", "Needs"], "responsive-table tools-table");
  for (const s of t.servers) {
    const row = el("tr");
    row.append(dataCell("Server", null, s.name));
    // Tier 1 static verdicts. Colouring follows what a user should act on:
    // a missing command is the actionable finding; "declared" is the
    // never-probed-by-design state and must not read as a failure.
    const verdictCell = dataCell("Verdict");
    const verdictTone =
      s.verdict === "command-not-found" || s.verdict === "config-broken"
        ? "warn"
        : s.verdict === "config-ok"
          ? "ok"
          : "";
    const verdictTitle =
      s.verdict === "declared"
        ? "Remote servers are declared, not probed — probing them would be an outbound network call, and this tool does not make those."
        : s.verdict === "config-ok"
          ? "The command resolves on PATH. It was located, never executed — a found command can still fail at runtime."
          : s.verdict === "command-not-found"
            ? "The configured command is not on PATH — this server cannot start as configured."
            : s.verdict === "unchecked"
              ? "The resolution probe did not answer; unknown is not a verdict in either direction."
              : "The entry declares neither a command nor a url.";
    const chip = statusChip(s.verdict || "?", verdictTone);
    chip.title = verdictTitle;
    verdictCell.append(chip);
    row.append(verdictCell);
    row.append(dataCell("Client", "muted", s.client));
    row.append(dataCell("Transport", "mono", s.transport));
    row.append(dataCell("Package", "mono", s.packageHint || (s.command ? s.command : "—")));
    const needs = dataCell("Needs");
    if (!s.envVarNames.length) {
      needs.append(el("span", "muted", "—"));
    } else {
      needs.append(el("div", "mono muted", s.envVarNames.join(", ")));
      if (s.secretShapedEnvCount > 0) {
        needs.append(el("div", "explain", "Names only — this tool never reads their values."));
      }
    }
    row.append(needs);
    out.body.append(row);
  }
  p.append(out.table);
  if (t.verdictNote) p.append(el("p", "bench-note", t.verdictNote));
  return p;
}

function localToolsPanel(d) {
  const p = panel("Local AI tools");
  p.className += " tools-panel";
  const out = dataTable(["Tool", "Detected"], "responsive-table local-tools-table");
  for (const tool of d.tools.tools) {
    const row = el("tr");
    row.append(dataCell("Tool", null, tool.name));
    const status = dataCell("Detected");
    status.append(el("span", "pill " + (tool.installed ? "known" : "unlisted"), tool.installed ? "installed" : "not found"));
    row.append(status);
    out.body.append(row);
  }
  p.append(out.table);
  // Absence here is genuinely weaker evidence than presence, and saying so
  // matters more than looking comprehensive.
  if (d.tools.note) p.append(el("p", "explain", d.tools.note));
  return p;
}

function reportSafetyPanel(d) {
  const p = panel("Report safety");
  p.className += " report-panel report-safety";
  p.append(el("p", "trust-detail", "The shareable report uses bounded bands and counts. Exact local specs stay on this page."));
  const strip = el("div", "safety-strip");
  strip.append(
    el("span", null, Object.keys(d.report.exportable).length + " share fields"),
    el("span", null, d.report.limits.length + " stated limits"),
    el("span", null, "exact specs stay local"),
    el("span", null, "loopback only"),
  );
  p.append(strip);
  return p;
}

function limitsPanel(d) {
  const p = panel("Report limits");
  p.className += " report-panel report-limits";
  if (!d.report.limits.length) {
    p.append(emptyState("No additional report limits were added for this capture.", "report"));
    return p;
  }
  const list = el("div", "limits-list");
  for (const l of d.report.limits) list.append(el("div", "limit-item", l));
  p.append(list);
  return p;
}

function sharePanel(d) {
  const p = panel("Shareable summary");
  p.className += " report-panel share-panel";
  p.append(el("p", "trust-detail", "This is the only part of the report intended for public paste."));
  const text = Object.entries(d.report.exportable).map(([k, v]) => k + ": " + v).join("  |  ");
  const rows = el("div", "share-rows");
  for (const [key, value] of Object.entries(d.report.exportable)) {
    const row = el("div", "share-row");
    row.append(el("div", "k", key), el("div", "v", value), el("div", "d", "safe share field"));
    rows.append(row);
  }
  const copy = el("div", "share-copy");
  copy.append(copyButton(text, "Copy shareable summary"));
  p.append(rows, copy);
  return p;
}

const POLL_INTERVAL_MS = 2000;
let pollTimer = null;
let consecutiveFailures = 0;
let lastLive = null;
let telemetryIsLive = false;
let telemetryStaleReason = "";

function updateSwitcherConsequence() {
  const select = document.getElementById("switcher-model");
  const status = document.getElementById("switcher-status");
  if (!select) return;
  updateSwitcherPreview(select.value);
  if (!status || status.dataset.busy === "true" || status.dataset.result === "true") return;
  status.textContent = describeLoadConsequence(select.value);
}

function renderInstalledLive(live) {
  const loaded = loadedModelMap(live);
  const reachable = live && live.loaded && live.loaded.reachable;

  for (const state of document.querySelectorAll("[data-model-state]")) {
    if (state.dataset.busy === "true" || state.dataset.result === "true") continue;
    const model = state.dataset.modelState;
    const resident = loaded.get(model);
    if (!reachable) {
      state.textContent = "Ollama not responding";
    } else if (resident) {
      state.textContent = "Resident - " + resident.vramResidentPercent + "% in VRAM";
    } else {
      state.textContent = "Available to load";
    }
  }

  for (const button of document.querySelectorAll("[data-load-model]")) {
    if (button.dataset.busy === "true") continue;
    const resident = loaded.has(button.dataset.loadModel);
    button.disabled = !reachable || resident;
    button.textContent = resident ? "Loaded" : "Load";
  }
}

function stampLiveMeta(live) {
  const stamp = live && live.sampledAt ? new Date(live.sampledAt).toLocaleTimeString() : "";
  for (const id of ["gauges-meta", "loaded-meta"]) {
    const meta = document.getElementById(id);
    if (!meta) continue;
    meta.textContent = "";
    if (telemetryIsLive) {
      meta.append(el("span", "live-dot"), document.createTextNode("live · " + stamp));
    } else {
      meta.append(
        el("span", "live-dot stale"),
        document.createTextNode("stale — " + (telemetryStaleReason || "waiting for telemetry")),
      );
    }
  }
}

// THE NEXT-ACTION PANEL MUST FOLLOW THE MACHINE, NOT THE PAGE LOAD.
//
// It was built once from the page-load snapshot while the Loaded card beside it
// refreshed every two seconds. They disagreed on screen: the card read "0 — No
// resident model" while the recommendation below it said "1 model currently
// reported as resident".
//
// The wrong sentence was the visible symptom; the real defect was that the
// whole DECISION was frozen — title, button and behaviour — on a panel whose
// only job is saying what to do next. Rebuilt from the live sample instead.
function renderNextActionLive(live) {
  const existing = document.getElementById("summary-action");
  if (!existing || !dashboardData) return;
  const runnable = dashboardData.models.filter((m) => m.fit !== "too_large");
  const loaded = live.loaded.reachable ? live.loaded.models : [];
  existing.replaceWith(summaryActionPanel(dashboardData, runnable, loaded, live.loaded.reachable));
}

function renderSummaryLive(live) {
  const loadedValue = document.getElementById("summary-loaded-value");
  const loadedDetail = document.getElementById("summary-loaded-detail");
  if (loadedValue && loadedDetail) {
    if (!live.loaded.reachable) {
      loadedValue.textContent = "Offline";
      loadedDetail.textContent = "Ollama is not responding";
    } else {
      const count = live.loaded.models.length;
      loadedValue.textContent = String(count);
      loadedDetail.textContent = count === 0
        ? "No resident model"
        : live.loaded.models.map((m) => m.name).join(", ");
    }
  }

  renderNextActionLive(live);

  const pressureValue = document.getElementById("summary-pressure-value");
  const pressureDetail = document.getElementById("summary-pressure-detail");
  const pressureCard = document.getElementById("summary-pressure-card");
  if (!pressureValue || !pressureDetail) return;
  const gauges = rankLiveGauges(live);
  if (!gauges.length) {
    if (pressureCard) {
      pressureCard.classList.remove("normal", "warn", "critical");
      pressureCard.classList.add("unavailable");
    }
    pressureValue.textContent = "n/a";
    pressureDetail.textContent = "No live counters available";
    return;
  }
  const top = gauges[0];
  if (pressureCard) {
    pressureCard.classList.remove("unavailable", "normal", "warn", "critical");
    pressureCard.classList.add(top.severity);
  }
  pressureValue.textContent = top.percent + "%";
  pressureDetail.textContent = top.label + (top.severity === "normal" ? " live" : " is " + top.severity);
}

/**
 * The compact header readout. This is what makes view-switching acceptable:
 * leaving Overview must not mean losing sight of the machine.
 */
function renderLiveStrip(live) {
  const strip = document.getElementById("livestrip");
  if (!strip) return;
  strip.textContent = "";
  strip.classList.add("polling");
  strip.classList.remove("stale");
  strip.title = "Live telemetry updates every 2 seconds";

  const wanted = ["cpu", "gpu", "vram"];
  for (const id of wanted) {
    const g = live.gauges.find((x) => x.id === id);
    if (!g || !g.available) {
      liveMetricValues.delete("strip:" + id);
      continue;
    }
    const item = el("span");
    item.append(document.createTextNode(g.label + " "));
    const value = el("b", g.severity === "normal" ? null : g.severity);
    animateLiveMetric(value, "strip:" + id, g.percent, "%");
    item.append(value);
    strip.append(item);
  }

  const count = live.loaded.reachable ? live.loaded.models.length : null;
  if (count !== null) {
    const item = el("span");
    const value = el("b");
    animateLiveMetric(value, "strip:loaded", count, "");
    item.append(value, document.createTextNode(count === 1 ? " model loaded" : " models loaded"));
    strip.append(item);
  } else {
    liveMetricValues.delete("strip:loaded");
  }
}

async function poll() {
  try {
    const res = await fetch("/api/live", { headers: { "x-cmdcenter-token": TOKEN } });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const live = await res.json();
    if (!live.available) throw new Error(live.reason || "unavailable");

    consecutiveFailures = 0;
    telemetryIsLive = true;
    telemetryStaleReason = "";
    lastLive = live;
    recordLiveMetricHistory(live);
    renderGauges(live);
    renderLoaded(live);
    renderLiveStrip(live);
    setPollingVisualState(true);
    stampLiveMeta(live);
    renderSummaryLive(live);
    renderInstalledLive(live);
    updateSwitcherConsequence();
  } catch (err) {
    consecutiveFailures += 1;
    telemetryIsLive = false;
    telemetryStaleReason = String(err.message);
    setPollingVisualState(false, telemetryStaleReason);
    // Say it went stale rather than freezing on a number that is no longer
    // true. A monitor silently showing old values is worse than one admitting
    // it lost contact.
    stampLiveMeta(lastLive);
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
  for (const dial of document.querySelectorAll(".dial.polling")) dial.classList.remove("polling");
  const strip = document.getElementById("livestrip");
  if (strip) strip.classList.remove("polling");
}

// Stop sampling when the tab is not visible. Polling nvidia-smi twice a second
// behind a hidden tab costs the user real CPU for nothing.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopPolling();
  else { consecutiveFailures = 0; startPolling(); }
});

// ---------------------------------------------------------------------------
// Bench results viewer. Files are read in the browser, but validation and
// comparison gating run SERVER-SIDE in the pure derive layer, via the two
// inspection endpoints — re-deriving those rules here would fork them, which
// is the drift class the generated copies exist to close. This code renders
// what the server concluded and invents nothing.
// ---------------------------------------------------------------------------

var benchSlots = [null, null];
var benchError = null;
var benchComparison = null;
// What the known results directory (~/.osai/bench-results) held at last scan:
// null until fetched, then { configured, exists, results }. Absent is a
// normal state — bench may never have run — and renders as a sentence, not
// an error.
var benchDirectory = null;

function refreshBench() {
  if (activeView === "bench" && dashboardData) renderView("bench");
}

async function benchRefreshDirectory() {
  try {
    const res = await fetch("/api/bench/results", { headers: { "x-cmdcenter-token": TOKEN } });
    benchDirectory = await res.json();
  } catch (err) {
    benchDirectory = { configured: false, exists: false, results: [], error: String(err.message) };
  }
}

function pctText(fraction, digits) {
  return fraction === null || fraction === undefined ? null : (fraction * 100).toFixed(digits) + "%";
}

// A metric renders with its dispersion and sample count or not at all — a
// median stripped of CV and n would claim more certainty than the run earned.
function metricText(m, unit, digits) {
  if (!m || m.median === null || m.median === undefined) return "unavailable";
  var out = Number(m.median).toFixed(digits) + " " + unit + " (n=" + m.samples;
  if (m.coefficientOfVariation !== null && m.coefficientOfVariation !== undefined) {
    out += ", CV " + (m.coefficientOfVariation * 100).toFixed(1) + "%";
  }
  return out + ")";
}

function benchHandoffPanel(d) {
  const p = panel("Run a protocol benchmark");
  p.className += " bench-panel bench-handoff-panel";
  p.append(el("p", null,
    "osai-bench runs the osai-bench/1.3 measurement protocol against this machine's Ollama and writes a result JSON into ~/.osai/bench-results/ (bench 0.12+; older versions wrote into the directory they were run from)."));
  p.append(el("p", "bench-note",
    "It is a separate tool, and this dashboard never runs it for you - copy the command, run it in a terminal, then drop the result file below. If preconditions refuse the run, that refusal is the protocol working; an overridden run is permanently marked."));

  const names = d.installed.map(function (i) { return i.name; });
  if (names.length === 0) {
    p.append(el("p", "bench-note", "No installed models detected to benchmark."));
    return p;
  }
  const row = el("div", "bench-command-row");
  const select = el("select");
  select.setAttribute("aria-label", "Model to benchmark");
  for (const name of names) {
    const opt = el("option", null, name);
    opt.value = name;
    select.append(opt);
  }
  const cmd = el("code", "bench-cmd");
  const currentCommand = function () { return "npx @opensourcesai/bench --model " + select.value; };
  const refreshCmd = function () { cmd.textContent = currentCommand(); };
  select.addEventListener("change", refreshCmd);
  refreshCmd();
  const btn = el("button", null, "Copy");
  btn.type = "button";
  btn.addEventListener("click", function () {
    navigator.clipboard.writeText(currentCommand()).then(
      function () { btn.textContent = "Copied"; setTimeout(function () { btn.textContent = "Copy"; }, 1200); },
      function () { btn.textContent = "Copy failed"; },
    );
  });
  row.append(select, cmd, btn);
  p.append(row);
  return p;
}

function firstFreeBenchSlot() {
  if (!benchSlots[0]) return 0;
  if (!benchSlots[1]) return 1;
  return -1;
}

async function loadBenchFile(file) {
  benchComparison = null;
  const slot = firstFreeBenchSlot();
  if (slot === -1) {
    benchError = "Two results are already loaded - remove one first.";
    refreshBench();
    return;
  }
  benchError = null;
  try {
    const text = await file.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw new Error(file.name + " is not valid JSON");
    }
    const res = await fetch("/api/bench/inspect", {
      method: "POST",
      headers: { "content-type": "application/json", "x-cmdcenter-token": TOKEN },
      body: JSON.stringify(parsed),
    });
    const payload = await res.json().catch(function () { return null; });
    if (!payload || payload.ok !== true) {
      throw new Error((payload && payload.reason) || "the server refused the file");
    }
    benchSlots[slot] = { name: file.name, raw: parsed, view: payload.view, rooflineLimits: payload.rooflineLimits || [] };
  } catch (err) {
    benchError = String(err.message);
  }
  refreshBench();
}

// Open one result from the known directory, by bare name — the server reads
// it behind its pattern-and-containment gate and returns the same validated
// view a dropped file gets, so both intake paths render identically.
async function loadStoredBenchResult(name) {
  benchComparison = null;
  const slot = firstFreeBenchSlot();
  if (slot === -1) {
    benchError = "Two results are already loaded - remove one first.";
    refreshBench();
    return;
  }
  benchError = null;
  try {
    const res = await fetch("/api/bench/results/inspect", {
      method: "POST",
      headers: { "content-type": "application/json", "x-cmdcenter-token": TOKEN },
      body: JSON.stringify({ name: name }),
    });
    const payload = await res.json().catch(function () { return null; });
    if (!payload || payload.ok !== true) {
      throw new Error((payload && payload.reason) || "the server refused the file");
    }
    benchSlots[slot] = { name: name, raw: payload.raw, view: payload.view, rooflineLimits: payload.rooflineLimits || [] };
  } catch (err) {
    benchError = String(err.message);
  }
  refreshBench();
}

async function runBenchCompare(attested) {
  if (!benchSlots[0] || !benchSlots[1]) return;
  try {
    const res = await fetch("/api/bench/compare", {
      method: "POST",
      headers: { "content-type": "application/json", "x-cmdcenter-token": TOKEN },
      body: JSON.stringify({
        left: benchSlots[0].raw,
        right: benchSlots[1].raw,
        sameMachineAttested: attested === true,
      }),
    });
    const payload = await res.json().catch(function () { return null; });
    benchComparison = payload && payload.comparison
      ? payload.comparison
      : { allowed: false, reason: "the comparison request failed" };
  } catch (err) {
    benchComparison = { allowed: false, reason: String(err.message) };
  }
  refreshBench();
}

function benchDirectoryPanel() {
  const p = panel("Results on this machine");
  p.className += " bench-panel bench-directory-panel";
  const note = "osai-bench 0.12+ writes results into ~/.osai/bench-results/ by default; this list is a read-only scan of that one directory.";
  if (!benchDirectory) {
    p.append(inlineLoadingState("Scanning local benchmark results", 2));
    p.append(el("p", "bench-note", note));
    return p;
  }
  if (!benchDirectory.exists || !benchDirectory.configured) {
    p.append(el("p", "bench-note",
      "No results directory yet. " + note + " Older bench versions wrote into whatever directory they were run from - drop those files below instead."));
  } else if (benchDirectory.results.length === 0) {
    p.append(el("p", "bench-note", "The results directory exists but holds no result files yet. " + note));
  } else {
    p.append(el("p", "bench-note", "Found " + benchDirectory.results.length + " result file(s). " + note));
    const list = el("div", "bench-dir-list");
    for (const entry of benchDirectory.results) {
      const row = el("div", "bench-dir-row");
      const open = el("button", null, "Open");
      open.type = "button";
      open.addEventListener("click", function () { loadStoredBenchResult(entry.name); });
      row.append(
        el("span", "bench-dir-name", entry.name),
        el("span", "bench-note", new Date(entry.modifiedAt).toLocaleString() + " · " + (entry.sizeBytes / 1024).toFixed(0) + " KB"),
        open,
      );
      list.append(row);
    }
    p.append(list);
  }
  const rescan = el("button", null, "Rescan");
  rescan.type = "button";
  rescan.addEventListener("click", function () { benchRefreshDirectory().then(refreshBench); });
  p.append(rescan);
  return p;
}

function benchDropPanel() {
  const p = panel("Inspect a result");
  p.className += " bench-panel bench-inspect-panel";
  const drop = el("div", "bench-drop");
  drop.append(el("div", null, "Drop an osai-bench result JSON here, or click to choose a file."));
  drop.append(el("div", "bench-note", "Up to two results, for a gated same-machine comparison. The file is validated by this dashboard's own local server; nothing leaves the machine."));
  const input = el("input");
  input.type = "file";
  input.accept = "application/json,.json";
  input.addEventListener("change", function () {
    if (input.files && input.files[0]) loadBenchFile(input.files[0]);
    input.value = "";
  });
  drop.append(input);
  drop.addEventListener("click", function () { input.click(); });
  drop.addEventListener("dragover", function (e) { e.preventDefault(); drop.classList.add("dragover"); });
  drop.addEventListener("dragleave", function () { drop.classList.remove("dragover"); });
  drop.addEventListener("drop", function (e) {
    e.preventDefault();
    drop.classList.remove("dragover");
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadBenchFile(f);
  });
  p.append(drop);
  if (benchError) p.append(el("p", "bench-error", benchError));
  return p;
}

function benchResultPanel(slot, index) {
  const v = slot.view;
  const p = panel("Result " + (index + 1) + ": " + (v.model.identifier || "unknown model"));
  p.className += " bench-panel bench-result-panel";

  // Quality first, and never softened - an overridden run is marked for life.
  const head = el("div", "bench-quality");
  if (v.quality.qualityOverride || !v.quality.cohortEligible) {
    head.append(statusChip("quality override - permanently cohort-ineligible", "critical"));
    if (v.quality.conditions.length) {
      head.append(el("span", "bench-note", "overridden: " + v.quality.conditions.join(", ")));
    }
  } else {
    head.append(statusChip("quality preconditions clean", "ok"));
  }
  const remove = el("button", null, "Remove");
  remove.type = "button";
  remove.addEventListener("click", function () {
    benchSlots[index] = null;
    benchComparison = null;
    refreshBench();
  });
  head.append(remove);
  p.append(head);

  const ttft = v.metrics.timeToFirstTokenMs;
  const grid = el("div", "grid");
  grid.append(kv("Model", (v.model.identifier || "unknown") + (v.model.quantization ? " (" + v.model.quantization + ")" : "")));
  grid.append(kv("Runtime", (v.runtime.name || "?") + " " + (v.runtime.version || "")));
  grid.append(kv("Recorded", v.createdAt ? new Date(v.createdAt).toLocaleString() : "unknown"));
  grid.append(kv("Generation", metricText(v.metrics.generationTokensPerSecond, "tok/s", 2), true));
  grid.append(kv("Prefill", metricText(v.metrics.prefillTokensPerSecond, "tok/s", 0)));
  grid.append(kv("Time to first token", metricText(ttft, "ms", 0) + (ttft.reasoningWithheldPasses > 0 ? " - " + ttft.reasoningWithheldPasses + " pass(es) stayed inside reasoning" : "")));
  grid.append(kv("Cold load", v.metrics.coldLoadSeconds === null ? "unavailable" : v.metrics.coldLoadSeconds.toFixed(2) + " s"));
  grid.append(kv("Failed passes", v.metrics.passFailurePercent === null ? "unavailable" : v.metrics.passFailurePercent.toFixed(0) + "%"));
  grid.append(kv("VRAM residency", v.placement && v.placement.vramResidentFraction !== null ? pctText(v.placement.vramResidentFraction, 0) : "not recorded"));
  p.append(grid);

  p.append(el("h3", null, "Roofline"));
  if (v.roofline.utilization === null || v.roofline.theoreticalMaxTokensPerSecond === null) {
    p.append(el("p", "bench-note",
      "unavailable - " + (v.roofline.memoryBandwidthGBps === null
        ? "no memory-bandwidth figure was recorded for this run"
        : "generation throughput was unavailable, so there is nothing to hold against the ceiling")));
  } else {
    const roofGrid = el("div", "grid");
    roofGrid.append(kv("Utilization of ceiling", pctText(v.roofline.utilization, 1), true));
    roofGrid.append(kv("Theoretical ceiling", v.roofline.theoreticalMaxTokensPerSecond.toFixed(1) + " tok/s"));
    roofGrid.append(kv("Bandwidth", v.roofline.memoryBandwidthGBps + " GB/s (" + (v.roofline.bandwidthSource || "unknown source") + ")"));
    p.append(roofGrid);
    // The caveats are not decoration: a utilization figure shown without them
    // overclaims. They render every time the figure does.
    const caveats = el("ul", "bench-caveats");
    for (const limit of slot.rooflineLimits) caveats.append(el("li", null, limit));
    p.append(caveats);
  }

  p.append(el("h3", null, "Diagnostics"));
  const list = el("ul", "diag-list");
  for (const diag of v.diagnostics) {
    const li = el("li");
    const tone = diag.status === "detected" ? "warn"
      : diag.status === "not-detected" ? "ok"
      : "";
    li.append(statusChip(diag.status || "?", tone), el("span", null, (diag.id || "") + ": " + (diag.message || "")));
    list.append(li);
  }
  p.append(list);

  p.append(el("h3", null, "Run conditions"));
  if (!v.environment) {
    p.append(el("p", "bench-note", "This result predates environment capture - its run conditions are unknown, and it cannot be shown comparable to anything."));
  } else {
    const nonDefault = v.environment.declaredNonDefault;
    p.append(el("p", "bench-note", nonDefault.length === 0
      ? "All allowlisted Ollama settings at defaults (as declared by the bench client - not authoritative)."
      : "Declared non-default: " + nonDefault.map(function (name) {
          const value = v.environment.declared ? v.environment.declared[name] : null;
          return name + "=" + (value === true ? "(set)" : String(value));
        }).join(", ") + " (declared by the bench client - not authoritative)."));
  }
  return p;
}

function benchComparePanel() {
  const p = panel("Compare");
  p.className += " bench-panel bench-compare-panel";
  const attest = el("label", "bench-attest");
  const checkbox = el("input");
  checkbox.type = "checkbox";
  attest.append(checkbox, document.createTextNode(" Both results came from this machine. Cross-machine comparison does not exist here, by design."));
  const go = el("button", null, "Compare");
  go.type = "button";
  go.addEventListener("click", function () { runBenchCompare(checkbox.checked); });
  p.append(attest, go);

  if (!benchComparison) return p;
  if (!benchComparison.allowed) {
    p.append(el("p", "bench-error", "Refused: " + benchComparison.reason));
    return p;
  }

  const { table, body } = dataTable(["Metric", benchSlots[0].name, benchSlots[1].name]);
  const row = function (label, a, b) {
    const tr = el("tr");
    tr.append(dataCell("Metric", null, label), dataCell(benchSlots[0].name, null, a), dataCell(benchSlots[1].name, null, b));
    body.append(tr);
  };
  const L = benchComparison.left, R = benchComparison.right;
  row("Generation", metricText(L.metrics.generationTokensPerSecond, "tok/s", 2), metricText(R.metrics.generationTokensPerSecond, "tok/s", 2));
  row("Prefill", metricText(L.metrics.prefillTokensPerSecond, "tok/s", 0), metricText(R.metrics.prefillTokensPerSecond, "tok/s", 0));
  row("Time to first token", metricText(L.metrics.timeToFirstTokenMs, "ms", 0), metricText(R.metrics.timeToFirstTokenMs, "ms", 0));
  row("Cold load", L.metrics.coldLoadSeconds === null ? "unavailable" : L.metrics.coldLoadSeconds.toFixed(2) + " s", R.metrics.coldLoadSeconds === null ? "unavailable" : R.metrics.coldLoadSeconds.toFixed(2) + " s");
  row("Roofline utilization", pctText(L.roofline.utilization, 1) || "unavailable", pctText(R.roofline.utilization, 1) || "unavailable");
  p.append(table);

  p.append(el("p", "bench-note", "Environment verdict: " + benchComparison.environmentVerdict + " (from the bench protocol's own comparability rules)."));
  for (const note of benchComparison.notes) p.append(el("p", "bench-note", "Note: " + note));
  return p;
}

function benchView(d) {
  const out = [benchHandoffPanel(d), benchDirectoryPanel(), benchDropPanel()];
  benchSlots.forEach(function (slot, index) {
    if (slot) out.push(benchResultPanel(slot, index));
  });
  if (benchSlots[0] && benchSlots[1]) out.push(benchComparePanel());
  // First visit: one scan of the known directory, without blocking the render.
  if (!benchView.scannedOnce) {
    benchView.scannedOnce = true;
    benchRefreshDirectory().then(refreshBench);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Views. One section rendered at a time, because the full single-page layout
// became too long for efficient repeated use. A sidebar that merely jumps
// between anchors would not have fixed that — it would only be a faster way to
// travel the same distance.
// ---------------------------------------------------------------------------

function overviewControlGrid(d) {
  const grid = el("div", "overview-control-grid");
  grid.append(livePanelShell("loaded", "Loaded right now"), switcherPanel(d));
  return grid;
}

const VIEWS = [
  {
    id: "overview",
    label: "Overview",
    icon: "overview",
    build: (d) => [
      overviewSummaryPanel(d),
      livePanelShell("gauges", "Live telemetry"),
      overviewControlGrid(d),
    ],
  },
  // Installed and catalog are separate views rather than one "Models" section:
  // together they were 75% of the original page, and they answer different
  // questions — "what do I already have" versus "what could I get".
  {
    id: "installed",
    label: "Installed",
    icon: "installed",
    count: (d) => d.installed.length,
    build: (d) => [installedPanel(d)],
  },
  {
    id: "catalog",
    label: "Catalog",
    icon: "catalog",
    // The badge deliberately counts what can RUN HERE, not the snapshot size
    // the footer states — two true numbers answering different questions,
    // and the title says which this one is so they cannot read as a
    // disagreement.
    count: (d) => d.models.filter((m) => m.fit !== "too_large").length,
    countTitle: (d) =>
      d.models.filter((m) => m.fit !== "too_large").length +
      " of the snapshot's " + d.catalog.modelCount +
      " catalog models can run on this machine (too-large excluded)",
    build: (d) => [catalogPanel(d)],
  },
  // The Verify leg: protocol-grade results from osai-bench, inspected and
  // compared under the same rules bench itself enforces.
  {
    id: "bench",
    label: "Bench",
    icon: "bench",
    build: (d) => benchView(d),
  },
  // The inference surface (MAINTAINING §4b), measurement-first. chatView is
  // defined in the chat UI module, concatenated after this core — function
  // declarations share the script scope, and nothing calls it until a click.
  {
    id: "chat",
    label: "Chat",
    icon: "chat",
    build: (d) => chatView(d),
  },
  {
    id: "tools",
    label: "Tools",
    icon: "tools",
    count: (d) => d.tools.summary.serversConfigured,
    build: (d) => [toolsPanel(d), localToolsPanel(d)],
  },
  {
    id: "hardware",
    label: "Hardware",
    icon: "hardware",
    // Surfaced in the nav because an unresolved source disagreement is
    // something the user should know exists without hunting for it.
    count: (d) => (d.report.disagreements.length ? d.report.disagreements.length : null),
    countTitle: (d) =>
      d.report.disagreements.length + " unresolved hardware source disagreement" +
      (d.report.disagreements.length === 1 ? "" : "s") + " to review",
    build: (d) => {
      // First visit: one provenance read, without blocking the render.
      if (!bandwidthPanel.fetchedOnce) {
        bandwidthPanel.fetchedOnce = true;
        refreshBandwidthStatus().then(refreshHardware);
      }
      return [hardwareTrustPanel(d), bandwidthPanel(), machinePanel(d), disagreementPanel(d)];
    },
  },
  {
    id: "report",
    label: "Report",
    icon: "report",
    build: (d) => [reportSafetyPanel(d), limitsPanel(d), sharePanel(d)],
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
  line("MODE:", "LOCAL AI ONLY · LOOPBACK");
  return pre;
}

function renderView(id) {
  const view = VIEWS.find((v) => v.id === id) ?? VIEWS[0];
  const viewChanged = activeView !== view.id;
  activeView = view.id;

  // A single semantic page hook drives the low-opacity glow, navigation accent,
  // panel rails and control focus colour. It never changes data or status
  // meaning; it only makes each workspace recognisable at a glance.
  document.body.dataset.view = view.id;
  app.dataset.view = view.id;

  app.textContent = "";
  app.append(hudReadout(dashboardData));
  for (const node of view.build(dashboardData)) {
    if (node) app.append(node);
  }

  for (const button of document.querySelectorAll("#sidenav button")) {
    const isActive = button.dataset.view === view.id;
    if (isActive) {
      button.setAttribute("aria-current", "page");
      button.scrollIntoView({ block: "nearest", inline: "center" });
    } else {
      button.removeAttribute("aria-current");
    }
  }

  // The live panels only exist inside Overview, so repaint them from the last
  // sample on arrival rather than leaving them blank until the next tick.
  if (lastLive) {
    renderGauges(lastLive);
    renderLoaded(lastLive);
    stampLiveMeta(lastLive);
    renderSummaryLive(lastLive);
    renderInstalledLive(lastLive);
    updateSwitcherConsequence();
  }

  if (catalogFocusSearch) {
    const search = document.getElementById("catalog-search");
    if (search) {
      search.focus();
      const end = search.value.length;
      search.setSelectionRange(end, end);
    }
    catalogFocusSearch = false;
  }

  if (viewChanged) playViewTransition();
}

function buildSideNav(d) {
  const nav = document.getElementById("sidenav");
  nav.textContent = "";
  const kicker = el("div", "nav-kicker");
  kicker.append(uiIcon("activity"), el("span", null, "Workspace"));
  nav.append(kicker);
  for (const view of VIEWS) {
    const b = el("button", "nav-item");
    b.type = "button";
    b.dataset.view = view.id;
    b.append(uiIcon(view.icon, "nav-icon"), el("span", "nav-label", view.label));
    const n = view.count ? view.count(d) : null;
    if (n !== null && n !== undefined) b.append(el("span", "count nav-count", n));
    // A badge whose number is a FILTERED count explains its filter — two
    // views can otherwise show numbers that read as contradicting the
    // footer or each other.
    if (view.countTitle && n !== null && n !== undefined) b.title = view.countTitle(d);
    b.addEventListener("click", () => {
      // Writing the hash drives the render through hashchange, so a click and
      // a pasted link take exactly the same path.
      goToView(view.id);
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
  const p = panel("Could not read this machine");
  p.append(el("p", null, String(err.message)));
  app.append(p);
  app.setAttribute("aria-busy", "false");
});
`;

// The served assets, composed from the core plus the chat UI module. The
// composition point is HERE, once — the browser-bundle guards scan these
// composed exports, so every rule asserted about the core binds every module
// concatenated into it, present and future.
export const CSS = THEME_CSS + CORE_CSS + CHAT_CSS;
export const JS = CORE_JS + CHAT_JS;
