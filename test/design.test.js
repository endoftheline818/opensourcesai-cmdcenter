import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { CSS, HTML, INDUSTRIAL, JS, TOKENS } from "../src/serve/ui.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tokens = async () =>
  JSON.parse(await readFile(path.join(root, "fixtures", "website-design-tokens.json"), "utf8"));
const tokens_ = tokens;

function withoutComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

// WEBSITE-TOKEN GUARD.
//
// REWRITTEN AT THE INDUSTRIAL-PALETTE CROSSING (src/serve/theme.css).
//
// This was a brand-parity guard. It asserted the dashboard's chrome was a
// colour-for-colour copy of the site's, on the stated grounds that "its palette
// is not a design choice made here". That stopped being true when the palette
// moved into theme.css: --color-bg now aliases --color-canvas and --color-primary
// aliases --color-brand-cyan, so of the twenty colours pinned below, exactly TWO
// still reach a rendered pixel — success and error. The other eighteen went on
// being compared, went on passing, and described nothing. The object was still
// live; the stylesheet had moved on without it.
//
// It is rewritten rather than deleted, for the same reason the light palette was
// always kept pinned: TOKENS is the record of the site's palette and
// sync-from-website.mjs keeps it fresh for future surfaces. So the copy-freshness
// half stays, and still fails if the site is restyled. What is NEW is the
// liveness half — every token this dashboard actually renders has to be shown
// reaching the served stylesheet, so this can never again pass while measuring
// nothing.
test("website tokens stay in sync, and the ones the dashboard renders stay live", async () => {
  const fixture = await tokens();

  // 1. COPY FRESHNESS. The full palette stays pinned against the site's own
  //    stylesheet. This is the half that catches a restyle over there.
  const mapping = {
    bg: "color-bg",
    surface: "color-surface",
    surfaceSoft: "color-surface-soft",
    border: "color-border",
    text: "color-text",
    textMuted: "color-text-muted",
    primary: "color-primary",
    primaryHover: "color-primary-hover",
    success: "color-success",
    error: "color-error",
  };

  for (const mode of ["light", "dark"]) {
    for (const [ours, theirs] of Object.entries(mapping)) {
      assert.equal(
        TOKENS[mode][ours],
        fixture[mode][theirs],
        `${mode}.${ours} drifted from the site's --${theirs}`,
      );
    }
  }

  // 2. LIVENESS. Asserted at the DECLARATION SITE, never with a bare substring
  //    search for the value: CSS.includes(TOKENS.light.bg) is true today purely
  //    by collision with an unrelated #f8fafc literal, which is exactly how a
  //    dead token goes on looking alive.
  const rendered = {
    "--color-success": TOKENS.dark.success,
    "--color-error": TOKENS.dark.error,
    "--radius-card": TOKENS.radiusCard,
    "--radius-frame": TOKENS.radiusFrame,
    "--content": TOKENS.content,
  };
  for (const [prop, value] of Object.entries(rendered)) {
    assert.ok(
      CSS.includes(`${prop}: ${value};`),
      `${prop} no longer renders from its site token — either rewire it or retire it here`,
    );
  }

  // 3. THE CROSSING ITSELF. The chrome is the industrial palette now. Pinning it
  //    means a silent revert to a site token fails here rather than changing how
  //    the instrument looks while every assertion above still passes.
  assert.match(CSS, /--color-bg:\s*var\(--color-canvas\)/, "the canvas must come from the industrial palette");
  assert.match(CSS, /--color-primary:\s*var\(--color-brand-cyan\)/, "the primary action colour is brand cyan, not the site primary");
  assert.match(CSS, /--color-text:\s*var\(--color-text-main\)/, "body text must come from the industrial palette");
});

// THE HUD PALETTE IS PINNED THE SAME WAY THE SITE TOKENS ARE.
//
// The dashboard's chrome follows the social-image style guide so the product
// looks like one product across its surfaces. That palette is a COPY, parsed
// from the guide's own colour table by the sync script — so a restyle there
// fails here rather than drifting.
test("HUD colours match the social-image style guide exactly", async () => {
  const { HUD } = await import("../src/serve/ui.js");
  const fixture = JSON.parse(
    await readFile(path.join(root, "fixtures", "website-social-palette.json"), "utf8"),
  );
  for (const [key, value] of Object.entries(fixture.palette)) {
    assert.equal(HUD[key], value, `HUD.${key} drifted from the style guide`);
  }
  // And the values must actually reach the served stylesheet, not merely exist
  // in an object nobody references.
  for (const value of Object.values(fixture.palette)) {
    assert.ok(CSS.includes(value), `${value} missing from the served CSS`);
  }
});

test("semantic colours still come from the site tokens", async () => {
  // success and error mean the same thing on every surface, so they stay on
  // the site palette even though the chrome moved to the HUD one.
  const tokens = await tokens_();
  assert.ok(CSS.includes(tokens.dark["color-success"]), "success must stay a site token");
  assert.ok(CSS.includes(tokens.dark["color-error"]), "error must stay a site token");
});

test("structural tokens match the website", async () => {
  const fixture = await tokens();
  assert.equal(TOKENS.radiusCard, fixture.structural["radius-card"]);
  assert.equal(TOKENS.radiusFrame, fixture.structural["radius-frame"]);
  assert.equal(TOKENS.content, fixture.structural.content);
});

test("Tailwind v4 compiles the industrial palette without becoming a runtime dependency", async () => {
  const theme = await readFile(path.join(root, "src", "serve", "theme.css"), "utf8");
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const mapping = {
    canvas: "canvas",
    surface: "surface",
    borderSubtle: "border-subtle",
    textMain: "text-main",
    textMuted: "text-muted",
    brandCyan: "brand-cyan",
    brandCyanHover: "brand-cyan-hover",
    dataOrange: "data-orange",
    statusGreen: "status-green",
  };

  assert.match(theme, /@theme static\s*\{/, "the palette source must use Tailwind v4's theme directive");
  for (const [key, token] of Object.entries(mapping)) {
    assert.ok(theme.includes(`--color-${token}: ${INDUSTRIAL[key]};`), `${token} drifted from the approved industrial palette`);
    assert.ok(CSS.includes(`--color-${token}:`), `${token} is missing from Tailwind's compiled stylesheet`);
  }
  assert.match(CSS, /^:root,:host\{--color-canvas:/, "the served CSS must begin with the locally compiled Tailwind theme");
  assert.match(pkg.devDependencies.tailwindcss, /^\^4\./, "Tailwind must stay on the approved v4 compiler");
  assert.match(pkg.devDependencies["@tailwindcss/cli"], /^\^4\./, "the local theme build needs the v4 CLI");
  assert.equal(pkg.dependencies, undefined, "Tailwind must never become a runtime dependency");
});

test("the desktop instrument has its own semantic workspace and surface roles", () => {
  const css = withoutComments(CSS);

  // Keep the website reading-width token pinned, but do not force a data-heavy
  // desktop instrument into that prose-oriented measure.
  assert.ok(css.includes("--content: " + TOKENS.content), "the pinned website content token must remain available");
  assert.match(css, /--content-dashboard:\s*1480px/, "the dashboard needs an explicit desktop workspace width");
  assert.match(css, /\.shell\s*\{[^}]*max-width:\s*var\(--content-dashboard\)/, "the shell must use the workspace width");

  for (const role of ["display", "title", "body", "support", "small", "label", "micro"]) {
    assert.match(css, new RegExp("--text-" + role + ":"), `missing semantic text role ${role}`);
  }
  for (const role of ["panel", "panel-strong", "inset", "control", "hover"]) {
    assert.match(css, new RegExp("--surface-" + role + ":"), `missing semantic surface role ${role}`);
  }
  assert.match(css, /\.panel\s*\{[\s\S]*?background:\s*var\(--color-surface\)/, "panels must use the flat industrial surface");
  assert.match(css, /\.panel\s*\{[\s\S]*?border:\s*1px solid var\(--color-border-subtle\)/, "panels must use the crisp industrial divider");
  assert.match(css, /button, select, input\s*\{[\s\S]*?background:\s*var\(--surface-control\)/, "controls must use the shared control surface");
});

test("the desktop interface defaults to the approved 80-percent density", () => {
  const css = withoutComments(CSS);

  assert.match(css, /--ui-density-scale:\s*0\.8/, "desktop density must match the approved 80% browser-zoom reference");
  assert.match(css, /html\s*\{\s*zoom:\s*var\(--ui-density-scale\);\s*\}/, "the density scale must apply to the complete interface");
  assert.doesNotMatch(css, /transform:\s*scale\(0\.8\)/, "density must reflow layout instead of visually shrinking an oversized canvas");
});

// The HUD is deliberately dark-only.
//
// This test previously required a light theme to be served. The dashboard's
// chrome now follows the social-image language, which has no light variant —
// a light HUD reads as a mistake rather than a choice. The site's light tokens
// remain PINNED (the parity test above still covers them) and available to any
// future surface; they are simply not what this instrument uses.
test("the HUD is dark-only and says so, rather than half-supporting light", async () => {
  const fixture = await tokens();

  // If a light scheme is declared at all, it must not silently repaint the HUD
  // into a half-working state — it may only pin color-scheme.
  const lightBlock = /@media \(prefers-color-scheme: light\) \{([\s\S]*?)\n\}/.exec(CSS);
  assert.ok(lightBlock, "the light-scheme intent should be stated explicitly, not omitted");
  assert.doesNotMatch(lightBlock[1], /--color-bg|--color-surface|--color-text/, "the HUD must not partially theme for light");

  // The site's light tokens stay pinned by the parity test even though the
  // stylesheet no longer emits them.
  assert.ok(fixture.light["color-primary"], "the light palette must remain pinned for future surfaces");
});

test("the site's typography stack is used, not a generic one", async () => {
  const fixture = await tokens();
  // Referenced by name with the site's own fallbacks. The fonts are NOT
  // fetched — this package makes no external request — so a machine without
  // Inter installed lands on the same fallbacks the site's stack declares.
  assert.match(CSS, /--font-body:\s*Inter/, "body font must lead with Inter");
  assert.match(CSS, /--font-mono:\s*'JetBrains Mono'/, "mono font must lead with JetBrains Mono");
  assert.match(fixture.structural["font-body"], /inter/i, "the site still leads with Inter");
  assert.doesNotMatch(CSS, /@import|fonts\.googleapis|fonts\.gstatic/, "fonts must never be fetched");
});

test("the page is branded as part of the platform", () => {
  const html = HTML("t".repeat(64));
  assert.match(html, /OpenSourcesAI/, "the wordmark must be present");
  assert.match(html, /Command Center/, "the product name must be present");
  assert.match(html, /<title>Command Center — OpenSourcesAI<\/title>/);
  assert.match(html, /src="\/brand-icon\.png"/, "the brand mark must be shown");
  assert.match(html, /rel="icon" href="\/brand-icon\.png"/, "the favicon must be the brand mark");
});

test("the brand mark is served same-origin, never hotlinked or inlined", () => {
  const html = HTML("t".repeat(64));
  // Same-origin only: the CSP is img-src 'self' data:, and hotlinking the live
  // site would be both an external request and a broken image offline.
  assert.doesNotMatch(html, /https?:\/\/[^"']*\.(png|jpg|svg|webp)/i, "no remote image may be referenced");
  assert.doesNotMatch(html, /data:image\/[a-z+]+;base64,[A-Za-z0-9+/]{200,}/, "a 57 KB inline data URI would bloat every page load");
});

// THIS TEST HAS NOW BEEN REWRITTEN AT TWO BOUNDARY CROSSINGS — that is its job.
//
// It first asserted "Read-only"; Phase 2 opened load and unload, and the badge
// kept promising something the tool no longer honoured until a screenshot —
// not the suite — caught it. It then asserted "Load / unload only"; the
// 2026-08-07 decision (MAINTAINING §4b) authorized an inference surface, so
// that phrasing was retired the same deliberate way, BEFORE the code that
// makes it false exists. Both times the lesson is identical: a test can only
// protect a property someone remembered to restate when the property changed,
// and when a boundary moves, this test must move in the same commit.
//
// The guarantee that holds through this crossing, and the one a user actually
// cares about: everything stays on this machine, and nothing is downloaded or
// destroyed. That is what the badge now says.
test("the interface states the CURRENT guarantee, not a stale one", () => {
  const html = HTML("t".repeat(64));
  assert.match(html, /Local AI only/, "the badge must state what the tool actually is");
  assert.match(html, /never to the internet/, "the load-bearing guarantee belongs in the interface");
  assert.match(html, /never pulls, deletes or removes/, "the standing no-destruction guarantee stays stated");
  assert.doesNotMatch(html, /">Read-only</, "retired at the Phase 2 crossing");
  assert.doesNotMatch(html, /Load \/ unload only/, "retired at the Phase 3b crossing");
});

// THE BROWSER BUNDLE MUST ACTUALLY PARSE.
//
// It is carried as a template literal inside this module, which makes two
// mistakes invisible to `node --check` on the server file: a nested backtick
// closes the outer literal early, and a nested interpolation is evaluated at
// module scope instead of in the browser. Both were hit while adding the
// sidebar — the second one inside a comment that was explaining the first.
// Only the server file is syntax-checked by tooling; this checks the payload.
test("the served JavaScript is syntactically valid", async () => {
  const { JS } = await import("../src/serve/ui.js");
  assert.doesNotThrow(() => new Function(JS), "the browser bundle does not parse");
  assert.ok(JS.length > 1000, "suspiciously small bundle — the template may have closed early");
});

// REGRESSION TEST FOR A PANEL THAT CONTRADICTED THE ONE BESIDE IT.
//
// The Overview's next-action panel was built once from the page-load snapshot
// while the Loaded card next to it refreshed every two seconds. On screen the
// card read "0 — No resident model" while the recommendation directly below it
// said "1 model currently reported as resident". Caught from a screenshot, not
// from the suite — the same way the stale READ-ONLY badge was.
//
// The wrong sentence was only the symptom. The whole decision was frozen —
// title, button and behaviour — on a panel whose entire job is saying what to
// do next.
test("the next-action panel is rebuilt from live data, not left at page load", async () => {
  const { JS } = await import("../src/serve/ui.js");

  // The id is a CONTRACT between two places: the builder that stamps it and the
  // live renderer that looks it up. Pinning both here is what stops a rename in
  // one from silently disabling the refresh in the other — which would go stale
  // again with every other test still passing.
  assert.match(JS, /wrap\.id = "summary-action"/, "the builder must stamp the id the live renderer finds");
  assert.match(JS, /getElementById\("summary-action"\)/, "the live renderer must look up that exact id");

  // Wiring, not merely existence: a renderer nothing calls is dead code that
  // looks like a fix.
  assert.match(JS, /function renderNextActionLive/, "the live renderer must exist");
  // Matched as a CALL STATEMENT — the trailing semicolon is what distinguishes
  // it from `function renderNextActionLive(live) {`. Written first without it,
  // this assertion passed while the call site was deleted, because the
  // declaration satisfied the pattern. Sixth instance of this repo's
  // matching-the-wrong-thing trap, and the first in a test rather than a guard.
  assert.match(JS, /^\s*renderNextActionLive\(live\);/m, "renderSummaryLive must actually call it");

  // It must read residency from the LIVE sample. Rebuilding from the page-load
  // snapshot would repaint the same stale claim on every tick.
  assert.match(
    JS,
    /live\.loaded\.reachable \? live\.loaded\.models : \[\]/,
    "the rebuilt panel must take residency from the live sample",
  );

  // And an Ollama that stops mid-session must not be advised to warm a model.
  // Replacing one stale claim with another is not a fix.
  assert.match(JS, /reachable === false/, "offline must be handled before the page-load install flag");
});

test("the navigation shell is present for the browser bundle to populate", () => {
  const html = HTML("t".repeat(64));
  // The nav and live strip are filled in by script, so the markup only has to
  // provide their mount points — but if these ids drift, navigation silently
  // stops working with no error anywhere.
  assert.match(html, /id="sidenav"/, "the side navigation mount point must exist");
  assert.match(html, /id="livestrip"/, "the persistent live readout mount point must exist");
  assert.match(html, /aria-label="Dashboard sections"/, "navigation must be labelled for screen readers");
});

test("gauge values are not clipped by the masked ring layer", () => {
  const css = withoutComments(CSS);
  const dialRule = /\n\.dial\s*\{([\s\S]*?)\n\}/.exec(css);
  const ringRule = /\n\.dial::before\s*\{([\s\S]*?)\n\}/.exec(css);

  assert.ok(dialRule, "the gauge container rule must exist");
  assert.ok(ringRule, "the masked ring layer must exist");
  assert.doesNotMatch(dialRule[1], /\bmask:/, "the container must not mask its text children");
  assert.match(ringRule[1], /\bmask:/, "the ring layer should carry the radial mask");
  assert.match(css, /\.dial-face\s*\{[\s\S]*z-index:\s*1/, "the readable value must sit above the ring");
});

test("live telemetry motion is stateful, restrained, and reducible", () => {
  const css = withoutComments(CSS);
  const js = withoutComments(JS);

  for (const animation of ["viewEnter", "metricFlash", "liveBreathe", "gaugeBreathe"]) {
    assert.match(css, new RegExp("@keyframes\\s+" + animation + "\\b"), `missing ${animation} motion`);
  }
  assert.match(css, /#app\.view-enter\s*\{[^}]*240ms/, "section changes should be brief rather than theatrical");
  assert.match(css, /\.live-dot:not\(\.stale\)\s*\{[^}]*liveBreathe/, "only a live sample should breathe");
  assert.match(css, /\.dial\.polling::after\s*\{[\s\S]*gaugeBreathe/, "active gauges need a polling cue");
  assert.match(
    css,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*#app\.view-enter,[\s\S]*animation:\s*none/,
    "every decorative motion path must shut off for reduced motion",
  );

  assert.match(js, /const liveMetricValues = new Map\(\)/, "live values need previous-sample state");
  assert.match(js, /function animateLiveMetric\(/, "metric tweening should be centralized");
  assert.match(js, /previous === next \|\| prefersReducedMotion\(\)/, "unchanged and reduced-motion values must paint directly");
  assert.match(js, /requestAnimationFrame\(step\)/, "changed values should ease between samples");
  assert.match(js, /animateLiveMetric\(value, "gauge:" \+ gauge\.id/, "gauge readings must use the motion helper");
  assert.match(js, /animateLiveMetric\(value, "strip:" \+ id/, "the persistent live strip must use the motion helper");
  assert.match(js, /let telemetryIsLive = false/, "live versus stale must persist across section changes");
  assert.match(js, /gauge\.available && telemetryIsLive/, "returning to Overview must not animate a stale sample");
  assert.match(js, /telemetryIsLive = false;[\s\S]*setPollingVisualState\(false, telemetryStaleReason\)/, "a stale sample must stop active polling cues");
  assert.match(js, /if \(telemetryIsLive\)[\s\S]*live-dot stale/, "live panel labels must use the persistent telemetry state");
  assert.match(js, /if \(lastLive\)[\s\S]*renderGauges\(lastLive\)[\s\S]*stampLiveMeta\(lastLive\)/, "section return must repaint both gauges and their persistent live or stale label");
  assert.match(js, /const viewChanged = activeView !== view\.id/, "same-view repaints must not masquerade as navigation");
  assert.match(js, /if \(viewChanged\) playViewTransition\(\)/, "real section changes should trigger the restrained transition");
});

test("Phase 3 iconography is local, semantic, and wired into the interface", () => {
  const css = withoutComments(CSS);
  const js = withoutComments(JS);

  assert.match(js, /const ICON_PATHS = Object\.freeze\(/, "the icon set must live in the served bundle");
  assert.match(js, /document\.createElementNS\(SVG_NS, tag\)/, "icons must be built as SVG nodes without injected markup");
  assert.doesNotMatch(js, /innerHTML/, "machine data and SVGs must never be injected through innerHTML");
  assert.match(js, /function uiIcon\(/, "icon creation should have one CSP-safe path");
  assert.match(js, /function panelHeading\(/, "card headings should use the shared icon treatment");
  assert.match(js, /function statusChip\(/, "status-state icons should be applied consistently");
  assert.match(js, /value\.includes\("catalog"\)[^\n]*return "catalog"/, "the Catalog card should not inherit a generic machine icon");
  assert.match(js, /value\.includes\("report safety"\)[^\n]*return "shield"/, "the report boundary should use the trust icon");

  for (const id of ["overview", "installed", "catalog", "bench", "chat", "tools", "hardware", "report"]) {
    assert.match(js, new RegExp('id:\\s*"' + id + '"[\\s\\S]*?icon:\\s*"' + id + '"'), `missing ${id} navigation icon`);
  }
  assert.match(
    js,
    /b\.append\(uiIcon\(view\.icon, "nav-icon"\), el\("span", "nav-label", view\.label\)\)/,
    "navigation buttons must pair icon and label rather than becoming icon-only controls",
  );

  assert.match(css, /\.sidenav button\[aria-current="page"\]::before\s*\{[^}]*opacity:\s*1/, "the active view needs an explicit accent rail");
  assert.match(css, /\.sidenav button\[aria-current="page"\] \.nav-icon\s*\{[^}]*color:\s*var\(--nav-accent\)/, "the active icon needs a strong page-specific state");
  assert.match(css, /\.panel-title \.panel-icon\b/, "panel icons must share one visual treatment");
  assert.match(css, /\.status-chip \.status-icon\b/, "status icons must inherit their semantic chip colour");
});

test("visual transformation charts every live counter with bounded honest history", () => {
  const css = withoutComments(CSS);
  const js = withoutComments(JS);

  assert.match(
    js,
    /const TREND_GAUGE_IDS = new Set\(\["cpu", "ram", "gpu", "vram", "temp", "power", "clocks", "disk"\]\)/,
    "the eight emitted live counters should all accumulate local history",
  );
  assert.match(js, /const FEATURED_GAUGE_IDS = new Set\(\["cpu", "ram", "gpu", "vram"\]\)/, "core pressure counters should lead the canvas");
  assert.match(js, /const LIVE_HISTORY_LIMIT = 30/, "trend history must have a small fixed memory bound");
  assert.match(js, /if \(history\.length > LIVE_HISTORY_LIMIT\) history\.splice/, "old samples must be discarded");
  assert.match(js, /if \(!Number\.isFinite\(value\)\)\s*\{\s*liveMetricHistory\.delete\(id\)/, "unavailable counters must not retain a misleading old trend");
  assert.match(js, /recordLiveMetricHistory\(live\);\s*renderGauges\(live\);/, "only a successful poll may advance history before repainting");
  const pollSource = js.slice(js.indexOf("async function poll()"), js.indexOf("function startPolling()"));
  const failureBranch = pollSource.slice(pollSource.indexOf("catch (err)"));
  assert.doesNotMatch(failureBranch, /recordLiveMetricHistory/, "a failed poll must never advance history");
  assert.match(js, /gauge\.available && TREND_GAUGE_IDS\.has\(gauge\.id\)/, "unavailable gauges must not show trends");
  assert.match(js, /function metricPanel\(gauge\)/, "the monitoring grid should share one metric-panel builder");
  assert.match(js, /for \(const gauge of live\.gauges\) wrap\.append\(metricPanel\(gauge\)\)/, "every emitted counter should be represented once");
  assert.match(js, /svgNode\("polyline", \{ class: "sparkline-line"/, "trend lines must be local inline SVG");
  assert.match(js, /fixed 0–100% scale/, "the chart scale must be explicit rather than visually rescaled to exaggerate movement");

  assert.match(css, /\.gauges\s*\{[^}]*grid-template-columns:\s*repeat\(12, minmax\(0, 1fr\)\)/, "the desktop canvas should use a modular twelve-column grid");
  assert.match(css, /\.metric-panel\s*\{[^}]*grid-column:\s*span 3/, "eight counters should form a dense four-panel desktop row");
  assert.match(css, /\.metric-panel\.is-featured\b/, "primary counters need a larger history panel");
  assert.match(css, /\.metric-panel\.is-compact\b/, "operating counters need a compact dial-plus-trend form");
  assert.match(css, /\.metric-bar span\s*\{[^}]*width:\s*calc\(var\(--metric-p\) \* 1%\)/, "each panel needs an honest zero-to-one-hundred level bar");
  assert.match(css, /\.gauge-trend\.stale\s*\{[^}]*opacity:/, "stale trend context must be visually muted");
  assert.match(js, /document\.querySelectorAll\("\.gauge-trend"\)[\s\S]*classList\.toggle\("stale", !active\)/, "a failed poll must immediately relabel visible trends as stale");
  assert.match(js, /document\.querySelectorAll\("\.metric-sample-state"\)[\s\S]*nodeValue = active \? "live" : "stale"/, "a failed poll must relabel every panel, not only dim its chart");
});

test("industrial telemetry uses cyan system channels and orange hardware channels", () => {
  const css = withoutComments(CSS);
  const js = withoutComments(JS);

  for (const role of ["cyan", "orange", "amber", "neutral", "red"]) {
    assert.match(css, new RegExp("--metric-" + role + ":"), `missing monitoring colour ${role}`);
  }
  for (const tone of ["cyan", "orange", "warn", "critical", "neutral", "unknown"]) {
    assert.match(css, new RegExp("\\.metric-panel\\.tone-" + tone), `missing metric panel tone ${tone}`);
  }
  assert.match(css, /\.telemetry-section\s*\{[^}]*background-size:\s*24px 24px/, "the monitoring surface needs a restrained instrumentation grid");
  assert.match(css, /\.telemetry-section \.live-summary\s*\{[^}]*grid-template-columns:/, "pressure context should be a compact status rail");
  assert.match(css, /\.summary-card::before\s*\{[^}]*background:\s*var\(--summary-accent\)/, "summary facts need semantic accent rails");
  assert.match(js, /summaryCard\("Hardware"[\s\S]*"cyan"\)/, "hardware capacity is structure, not orange telemetry");
  assert.match(js, /summaryCard\("Loaded"[\s\S]*"cyan"\)/, "model residency stays in the cyan software channel");
  assert.match(js, /pressureCard\.classList\.add\(top\.severity\)/, "live pressure must move the summary accent to warning or critical state");
  assert.match(js, /\["gpu", "vram", "temp", "power", "clocks", "disk"\]\.includes\(gauge\.id\)\) return "orange"/, "physical hardware gauges must use orange");
  assert.match(js, /return "cyan";/, "CPU and system memory must stay cyan");
  assert.match(css, /\.metric-sample-state \.live-dot\s*\{[^}]*background:\s*var\(--metric-color\)/, "each hardware or system polling dot must inherit its data channel");
  assert.match(css, /\.metric-stat-value\s*\{[^}]*color:\s*var\(--color-text-main\)/, "orange must not leak into telemetry typography");
  assert.match(css, /\.gauge-trend-caption\s*\{[^}]*color:\s*var\(--color-text-muted\)/, "chart captions must remain neutral rather than orange");
  assert.match(js, /p\.className \+= " bench-panel bench-handoff-panel"/, "benchmark panels need a stable semantic hook");
  assert.match(js, /id === "loaded" \? " residency-section"/, "loaded residency needs a stable semantic hook");
});

test("industrial colour discipline prevents the generic AI SaaS aesthetic", () => {
  const css = withoutComments(CSS);
  const js = withoutComments(JS);

  const body = /body\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
  const panel = /\.panel\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
  assert.match(body, /background:\s*var\(--color-canvas\)/, "the canvas must be neutral OLED carbon");
  assert.doesNotMatch(body, /radial-gradient/, "the canvas must not use ambient coloured glows");
  assert.match(panel, /background:\s*var\(--color-surface\)/, "panels must be flat matte zinc");
  assert.match(panel, /border:\s*1px solid var\(--color-border-subtle\)/, "panels must use crisp neutral borders");
  assert.doesNotMatch(panel, /gradient|box-shadow/, "panels must not use glass gradients or glows");
  assert.doesNotMatch(css, /--metric-(violet|pink|blue|teal|green):/, "decorative AI-palette roles must not return");
  assert.doesNotMatch(css, /#a78bfa|#f472b6|rgba\(167,\s*139,\s*250|rgba\(244,\s*114,\s*182/i, "purple and pink must not return through literals");
  assert.doesNotMatch(css, /drop-shadow|text-shadow/, "ambient and typographic glows are forbidden");
  assert.match(css, /\.sidenav button\[aria-current="page"\]\s*\{[^}]*border-color:\s*var\(--color-brand-cyan\)/, "only the active navigation state gets the brand action colour");
  assert.match(css, /\.primary-action\s*\{[^}]*background:\s*var\(--color-brand-cyan\)/, "primary actions must use solid brand cyan");
  assert.match(css, /\.pill\.tight\s*\{[^}]*var\(--metric-amber\)/, "fit pressure must remain amber rather than inheriting decorative page colour");
  assert.match(css, /\.status-chip\.ready\s*\{[^}]*var\(--color-status-green\)/, "healthy state must use the dedicated status green");
  assert.match(css, /\.status-chip\.ok, \.status-chip\.verified\s*\{[^}]*var\(--metric-cyan\)/, "trust and quality confirmations must remain cyan rather than claiming health");
  assert.equal((css.match(/var\(--color-status-green\)/g) ?? []).length, 3, "status green may only be consumed by the healthy status chip");
  assert.match(css, /\.status-chip\.critical\s*\{[^}]*var\(--color-error\)/, "critical state must remain the product error colour");

  for (const hook of ["installed-panel", "catalog-panel", "chat-panel", "tools-panel", "hardware-panel", "bench-panel", "report-panel"]) {
    assert.match(js, new RegExp(hook), `missing ${hook} domain hook`);
  }
  assert.match(js, /document\.body\.dataset\.view = view\.id/, "the active page must drive the inherited colour identity");
  assert.match(js, /app\.dataset\.view = view\.id/, "the workspace itself must expose the active identity for inspection");
  assert.match(js, /card\.dataset\.target = target/, "Overview next-step cards should preview their destination colours");
  assert.match(css, /\.chat-panel textarea\s*\{[^}]*background:\s*var\(--surface-control\)/, "Chat text areas must use the neutral control surface");
  assert.match(css, /\.chat-panel textarea:focus-visible\s*\{[^}]*var\(--metric-cyan\)/, "Chat focus must use the shared action channel");
  assert.match(js, /el\("button", "primary-action chat-send", "Send"\)/, "Chat's primary action should carry its page accent");
});

test("catalog rows have a mobile-safe responsive table path", () => {
  const css = withoutComments(CSS);
  const js = withoutComments(JS);

  assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.responsive-table tr/, "mobile table rules must be emitted");
  assert.match(css, /\.responsive-table td\[data-label\]::before/, "mobile cells must show their labels");
  assert.match(
    js,
    /dataTable\(\["Model", "Fit", "Quant", "Needs", "Run it"\], "catalog-table responsive-table"\)/,
    "catalog must use the responsive table class",
  );
  assert.match(js, /dataCell\("Run it"\)/, "the command cell needs a mobile label");
});

test("overview starts with a public-ready command summary", () => {
  const css = withoutComments(CSS);
  const js = withoutComments(JS);

  assert.match(css, /\.summary-panel\b/, "summary panel styling must be served");
  assert.match(css, /\.overview-control-grid\b/, "residency and load controls need a compact desktop workspace");
  assert.match(js, /overviewSummaryPanel\(d\),[\s\S]*livePanelShell\("gauges"/, "summary must lead Overview");
  assert.match(js, /function overviewControlGrid\(d\)/, "Overview controls should be composed in one desktop grid");
  assert.match(js, /overviewControlGrid\(d\)/, "Overview must render the desktop control grid");
  assert.doesNotMatch(js, /function ollamaPanel\b/, "runtime facts already visible in the HUD and live gauges must not get a duplicate panel");
  assert.match(js, /runnable\.length \+ " runnable"/, "capacity must distinguish runnable from comfortable");
  assert.match(js, /renderSummaryLive\(live\)/, "live telemetry should update the summary");
});

test("overview exposes trust state and safe next actions", () => {
  const css = withoutComments(CSS);
  const js = withoutComments(JS);

  assert.match(css, /\.summary-trust\b/, "overview trust chips must be styled");
  assert.match(css, /\.summary-next\b/, "overview next-action cards must be styled");
  assert.match(css, /\.summary-action\b/, "overview should have a distinct next-action surface");
  assert.match(js, /summaryTrustRail\(d\)/, "overview must render trust chips");
  assert.match(js, /summaryActionPanel\(d, runnable, loaded\)/, "overview must render the primary next action");
  assert.match(js, /summaryNextSteps\(d, runnable\)/, "overview must render secondary next actions");
  assert.match(js, /function goToView\(id\)/, "overview cards should use the existing view system");
  assert.match(js, /function focusSwitcher\(\)/, "the primary action should focus the existing load console");
  for (const text of ["Loopback only", "Never touches the internet", "Open Catalog", "Review Hardware", "Open Report"]) {
    assert.match(js, new RegExp(text.replace(/[ /]/g, (m) => (m === " " ? "\\s+" : "\\/"))), `${text} should be visible in the Overview`);
  }
});

test("live system explains pressure before gauge dials", () => {
  const css = withoutComments(CSS);
  const js = withoutComments(JS);

  assert.match(css, /\.live-summary\b/, "live system needs an explanatory summary surface");
  assert.match(css, /\.live-pressure-list\b/, "ranked pressure rows must be styled");
  assert.match(css, /\.live-pressure-row\.warn\b/, "warning pressure rows need a distinct state");
  assert.match(css, /\.live-summary-main,[\s\S]*\.loaded-summary-main/, "live and loaded summaries should share a compact structure");
  assert.match(js, /function rankLiveGauges\(live\)/, "pressure ranking should be centralized");
  assert.match(js, /const NON_PRESSURE_GAUGE_IDS = new Set\(\["clocks"\]\)/, "GPU clock activity must not masquerade as system pressure");
  assert.match(js, /Number\(!NON_PRESSURE_GAUGE_IDS\.has\(b\.id\)\)[\s\S]*b\.percent - a\.percent/, "pressure-relevant counters must rank ahead of neutral activity at equal severity");
  assert.match(js, /function renderLiveSummary\(live\)/, "live pressure summary should be rendered explicitly");
  assert.match(js, /body\.append\(renderLiveSummary\(live\)\)/, "summary must appear before the gauge grid");
  assert.match(js, /const gauges = rankLiveGauges\(live\)/, "overview pressure card should use the same ranking");
  assert.match(js, /"Pressure focus"/, "pressure summary needs a clear label");
  assert.match(js, /"No live counters available/, "unknown telemetry must stay honest");
});

test("loaded view explains residency before unload controls", () => {
  const css = withoutComments(CSS);
  const js = withoutComments(JS);

  assert.match(css, /\.loaded-summary\b/, "loaded panel needs a residency summary");
  assert.match(css, /\.loaded-summary\.spilled\b/, "spilled residency needs a distinct state");
  assert.match(css, /\.loaded-state\.resident-state\b/, "fully resident model chips must be styled");
  assert.match(css, /\.loaded-state\.spilled-state\b/, "CPU spill model chips must be styled");
  assert.match(js, /function renderLoadedSummary\(live\)/, "loaded residency summary should be rendered explicitly");
  assert.match(js, /body\.append\(renderLoadedSummary\(live\)\)/, "loaded summary must appear before unload controls");
  assert.match(js, /m\.spilled \? "spilled to CPU" : "fully in VRAM"/, "each loaded row should name residency state");
  assert.match(js, /"No pull or delete"/, "loaded empty state should restate the action boundary");
  assert.match(js, /requestUnload\(m\.name, unload\)/, "unload must still use the existing action path");
});

test("load console previews the selected safe action", () => {
  const css = withoutComments(CSS);
  const js = withoutComments(JS);

  assert.match(css, /\.action-preview\b/, "load action preview must be styled");
  assert.match(css, /\.action-preview-card\b/, "preview facts should be separated from controls");
  assert.match(js, /function updateSwitcherPreview\(target\)/, "selected model preview should update with the picker");
  assert.match(js, /"switcher-selected-model"/, "selected model preview needs a stable id");
  assert.match(js, /"switcher-preview-consequence"/, "consequence preview needs a stable id");
  assert.match(js, /updateSwitcherPreview\(select\.value\)/, "selector changes should update the preview");
  assert.match(js, /describeLoadConsequence\(target\)/, "preview should use the same consequence text as status");
  assert.match(js, /actionPreviewCard\("Request", "Empty prompt"/, "the empty-prompt boundary should be visible before clicking Load");
});

test("native controls are styled and specifically labelled", () => {
  const css = withoutComments(CSS);
  const js = withoutComments(JS);

  assert.match(css, /button, select, input\s*\{[\s\S]*background:/, "buttons, selects, and inputs must share the control surface");
  assert.match(css, /select\s*\{[\s\S]*appearance:\s*none/, "the model picker should not fall back to a gray native control");
  assert.match(js, /setAttribute\("aria-label", "Load selected model"\)/);
  assert.match(js, /copyButton\(m\.runCommand, "Copy command for " \+ m\.name, true\)/);
});

test("installed view has live-aware action rows", () => {
  const css = withoutComments(CSS);
  const js = withoutComments(JS);

  assert.match(css, /\.installed-list\b/, "installed models should render as a scannable list");
  assert.match(css, /\.installed-action\b/, "each installed model should have an action area");
  assert.match(js, /state\.dataset\.modelState = m\.name/, "installed rows should expose live residency state");
  assert.match(js, /load\.dataset\.loadModel = m\.name/, "installed load buttons should be live-updatable");
  assert.match(js, /requestLoad\(m\.name, state, load\)/, "installed actions should use the shared load path");
  assert.match(js, /renderInstalledLive\(live\)/, "polling should refresh installed action state");
});

test("action console keeps the mutation boundary narrow", () => {
  const css = withoutComments(CSS);
  const js = withoutComments(JS);

  assert.match(css, /\.action-panel\b/, "load controls should be styled as a deliberate action console");
  assert.match(css, /\.primary-action\b/, "primary load controls should have a clear affordance");
  assert.match(js, /fetch\("\/api\/actions\/load"/, "load must still use the existing load endpoint");
  assert.match(js, /fetch\("\/api\/actions\/unload"/, "unload must still use the existing unload endpoint");
  assert.equal((js.match(/body: JSON\.stringify\(\{ model: model \}\)/g) || []).length, 2, "load and unload should send only the selected model");
  assert.doesNotMatch(js, /\/api\/actions\/(pull|delete|remove|copy|create|push|stop|serve)\b/, "UI must not grow new action endpoints");
});

test("hardware view exposes grading trust evidence first", () => {
  const css = withoutComments(CSS);
  const js = withoutComments(JS);

  assert.match(css, /\.trust-readout\b/, "hardware trust readout styling must be served");
  assert.match(css, /\.trust-grid\b/, "hardware trust facts should be scannable");
  assert.match(css, /\.source-claim\.selected\b/, "selected source claims should have their own state");
  assert.match(css, /\.source-claim\.unreliable\b/, "known unreliable source claims should have their own state");
  assert.match(
    js,
    /hardwareTrustPanel\(d\),[\s\S]*machinePanel\(d\),[\s\S]*disagreementPanel\(d\)/,
    "Hardware should lead with trust evidence before raw facts",
  );
  assert.match(js, /d\.hardware\.basis/, "the readout must show the grading basis");
  assert.match(js, /d\.report\.vramSources/, "the readout must show source count evidence");
  assert.match(js, /d\.report\.disagreements\.length/, "the readout must show disagreement evidence");
  assert.match(js, /d\.report\.gpu\.selectedSource/, "the disagreement rows must identify the selected source");
  assert.match(js, /c\.knownUnreliable/, "known-unreliable claims must stay visible");
});

test("report view keeps shareable facts visibly bounded", () => {
  const css = withoutComments(CSS);
  const js = withoutComments(JS);
  const sharePanel = /function sharePanel\(d\) \{([\s\S]*?)\n\}/.exec(js);

  assert.match(css, /\.report-safety\b/, "report safety styling must be served");
  assert.match(css, /\.share-rows\b/, "shareable fields should render as rows, not one dense string");
  assert.match(css, /\.limit-item\b/, "report limits should be visibly bounded");
  assert.match(
    js,
    /reportSafetyPanel\(d\),[\s\S]*limitsPanel\(d\),[\s\S]*sharePanel\(d\)/,
    "Report should lead with safety context, then limits, then copyable fields",
  );
  assert.match(js, /Object\.keys\(d\.report\.exportable\)\.length/, "the safety readout should count only exportable fields");
  assert.match(js, /Object\.entries\(d\.report\.exportable\)/, "share rows must come from the exportable block");
  assert.match(js, /copyButton\(text, "Copy shareable summary"\)/, "copy action must use the same bounded text");
  assert.ok(sharePanel, "sharePanel must exist");
  assert.doesNotMatch(
    sharePanel[1],
    /d\.report\.(gpu|memory|appleMemory)\b/,
    "the share panel must not pull exact local specs into public copy",
  );
});

test("catalog has search, fit filters, and compact command actions", () => {
  const css = withoutComments(CSS);
  const js = withoutComments(JS);

  assert.match(css, /\.catalog-toolbar\b/, "catalog controls should have a stable layout");
  assert.match(css, /\.catalog-stats\b/, "catalog summary counts should be styled");
  assert.match(css, /\.catalog-table-wrap\b[\s\S]*max-height:/, "desktop catalog results should stay inside a bounded workspace");
  assert.match(css, /\.catalog-table-wrap\b[\s\S]*overflow:\s*auto/, "the bounded catalog must remain fully scrollable");
  assert.match(css, /\.catalog-table th\s*\{[\s\S]*position:\s*sticky/, "catalog headings should remain visible while scanning");
  assert.match(css, /\.icon-button\b/, "repeated command copies should use compact controls");
  assert.match(js, /let catalogFitFilter = "runs"/, "catalog should still default to runnable models");
  assert.match(js, /let catalogQuery = ""/, "catalog search should be stateful");
  assert.match(js, /mkFilter\("Runnable", "runs"/, "the default filter must say what the count means");
  assert.match(js, /search\.type = "search"/, "catalog needs a native search input");
  assert.match(js, /searchableModelText\(m\)\.includes\(query\)/, "search should inspect model decision text");
  assert.match(js, /tableWrap\.setAttribute\("role", "region"\)/, "the scrollable result region needs an accessible landmark");
  assert.match(js, /command\.title = m\.runCommand/, "truncated commands must remain inspectable");
  for (const key of ["comfortable", "tight", "partial", "too_large", "all"]) {
    assert.match(js, new RegExp('mkFilter\\("[^"]+", "' + key + '"'), `missing ${key} fit filter`);
  }
});

test("catalog search keeps focus across filtered repaints", () => {
  const js = withoutComments(JS);

  assert.match(js, /let catalogFocusSearch = false/, "search repaint focus state must be explicit");
  assert.match(js, /catalogFocusSearch = true;[\s\S]*renderView\(activeView\)/, "typing should request focus restoration");
  assert.match(js, /getElementById\("catalog-search"\)[\s\S]*setSelectionRange\(end, end\)/, "the restored search should keep the cursor usable");
});

test("Phase 4 loading and empty states communicate progress without pretending data exists", () => {
  const html = HTML("t".repeat(64));
  const css = withoutComments(CSS);
  const js = withoutComments(JS);

  assert.match(html, /class="loading-shell" role="status" aria-live="polite"/, "startup should announce a real loading state");
  assert.match(html, /class="loading-skeleton" aria-hidden="true"/, "decorative startup skeletons must stay out of the accessibility tree");
  assert.doesNotMatch(html, /<p class="loading">/, "startup should not fall back to a plain loading sentence");
  assert.match(css, /@keyframes skeletonShimmer/, "loading placeholders need a restrained shimmer");
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*\.skeleton-line::after[\s\S]*animation:\s*none/, "shimmer must stop for reduced-motion users");
  assert.match(js, /function inlineLoadingState\(label, rows\)/, "delayed local reads should share an accessible skeleton helper");
  assert.match(js, /inlineLoadingState\("Reading the ceiling's provenance", 2\)/, "hardware provenance should expose its pending state");
  assert.match(js, /inlineLoadingState\("Scanning local benchmark results", 2\)/, "benchmark discovery should expose its pending state");
  assert.match(js, /function emptyState\(message, iconName\)/, "known-empty results must remain visually distinct from pending results");
});

test("Phase 4 model loading reads as a connected selected-request-consequence pipeline", () => {
  const css = withoutComments(CSS);
  const js = withoutComments(JS);

  assert.match(css, /\.action-preview-card:not\(:last-child\)::after/, "pipeline steps need an explicit connector");
  assert.match(css, /\.action-step-head\b/, "each pipeline step needs a stable header");
  assert.match(css, /\.action-preview-card\.is-consequence\b/, "the consequence must carry the strongest visual emphasis");
  assert.match(js, /preview\.setAttribute\("role", "list"\)/, "the pipeline should expose its sequence semantically");
  assert.match(js, /preview\.setAttribute\("aria-label", "Load request pipeline"\)/, "the sequence needs an accessible name");
  assert.match(js, /card\.setAttribute\("role", "listitem"\)/, "each step should be a semantic list item");
  assert.match(js, /"01", "installed", "selected"/, "step one must identify the installed selection");
  assert.match(js, /"02", "load", "request"/, "step two must explain the exact request");
  assert.match(js, /"03", "activity", "consequence"/, "step three must foreground the residency consequence");
});

test("Phase 4 controls have restrained hover focus press and busy feedback", () => {
  const css = withoutComments(CSS);
  const js = withoutComments(JS);

  assert.match(css, /button:not\(:disabled\):hover\s*\{[\s\S]*transform:\s*translateY\(-1px\)/, "enabled buttons need visible hover lift");
  assert.match(css, /button:not\(:disabled\):active\s*\{[\s\S]*scale\(0\.985\)/, "button presses need immediate tactile feedback");
  assert.match(css, /select:hover, input:hover\s*\{[\s\S]*border-color:\s*var\(--view-border\)/, "pickers and filters need page-aware hover affordance");
  assert.match(css, /button:focus-visible, select:focus-visible, input:focus-visible\s*\{[\s\S]*outline:\s*2px solid var\(--view-accent\)/, "keyboard focus must remain unmistakable in every page palette");
  assert.match(css, /button\[data-busy="true"\]::before[\s\S]*animation:\s*busySpin/, "long actions need an inline busy indicator");
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*button\[data-busy="true"\]::before[\s\S]*animation:\s*none/, "busy feedback must remain useful without rotation");
  assert.match(js, /function setActionBusy\(trigger, busy\)/, "load and unload should share one busy-state contract");
  assert.match(js, /trigger\.setAttribute\("aria-busy", "true"\)/, "busy state must be exposed to assistive technology");
  assert.match(js, /status\.setAttribute\("aria-live", "polite"\)/, "load results should be announced without interrupting the user");
  assert.equal((js.match(/setActionBusy\(trigger, true\)/g) || []).length, 2, "both load and unload must enter the same busy state");
});
