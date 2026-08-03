// Reconciliation of VRAM claims. Pure functions over a raw capture.
//
// The output that matters here is not "the VRAM figure" — it is the list of
// places where two sources contradict each other, because that is what tells a
// user (and us) whether the number can be trusted at all.

import { GIB, toGb, toGib } from "../units.js";

// Tolerance is applied in BYTES, never in a converted unit. The original spike
// used a 5% window purely to paper over its own GiB-vs-GB confusion; with units
// handled correctly the threshold can be tight, because any remaining spread is
// a genuine hardware-reporting contradiction rather than a rounding artifact.
const DISAGREEMENT_TOLERANCE = 0.02;

const normalizeName = (s) =>
  (s ?? "").toLowerCase().replace(/\(r\)|\(tm\)|\s+/g, " ").trim();

/**
 * Flatten every source's VRAM claim into a comparable list. Each claim carries
 * bytes; nothing else is ever compared.
 */
export function collectClaims(gpu = {}) {
  const claims = [];

  for (const g of gpu.nvidiaSmi?.gpus ?? []) {
    claims.push({ source: "nvidia-smi", name: g.name, vramBytes: g.vramBytes });
  }

  const cim = gpu.windows?.win32VideoController;
  if (Array.isArray(cim)) {
    for (const g of cim) {
      if (g.adapterRamBytes != null) {
        claims.push({
          source: "Win32_VideoController.AdapterRAM",
          name: g.name,
          vramBytes: g.adapterRamBytes,
          // Flagged at the point of capture so a consumer never has to
          // rediscover the 32-bit saturation ceiling for itself.
          knownUnreliable: true,
        });
      }
    }
  }

  const registry = gpu.windows?.displayClassRegistry;
  if (Array.isArray(registry)) {
    for (const g of registry) {
      if (g.vramBytes != null) {
        claims.push({ source: "registry qwMemorySize", name: g.name, vramBytes: g.vramBytes });
      }
    }
  }

  const sysfs = gpu.linux?.sysfsDrm;
  if (Array.isArray(sysfs)) {
    for (const g of sysfs) {
      claims.push({ source: `sysfs ${g.card}`, name: g.card, vramBytes: g.vramBytes });
    }
  }

  return claims;
}

/** Groups claims per physical card and reports contradictions. */
export function findDisagreements(claims) {
  const byCard = new Map();
  for (const claim of claims) {
    const key = normalizeName(claim.name);
    if (!byCard.has(key)) byCard.set(key, []);
    byCard.get(key).push(claim);
  }

  const disagreements = [];
  for (const [card, list] of byCard) {
    if (list.length < 2) continue;
    const values = list.map((c) => c.vramBytes);
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (max > 0 && (max - min) / max > DISAGREEMENT_TOLERANCE) {
      disagreements.push({
        card,
        spreadBytes: max - min,
        spreadGib: Number(((max - min) / GIB).toFixed(2)),
        ratio: Number((max / Math.max(min, 1)).toFixed(2)),
        claims: list.map((c) => ({
          source: c.source,
          gib: toGib(c.vramBytes),
          gb: toGb(c.vramBytes),
          knownUnreliable: Boolean(c.knownUnreliable),
        })),
      });
    }
  }
  return disagreements;
}

/**
 * Pick the most trustworthy discrete-GPU VRAM figure available.
 *
 * Preference order is by CORROBORATION, not convenience:
 *   1. nvidia-smi — a vendor tool reporting its own hardware.
 *   2. display-class registry — 64-bit and vendor-neutral. Verified equal to
 *      nvidia-smi on NVIDIA; unproven on AMD/Intel, so it ranks second.
 *   3. amdgpu sysfs — kernel-reported, but only present for AMD.
 * Win32_VideoController.AdapterRAM is never selected: it saturates at 4 GiB.
 */
export function selectPrimaryGpu(gpu = {}) {
  const nvidia = gpu.nvidiaSmi?.gpus?.[0];
  if (nvidia?.vramBytes) {
    return { name: nvidia.name, vramBytes: nvidia.vramBytes, source: "nvidia-smi" };
  }

  const registry = Array.isArray(gpu.windows?.displayClassRegistry)
    ? gpu.windows.displayClassRegistry.find((g) => !g.likelyIntegrated && g.vramBytes != null)
    : null;
  if (registry) {
    return { name: registry.name, vramBytes: registry.vramBytes, source: "registry qwMemorySize" };
  }

  const sysfs = Array.isArray(gpu.linux?.sysfsDrm) ? gpu.linux.sysfsDrm[0] : null;
  if (sysfs?.vramBytes) {
    return { name: sysfs.card, vramBytes: sysfs.vramBytes, source: `sysfs ${sysfs.card}` };
  }

  return null;
}

/**
 * How many independent sources corroborate this machine's VRAM figure.
 *
 * Worth reporting explicitly because the platforms differ sharply and it is
 * counter-intuitive: Windows exposes three sources (which is how its broken one
 * was caught), while Linux-on-NVIDIA exposes exactly one — nvidia-smi — with no
 * way to check it against anything. Fewest sources is not the same as most
 * reliable, and a report that hid this would imply more confidence than exists.
 */
export function corroboration(claims) {
  const distinct = new Set(claims.filter((c) => !c.knownUnreliable).map((c) => c.source));
  return { independentSources: distinct.size, sources: [...distinct] };
}
