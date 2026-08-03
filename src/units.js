// Memory unit handling. Pure functions, no I/O.
//
// WHY THIS IS ITS OWN MODULE
// Unit confusion produced two separate defects during the Phase 0 detection
// spike, and both of them were invisible until measured on real hardware:
//
// 1. THE COMPARISON BUG. The spike divided nvidia-smi's MiB by 1024 (giving
//    GiB) and a registry value's bytes by 1e9 (giving decimal GB), then
//    compared the two numbers and reported a 3x "disagreement" between a card
//    and itself. Every memory figure in this package is therefore carried as
//    BYTES from the moment it is captured, and converted only for display.
//    Nothing compares two figures that are not both bytes.
//
// 2. THE BAND-BOUNDARY BUG, which is the subtler and more damaging one.
//    Vendors report slightly LESS than nameplate — an RTX 4070 Ti reports
//    12282 MiB, not 12288, because part of the framebuffer is reserved. So the
//    raw GiB value is 11.99, which trips a `< 12` tier boundary and grades a
//    12 GB card into the 8-11 GB tier: it would be told it cannot run models it
//    runs comfortably today. Rounding to the nearest whole GiB recovers 12, the
//    number the owner would have typed in themselves.
//
//    This only bites cards whose nameplate sits exactly ON a tier edge
//    (12/16/24/32/48 GB — the 4070 Ti, 4080, 3090, 4090 and most of the
//    enthusiast tier). It was verified falsifiably rather than assumed: a 10 GB
//    RTX 3080 sits mid-tier, all three unit treatments agree there, and the
//    defect does not reproduce — which is exactly why casual testing on one
//    mid-band card would have shipped it.
//
// Apple Silicon is deliberately absent from this reasoning. It has no discrete
// VRAM to under-report, and `sysctl hw.memsize` returns an exact power-of-two
// total, so the nameplate problem has no equivalent there. See derive/report.js.

export const MIB = 1024 * 1024;
export const GIB = 1024 * 1024 * 1024;

/** Binary gigabytes (what an OS or vendor tool usually means by "GB"). */
export function toGib(bytes) {
  if (!Number.isFinite(bytes)) return null;
  return Number((bytes / GIB).toFixed(2));
}

/** Decimal gigabytes (what a spec sheet usually means by "GB"). */
export function toGb(bytes) {
  if (!Number.isFinite(bytes)) return null;
  return Number((bytes / 1e9).toFixed(2));
}

/**
 * The figure a human would call this much memory — i.e. what they would type
 * into a compatibility checker. Rounding to the nearest whole GiB recovers the
 * nameplate from a vendor's slightly-under-reported total.
 *
 * This is the ONLY treatment that may feed a tier/band decision. See the
 * band-boundary note above for why the raw value must not.
 */
export function nameplateGb(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return null;
  return Math.round(bytes / GIB);
}

/** Convenience for probes that natively report MiB (nvidia-smi does). */
export function mibToBytes(mib) {
  if (!Number.isFinite(mib)) return null;
  return mib * MIB;
}
