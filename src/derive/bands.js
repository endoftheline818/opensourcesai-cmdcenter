// Closed-vocabulary hardware bands — a FIXTURE-VERIFIED COPY of the website's
// src/lib/hardwareTelemetry.js and src/lib/appleMemory.js.
//
// WHY A COPY AND NOT AN IMPORT
// Discovery-spec §8 decision 4: for Phase 0 the engine is shared as a
// fixture-verified copy rather than an extracted package — the approach already
// proven by the mobile app. This repository has a hard boundary with the
// website and never imports from it (that is asserted in test/package.test.js).
//
// WHAT KEEPS THE COPY HONEST
// test/bands.test.js pins every value below against the parity fixture in
// fixtures/website-bands-parity.json, which records what the website's modules
// exported when this copy was taken. If the website changes a band edge or the
// Apple fraction, the fixture is re-pinned in a deliberate commit — the copy is
// never allowed to drift silently.
//
// THE INVARIANT WORTH PRESERVING (inherited verbatim from the website module):
// no function here can return caller-supplied text. Every return value is one
// of the constants declared below, chosen by inspecting the input and never by
// echoing it. That is what makes a report safe to paste in public.

export const PARITY_SOURCE = {
  repository: "opensourcesai.com",
  modules: ["src/lib/hardwareTelemetry.js", "src/lib/appleMemory.js"],
  takenAt: "2026-08-02",
};

export const GPU_VENDORS = ["nvidia", "amd", "apple", "intel", "other", "none"];

// Bands mirror the VRAM tiers the site publishes as
// /hardware/<n>gb-vram-local-llm/, so telemetry buckets and content buckets
// stay comparable.
export const MEMORY_BANDS = [
  "unknown",
  "lt-8",
  "8-11",
  "12-15",
  "16-23",
  "24-31",
  "32-47",
  "48-plus",
];

// Ordered: first match wins, so more specific patterns lead. Apple's M-series
// uses word boundaries because a bare "m" appears in many GPU names
// ("Radeon RX 6800M") and must not be read as Apple silicon.
const VENDOR_PATTERNS = [
  ["nvidia", /\b(nvidia|geforce|rtx|gtx|quadro|tesla|titan|[ah]100|l40s?)\b/i],
  ["amd", /\b(amd|radeon|rx\s*\d|vega|instinct|mi\d{2,3})\b/i],
  ["apple", /\b(apple|m[1-9](\s*(pro|max|ultra))?)\b/i],
  ["intel", /\b(intel|arc|iris|uhd|xe)\b/i],
];

export function gpuVendorClass(label) {
  if (typeof label !== "string") return "none";
  const trimmed = label.trim();
  if (!trimmed) return "none";
  for (const [vendor, pattern] of VENDOR_PATTERNS) {
    if (pattern.test(trimmed)) return vendor;
  }
  return "other";
}

export function memoryBand(value) {
  const gb = typeof value === "number" ? value : Number.parseFloat(value);
  if (!Number.isFinite(gb) || gb <= 0) return "unknown";
  if (gb < 8) return "lt-8";
  if (gb < 12) return "8-11";
  if (gb < 16) return "12-15";
  if (gb < 24) return "16-23";
  if (gb < 32) return "24-31";
  if (gb < 48) return "32-47";
  return "48-plus";
}

// Apple Silicon shares ONE unified-memory pool between CPU, GPU and the rest of
// the system, and macOS caps how much an AI process may allocate at roughly 75%
// (Metal's recommendedMaxWorkingSetSize). Usable model memory is therefore
// materially less than the sticker figure. It is NOT discrete VRAM and NOT 100%
// of unified memory.
export const APPLE_USABLE_MEMORY_FRACTION = 0.75;

export function appleUsableMemoryGb(totalGb) {
  const n = Number(totalGb);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * APPLE_USABLE_MEMORY_FRACTION);
}
