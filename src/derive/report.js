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
import { appleUsableMemoryFraction, appleUsableMemoryGb, gpuVendorClass, memoryBand } from "./bands.js";
import { collectClaims, corroboration, findDisagreements, selectPrimaryGpu } from "./vram.js";

/**
 * Is this capture from Apple Silicon, as opposed to any Mac?
 *
 * collect/gpu.js runs the macOS collector on every Mac, and `hw.memsize` is
 * present on all of them. Only Apple Silicon shares that pool with its GPU. On
 * an Intel Mac the same figure is ordinary system RAM, and treating it as
 * unified memory graded a 16 GB Haswell MacBook Pro as if it had 10.7 GB of
 * GPU memory (found on a real 2015 MacBook Pro, 0.4.0).
 *
 * The chip string decides when the capture has one: Apple Silicon reports
 * "Apple M1" and so on, and under Rosetta the x86 view of the same chip still
 * names Apple ("VirtualApple" on early releases), while every Intel Mac
 * reports an "Intel(R) Core(TM) ..." string. Only when that read failed does
 * the Node architecture decide, and then only arm64 counts.
 */
export function isAppleSiliconCapture(capture) {
  const macos = capture.gpu?.macos;
  if (!macos) return false;
  if (typeof macos.chip === "string" && macos.chip.trim()) return /apple/i.test(macos.chip);
  return capture.platform?.nodeArch === "arm64";
}

/** A Mac that is not Apple Silicon: its memory is system RAM, not unified. */
function isIntelMac(capture) {
  return Boolean(capture.gpu?.macos) && !isAppleSiliconCapture(capture);
}

function buildAppleMemory(capture) {
  if (!isAppleSiliconCapture(capture)) return null;
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
    // instead would overstate capacity by the share macOS withholds (a third on
    // a base 8 GB Mac), which is the difference between the lt-8 and 8-11 tiers.
    usableModelMemoryGb: usableGb,
    // Two-thirds up to 36 GB, three-quarters above (see bands.js).
    usableFraction: appleUsableMemoryFraction(totalGb),
    sourcesAgree,
  };
}

/**
 * An auth-shaped API error. collect/ollama.js records a refused probe as the
 * string "http <status>"; 401/403/407 from the configured endpoint is a
 * specific finding, because Ollama's local API never demands credentials —
 * whatever answered is a gateway or reverse proxy standing in front of it
 * (gateways hand out client configs that point OLLAMA_HOST at the proxy).
 * Naming that beats reporting a running machine as "not detected", and it
 * matters for provenance too: a proxy can route requests to another machine
 * entirely, so measurements taken through one could describe hardware this
 * tool has never seen.
 */
function authShapedError(apiError) {
  return /^http (401|403|407)$/.test(apiError ?? "");
}

function buildOllama(capture) {
  const ollama = capture.ollama ?? {};
  const loaded = (ollama.loadedModels ?? []).map((m) => {
    // The most product-relevant runtime number available: below 100% the model
    // is running partly on CPU, typically at a small fraction of the speed.
    const residency = m.sizeBytes ? Math.round((m.sizeVramBytes / m.sizeBytes) * 100) : null;
    const spilled = residency !== null && residency < 100;
    return {
      name: m.name,
      sizeGb: toGb(m.sizeBytes),
      sizeVramGb: toGb(m.sizeVramBytes),
      vramResidentPercent: residency,
      // The spill quantified, and the context length behind it — the same
      // weights are a different allocation at a different context, so the two
      // belong side by side. contextLength is null where the capture (or an
      // older Ollama) did not carry it: unknown, never 0.
      spilledGb: spilled ? toGb(m.sizeBytes - m.sizeVramBytes) : null,
      contextLength: m.contextLength ?? null,
    };
  });

  return {
    // API reachability, NOT binary discovery, is the authoritative
    // installed-signal — `which` fails on perfectly working installs whose
    // PATH the current shell does not carry.
    installed: Boolean(ollama.apiReachable),
    apiReachable: Boolean(ollama.apiReachable),
    // True when the endpoint refused with an auth-shaped status: the thing
    // answering is not bare Ollama. See authShapedError().
    apiAuthRequired: !ollama.apiReachable && authShapedError(ollama.apiError),
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
  if (isIntelMac(capture) && !primary) {
    limits.push(
      "Intel Mac: memory is ordinary system RAM, not Apple unified memory, and this tool does not " +
        "read the Mac's graphics card, so everything is graded as CPU/RAM offload. A Mac with a " +
        "discrete AMD GPU can do better than that on models that fit its VRAM.",
    );
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
    if (authShapedError(capture.ollama?.apiError)) {
      limits.push(
        "The configured endpoint demands authentication, which Ollama's local API never does — " +
          "OLLAMA_HOST likely points at a gateway or proxy. Point this tool at the real Ollama " +
          "endpoint: a proxy can route requests to a different machine, so nothing measured " +
          "through one is a fact about this hardware.",
      );
    } else {
      limits.push("Ollama's API was unreachable, so no runtime or model facts were collected.");
    }
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
