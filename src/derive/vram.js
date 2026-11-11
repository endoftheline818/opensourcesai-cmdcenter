// Reconciliation of VRAM claims. Pure functions over a raw capture.
//
// The output that matters here is not "the VRAM figure" — it is the list of
// places where two sources contradict each other, because that is what tells a
// user (and us) whether the number can be trusted at all.

import { GIB, MIB, toGb, toGib } from "../units.js";

/**
 * Bytes from a system_profiler VRAM string ("1536 MB", "4 GB"), or null.
 * macOS states these in binary units: the 2015 MacBook Pro's Iris Pro reports
 * "1536 MB", which is 1.5 GiB.
 */
export function parseMacVramBytes(raw) {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(MB|GB)\s*$/i.exec(raw ?? "");
  if (!match) return null;
  const value = Number(match[1]);
  if (!(value > 0)) return null;
  return Math.round(value * (match[2].toUpperCase() === "GB" ? GIB : MIB));
}

/**
 * Discrete GPUs on an Intel Mac: an entry that reports its own VRAM
 * (`spdisplays_vram`) and is not on the built-in bus. Integrated graphics
 * report `spdisplays_vram_shared` instead, which is system RAM, and are never
 * counted. Both conditions are required on purpose: missing a discrete card
 * grades the Mac as CPU-only, which understates it, while counting a shared
 * figure as VRAM would overstate it, and only the first is safe.
 */
export function macDiscreteGpus(gpu = {}) {
  const displays = Array.isArray(gpu.macos?.displays) ? gpu.macos.displays : [];
  return displays
    .filter((d) => d.bus !== "spdisplays_builtin" && d.vramRaw)
    .map((d) => ({ name: d.model, vramBytes: parseMacVramBytes(d.vramRaw) }))
    .filter((d) => d.vramBytes);
}

/** The first integrated GPU's name on a Mac, for the report's own wording. */
export function macIntegratedGpuName(gpu = {}) {
  const displays = Array.isArray(gpu.macos?.displays) ? gpu.macos.displays : [];
  return displays.find((d) => d.bus === "spdisplays_builtin" && !d.vramRaw)?.model ?? null;
}

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

  for (const g of macDiscreteGpus(gpu)) {
    claims.push({ source: "system_profiler", name: g.name, vramBytes: g.vramBytes });
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
 *   4. system_profiler on an Intel Mac — the only source macOS offers, so it
 *      is never corroborated. The largest discrete card wins.
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

  const mac = macDiscreteGpus(gpu).sort((a, b) => b.vramBytes - a.vramBytes)[0];
  if (mac) {
    return { name: mac.name, vramBytes: mac.vramBytes, source: "system_profiler" };
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
