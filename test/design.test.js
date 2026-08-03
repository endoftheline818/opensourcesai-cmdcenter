import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { CSS, HTML, TOKENS } from "../src/serve/ui.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tokens = async () =>
  JSON.parse(await readFile(path.join(root, "fixtures", "website-design-tokens.json"), "utf8"));

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

test("structural tokens match the website", async () => {
  const fixture = await tokens();
  assert.equal(TOKENS.radiusCard, fixture.structural["radius-card"]);
  assert.equal(TOKENS.radiusFrame, fixture.structural["radius-frame"]);
  assert.equal(TOKENS.content, fixture.structural.content);
});

test("both colour schemes are actually emitted into the stylesheet", async () => {
  const fixture = await tokens();
  // A token object that is never referenced by the CSS would pass the parity
  // test above while changing nothing on screen, so assert the values reach
  // the served stylesheet too.
  assert.match(CSS, /prefers-color-scheme:\s*light/, "the light theme must be served");
  assert.ok(CSS.includes(fixture.dark["color-primary"]), "dark primary missing from CSS");
  assert.ok(CSS.includes(fixture.light["color-primary"]), "light primary missing from CSS");
  assert.ok(CSS.includes(fixture.dark["color-bg"]), "dark background missing from CSS");
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

test("read-only is stated in the interface, not just in the docs", () => {
  const html = HTML("t".repeat(64));
  assert.match(html, /Read-only/, "the read-only guarantee must be visible to the user");
});
