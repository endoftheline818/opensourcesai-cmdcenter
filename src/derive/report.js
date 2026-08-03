// Diagnostic report construction. Pure: data in, data out, no I/O, no clock.
//
// THE THREE INVARIANTS, inherited verbatim from the website's
// src/lib/checkerResultContract.js, each testable and each load-bearing:
//
// 1. PRIVACY — the `exportable` block contains only closed-vocabulary bands
//    from derive/bands.js, never a raw value and never caller-supplied text. A
//    report is therefore safe to paste into a public issue or forum thread even
//    though the local view shows exact figures.
// 2. DETERMINISM — same capture in, same report out, always. Nothing here reads
//    a clock or a random source; `generatedAt` is caller-supplied.
// 3. NO TRANSMISSION — this module builds a value. It performs no I/O and ships
//    no upload path. Whether reports are ever transmitted is a separate,
//    already-gated decision, and leaving the capability out keeps that decision
//    from being made by accident.

import { REPORT_CONTRACT_VERSION } from "../version.js";
import { nameplateGb, toGb, toGib } from "../units.js";
import { appleUsableMemoryGb, gpuVendorClass, memoryBand, APPLE_USABLE_MEMORY_FRACTION } from "./bands.js";
import { collectClaims, corroboration, findDisagreements, selectPrimaryGpu } from "./vram.js";

function buildAppleMemory(capture) {
  const macos = capture.gpu?.macos;
  const totalBytes = macos?.sysctlHwMemsize?.totalBytes;
  if (!totalBytes) return null;

  const totalGb = nameplateGb(totalBytes);
  const usableGb = appleUsableMemoryGb(totalGb);

  // Cross-check sysctl (exact bytes) against system_profiler (whole GB), which
  // is the only corroboration available on this platform.
  const profilerGb = macos.systemProfiler?.parsedGb ?? null;
  const sourcesAgree = profilerGb == null ? null : Math.abs(totalGb - profilerGb) <= 1;

  return {
    chip: typeof macos.chip === "string" ? macos.chip : null,
    totalMemoryGb: totalGb,
    // The figure that actually governs what fits. Banding the sticker total
    // instead would overstate capacity by the 25% macOS withholds — on a base
    // 8 GB Mac that is the difference between the lt-8 and 8-11 tiers.
    usableModelMemoryGb: usableGb,
    usableFraction: APPLE_USABLE_MEMORY_FRACTION,
    sourcesAgree,
  };
}

function buildOllama(capture) {
  const ollama = capture.ollama ?? {};
  const loaded = (ollama.loadedModels ?? []).map((m) => ({
    name: m.name,
    sizeGb: toGb(m.sizeBytes),
    sizeVramGb: toGb(m.sizeVramBytes),
    // The most product-relevant runtime number available: below 100% the model
    // is running partly on CPU, typically at a small fraction of the speed.
    vramResidentPercent: m.sizeBytes ? Math.round((m.sizeVramBytes / m.sizeBytes) * 100) : null,
  }));

  return {
    // API reachability, NOT binary discovery, is the authoritative
    // installed-signal — `which` fails on perfectly working installs whose
    // PATH the current shell does not carry.
    installed: Boolean(ollama.apiReachable),
    apiReachable: Boolean(ollama.apiReachable),
    version: ollama.apiVersion ?? ollama.cliVersion ?? null,
    binaryPath: ollama.binaryPath ?? null,
    installedModelCount: ollama.installedModels?.length ?? null,
    loadedModels: loaded,
    modelStore: ollama.modelStore
      ? {
          path: ollama.modelStore.path,
          exists: ollama.modelStore.exists,
          freeGb: ollama.modelStore.freeBytes != null ? toGb(ollama.modelStore.freeBytes) : null,
          totalGb: ollama.modelStore.totalBytes != null ? toGb(ollama.modelStore.totalBytes) : null,
        }
      : null,
  };
}

/** Facts the report deliberately declines to assert on this machine. */
function buildLimits(capture, { apple, primary, corroborated }) {
  const limits = [];

  if (!apple && !primary) {
    limits.push("No discrete-GPU VRAM figure available from any source on this machine.");
  }
  if (primary && corroborated.independentSources < 2) {
    limits.push(
      `VRAM is reported by exactly one independent source (${corroborated.sources[0]}) — ` +
        "there is nothing available to cross-check it against on this platform.",
    );
  }
  if (apple && apple.sourcesAgree === false) {
    limits.push("sysctl and system_profiler disagree on total memory; neither is authoritative.");
  }
  if (capture.platform?.isWsl) {
    limits.push("Running under WSL — GPU passthrough and Ollama's host differ from bare metal.");
  }
  if (!capture.ollama?.apiReachable) {
    limits.push("Ollama's API was unreachable, so no runtime or model facts were collected.");
  }
  return limits;
}

/**
 * @param {object} capture Raw output of src/collect.
 * @param {object} [options]
 * @param {string} [options.generatedAt] Caller-supplied ISO timestamp. This
 *   module never reads the clock — see invariant 2.
 */
export function buildReport(capture, { generatedAt = null } = {}) {
  const claims = collectClaims(capture.gpu ?? {});
  const disagreements = findDisagreements(claims);
  const corroborated = corroboration(claims);
  const primary = selectPrimaryGpu(capture.gpu ?? {});
  const apple = buildAppleMemory(capture);

  const systemMemoryBytes = capture.system?.memory?.nodeTotalmem?.bytes ?? null;

  // Apple: band the USABLE figure, not the sticker total.
  // Everything else: band the NAMEPLATE figure, not the raw reported value.
  const vramBand = apple
    ? memoryBand(apple.usableModelMemoryGb)
    : primary
      ? memoryBand(nameplateGb(primary.vramBytes))
      : "unknown";

  const vendorLabel = apple ? (apple.chip ?? "Apple") : (primary?.name ?? "");

  return {
    reportContractVersion: REPORT_CONTRACT_VERSION,
    generatedAt,
    platform: {
      os: capture.platform?.nodePlatform ?? null,
      arch: capture.platform?.nodeArch ?? null,
      release: capture.platform?.osRelease ?? null,
      distro: capture.platform?.distro ?? null,
      isWsl: capture.platform?.isWsl ?? false,
    },
    cpu: {
      model: capture.system?.cpu?.nodeOsCpus?.model ?? null,
      logicalCount: capture.system?.cpu?.nodeOsCpus?.logicalCount ?? null,
    },
    memory: {
      totalGb: systemMemoryBytes ? toGb(systemMemoryBytes) : null,
      totalGib: systemMemoryBytes ? toGib(systemMemoryBytes) : null,
    },
    gpu: primary
      ? {
          name: primary.name,
          vramGb: toGb(primary.vramBytes),
          vramGib: toGib(primary.vramBytes),
          nameplateGb: nameplateGb(primary.vramBytes),
          selectedSource: primary.source,
        }
      : null,
    appleMemory: apple,
    vramSources: { claims: claims.length, ...corroborated },
    disagreements,
    ollama: buildOllama(capture),
    limits: buildLimits(capture, { apple, primary, corroborated }),

    // INVARIANT 1: everything in this block is a closed-vocabulary band. This
    // is the only part of a report that may leave the machine.
    exportable: {
      gpu_vendor: gpuVendorClass(vendorLabel),
      vram_band: vramBand,
      ram_band: systemMemoryBytes ? memoryBand(nameplateGb(systemMemoryBytes)) : "unknown",
    },
  };
}
