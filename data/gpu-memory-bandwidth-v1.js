// GENERATED FILE — DO NOT EDIT. Re-run the sync script instead.
// (Yes, even though this file is not named *.generated.js — the matcher module
// imports it by exactly this name, so the name is load-bearing and stays.)
//
// A byte-exact copy of opensourcesai-bench's data/gpu-memory-bandwidth-v1.js: the
// manufacturer-sourced GPU memory-bandwidth table, provenance rules included.
// Entries exist only where a manufacturer source with an archive snapshot
// exists — an absent entry deliberately makes roofline utilization read
// "unavailable" rather than inviting a guess, and figures from memory,
// secondary databases, or bus-width arithmetic are refused upstream by policy.
//
// The citation URLs below are PROVENANCE DATA, never fetched. Nothing in this
// package makes an outbound call — the no-transmission guards over src/ are
// unaffected by data that merely records where a number came from.
//
//   source      opensourcesai-bench data/gpu-memory-bandwidth-v1.js (client 0.11.0)
//   sha256      414383285b511c3c535b99124a16a36ffbcaf959490150ebf2dac012a341f880
//   copied      2026-08-07
//   regenerate  node scripts/sync-from-bench.mjs ../opensourcesai-bench
//
// The digest covers everything below the marker — the upstream bytes,
// LF-normalized — and test/bandwidth.test.js recomputes it.
// @generated:begin-verbatim
/*
 * REQUIRES HUMAN VERIFICATION BEFORE RELEASE.
 *
 * Source hierarchy, in preference order:
 *   1. Architecture whitepaper
 *   2. Product specification page
 *   3. Official NVIDIA technical article or newsroom post that states the
 *      bandwidth figure verbatim — archive snapshot required
 *   4. Otherwise omit the entry
 *
 * Tier 3 is weaker than tiers 1–2 because article/newsroom URLs are less
 * durable and are not primarily specification surfaces. Every tier-3 entry
 * must record sourceTier: 3 and an archive snapshot. Every entry, at every
 * tier, must include sourceTier plus source.archiveUrl and source.archiveDate.
 *
 * Do not add values from memory, secondary databases, retailer listings, or
 * calculated bus width and data rate. An absent entry intentionally makes
 * roofline utilization unavailable while preserving throughput reporting.
 */
export const GPU_MEMORY_BANDWIDTH_TABLE = Object.freeze({
  schemaVersion: "osai-gpu-memory-bandwidth/2",
  releaseStatus: "requires-human-verification",
  units: "GB/s",
  entries: Object.freeze([
    Object.freeze({
      id: "nvidia-geforce-rtx-3080-10gb",
      match: Object.freeze({
        detectionNames: Object.freeze(["NVIDIA GeForce RTX 3080"]),
        nominalVramMiB: 10240,
        vramToleranceMiB: 256,
      }),
      memoryBandwidthGBps: 760,
      sourceTier: 1,
      source: Object.freeze({
        manufacturer: "NVIDIA",
        title: "NVIDIA Ampere GA102 GPU Architecture",
        url: "https://www.nvidia.com/content/PDF/nvidia-ampere-ga-102-gpu-architecture-whitepaper-v2.1.pdf",
        locator: "Table 2, GeForce RTX 3080 10 GB, Memory Bandwidth",
        archiveUrl:
          "https://web.archive.org/web/20230620221827/https://www.nvidia.com/content/PDF/nvidia-ampere-ga-102-gpu-architecture-whitepaper-v2.1.pdf",
        archiveDate: "2023-06-20",
      }),
    }),
    Object.freeze({
      id: "nvidia-geforce-rtx-4070-ti-12gb",
      match: Object.freeze({
        detectionNames: Object.freeze(["NVIDIA GeForce RTX 4070 Ti"]),
        nominalVramMiB: 12288,
        vramToleranceMiB: 256,
      }),
      memoryBandwidthGBps: 504,
      sourceTier: 3,
      source: Object.freeze({
        manufacturer: "NVIDIA",
        title:
          "New GeForce RTX 50 Series Graphics Cards & Laptops Powered By NVIDIA Blackwell Bring Game-Changing AI and Neural Rendering Capabilities To Gamers and Creators",
        url: "https://www.nvidia.com/en-us/geforce/news/rtx-50-series-graphics-cards-gpu-laptop-announcements/",
        locator:
          'Section "GeForce RTX 5070 Ti: 2X Faster Than The GeForce RTX 4070 Ti", first paragraph: "RTX 4070 Ti’s 504 GB/sec"',
        archiveUrl:
          "https://web.archive.org/web/20250115035359/https://www.nvidia.com/en-us/geforce/news/rtx-50-series-graphics-cards-gpu-laptop-announcements/",
        archiveDate: "2025-01-15",
      }),
    }),
  ]),
});
