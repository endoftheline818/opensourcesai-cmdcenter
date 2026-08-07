// This machine's memory-bandwidth ceiling. Pure: no I/O, no clock.
//
// THE RESOLUTION RULES ARE NOT WRITTEN HERE. Name matching, VRAM tolerance,
// ambiguity-is-unavailable, the provenance bar an entry must clear, and the
// manual-override path all come from ./bench-gpu-bandwidth.generated.js — a
// byte-exact copy of bench's matcher, importing a byte-exact copy of bench's
// manufacturer-sourced table (data/gpu-memory-bandwidth-v1.js). Bench and
// Command Center resolving bandwidth differently would give the same GPU two
// different ceilings; sharing the pair verbatim closes that. This module is
// only the join between the copied resolver and this package's own capture
// shape.
//
// WHY THE CAPTURE AND NOT THE REPORT: the matcher wants raw VRAM BYTES — its
// tolerance windows are stated in MiB against what the vendor tool actually
// reported (an RTX 4070 Ti says 12282 MiB, not 12288). The report carries
// display figures (GB, GiB, nameplate); rounding before matching would defeat
// the tolerance logic's whole reason for existing. selectPrimaryGpu already
// makes the source-preference call, so the two layers cannot disagree about
// WHICH GPU is being resolved.
//
// THE MANUAL PATH is the honest escape hatch for the table's deliberate
// narrowness (entries exist only where a manufacturer source with an archive
// snapshot exists). A caller-supplied figure wins and is labelled
// source: "manual" — provenance travels with the number, and a manual figure
// can never masquerade as a manufacturer-sourced one. Where the figure is
// stored between sessions, and the UI that collects it, are the consuming
// surface's concern, not this layer's.

import { selectPrimaryGpu } from "./vram.js";

export {
  GPU_MEMORY_BANDWIDTH_TABLE,
  matchGpuMemoryBandwidth,
  resolveGpuMemoryBandwidth,
} from "./bench-gpu-bandwidth.generated.js";

import { resolveGpuMemoryBandwidth } from "./bench-gpu-bandwidth.generated.js";

/**
 * Resolve the bandwidth ceiling for the machine a capture describes.
 *
 * Returns bench's resolution shape untouched — {memoryBandwidthGBps, source,
 * tableVersion, entryId} — plus the gpu the resolution was attempted against,
 * so a renderer can say "no sourced figure for <name>" instead of a bare
 * unavailable. All-null fields mean exactly what they mean in bench: no
 * trustworthy figure exists, and utilization must render unavailable rather
 * than guessed (derive/measurements.js already refuses on a null ceiling).
 *
 * @param {object} capture Raw output of src/collect.
 * @param {object} [options]
 * @param {number|null} [options.manualGBps] A user-supplied figure. Wins over
 *   the table, labelled source: "manual" by the copied resolver itself.
 */
export function resolveCaptureBandwidth(capture, { manualGBps = null } = {}) {
  const primary = selectPrimaryGpu(capture?.gpu ?? {});
  const resolution = resolveGpuMemoryBandwidth({
    manualGBps,
    model: primary?.name ?? null,
    totalVramBytes: primary?.vramBytes ?? null,
  });
  return {
    ...resolution,
    gpu: primary ? { name: primary.name, source: primary.source } : null,
  };
}
