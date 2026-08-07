// GENERATED FILE — DO NOT EDIT. Re-run the sync script instead.
//
// A byte-exact copy of opensourcesai-bench's src/derivation/gpu-bandwidth.js. Its one import
// — "../../data/gpu-memory-bandwidth-v1.js" — resolves in this repository by construction,
// because the table is copied alongside it under the same filename at the same
// relative depth. That is what lets this file stay verbatim: nothing is
// rewritten, so it can be verified by `diff` against the source.
//
// WHAT THIS MODULE IS. The single definition of how a detected GPU resolves to
// a manufacturer-sourced bandwidth figure: name normalization, VRAM-tolerance
// matching, ambiguity-is-unavailable, and the provenance bar an entry must
// clear before it may ever be used (manufacturer source + archive snapshot).
// It also carries the manual-override path — a caller-supplied figure wins and
// is recorded as source: "manual", never laundered into a table match. Bench
// and Command Center resolving bandwidth differently would mean the same GPU
// gets two different ceilings; sharing the module verbatim closes that.
//
//   source      opensourcesai-bench src/derivation/gpu-bandwidth.js (client 0.11.0)
//   sha256      9b47507bd130190c8ac97c91007c922033ccdba1f7277e52df291fe866762b1c
//   copied      2026-08-07
//   regenerate  node scripts/sync-from-bench.mjs ../opensourcesai-bench
//
// The digest covers everything below the marker — the upstream bytes,
// LF-normalized — and test/bandwidth.test.js recomputes it.
// @generated:begin-verbatim
import { GPU_MEMORY_BANDWIDTH_TABLE } from "../../data/gpu-memory-bandwidth-v1.js";

function normalizeDetectionName(value) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").toLowerCase()
    : null;
}

function matchesVram(entry, totalVramBytes) {
  const nominalMiB = entry.match?.nominalVramMiB;
  if (!Number.isFinite(nominalMiB)) return true;
  if (!Number.isFinite(totalVramBytes) || totalVramBytes <= 0) return false;
  const toleranceMiB = Number.isFinite(entry.match?.vramToleranceMiB)
    ? entry.match.vramToleranceMiB
    : 0;
  const detectedMiB = totalVramBytes / 1024 ** 2;
  return Math.abs(detectedMiB - nominalMiB) <= toleranceMiB;
}

function hasDurableManufacturerSource(entry) {
  const source = entry?.source;
  return (
    Number.isInteger(entry?.sourceTier) &&
    entry.sourceTier >= 1 &&
    entry.sourceTier <= 3 &&
    typeof source?.manufacturer === "string" &&
    source.manufacturer.length > 0 &&
    typeof source?.title === "string" &&
    source.title.length > 0 &&
    typeof source?.url === "string" &&
    source.url.startsWith("https://") &&
    typeof source?.locator === "string" &&
    source.locator.length > 0 &&
    typeof source?.archiveUrl === "string" &&
    /^https:\/\/web\.archive\.org\/web\/\d{14}\//.test(source.archiveUrl) &&
    typeof source?.archiveDate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(source.archiveDate)
  );
}

export function matchGpuMemoryBandwidth(
  { model, totalVramBytes },
  table = GPU_MEMORY_BANDWIDTH_TABLE,
) {
  const detectedName = normalizeDetectionName(model);
  if (!detectedName || !Array.isArray(table?.entries)) return null;

  const matches = table.entries.filter((entry) => {
    const names = entry.match?.detectionNames ?? [];
    return (
      hasDurableManufacturerSource(entry) &&
      names.some((name) => normalizeDetectionName(name) === detectedName) &&
      matchesVram(entry, totalVramBytes)
    );
  });

  // Ambiguity is unavailable, never a plausible guess.
  return matches.length === 1 ? matches[0] : null;
}

export function resolveGpuMemoryBandwidth(
  { manualGBps = null, model = null, totalVramBytes = null },
  table = GPU_MEMORY_BANDWIDTH_TABLE,
) {
  if (Number.isFinite(manualGBps) && manualGBps > 0) {
    return {
      memoryBandwidthGBps: manualGBps,
      source: "manual",
      tableVersion: null,
      entryId: null,
    };
  }

  const match = matchGpuMemoryBandwidth({ model, totalVramBytes }, table);
  if (!match) {
    return {
      memoryBandwidthGBps: null,
      source: null,
      tableVersion: table?.schemaVersion ?? null,
      entryId: null,
    };
  }

  return {
    memoryBandwidthGBps: match.memoryBandwidthGBps,
    source: "manufacturer-table",
    tableVersion: table.schemaVersion,
    entryId: match.id,
  };
}

export { GPU_MEMORY_BANDWIDTH_TABLE };

export const __test = { hasDurableManufacturerSource };
