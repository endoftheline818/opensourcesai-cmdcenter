import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { CSS, HTML, JS, TOKENS } from "../src/serve/ui.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tokens = async () =>
  JSON.parse(await readFile(path.join(root, "fixtures", "website-design-tokens.json"), "utf8"));
const tokens_ = tokens;

function withoutComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

// BRAND PARITY GUARD.
//
// The dashboard is meant to read as part of opensourcesai.com, which means its
// palette is not a design choice made here — it is a copy of the site's, and a
// copy without a guard drifts the moment the site is restyled. The fixture is
// PARSED from the site's own stylesheet by scripts/sync-from-website.mjs, so
// this pins colour-for-colour against the real thing.
//
// If this fails, the site changed. Re-run the sync script in a deliberate
// commit — do not edit the expectations until they pass.
test("dashboard colours match the website's tokens exactly, both modes", async () => {
  const fixture = await tokens();

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

// THIS TEST PREVIOUSLY ENFORCED A CLAIM THAT BECAME FALSE.
//
// It asserted the interface says "Read-only". Phase 2 opened load and unload,
// so the badge was still promising something the tool no longer honoured — a
// stale trust claim, kept alive by a passing test. Caught from a screenshot,
// not from the suite, which is the point: a test can only protect a property
// someone remembered to restate when the property changed.
//
// The guarantee that still holds, and the one a user actually cares about, is
// that nothing is downloaded or destroyed. That is what the badge now says.
test("the interface states the CURRENT guarantee, not a stale one", () => {
  const html = HTML("t".repeat(64));
  assert.match(html, /Load \/ unload only/, "the badge must state what the tool actually does");
  assert.match(html, /never pulls, deletes or removes/, "the standing guarantee belongs in the interface");
  assert.doesNotMatch(
    html,
    /">Read-only</,
    "the read-only badge is no longer true — Phase 2 opened load and unload",
  );
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
  assert.match(js, /overviewSummaryPanel\(d\),[\s\S]*livePanelShell\("gauges"/, "summary must lead Overview");
  assert.match(js, /renderSummaryLive\(live\)/, "live telemetry should update the summary");
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
  assert.match(css, /\.icon-button\b/, "repeated command copies should use compact controls");
  assert.match(js, /let catalogFitFilter = "runs"/, "catalog should still default to runnable models");
  assert.match(js, /let catalogQuery = ""/, "catalog search should be stateful");
  assert.match(js, /search\.type = "search"/, "catalog needs a native search input");
  assert.match(js, /searchableModelText\(m\)\.includes\(query\)/, "search should inspect model decision text");
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
