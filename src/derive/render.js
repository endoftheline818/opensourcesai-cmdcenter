// Human-readable rendering of a report. Pure: string in, string out.
//
// Two audiences, one output. Locally it is a diagnostic; pasted into an issue
// it is evidence. So it shows exact values for the reader's own machine AND the
// banded `exportable` block, with the distinction stated rather than implied.

const label = (text, value) => `  ${String(text).padEnd(26)} ${value}`;

export function renderReport(report) {
  const lines = [];

  lines.push("OpenSourcesAI Command Center — machine diagnostic");
  lines.push("=".repeat(64));
  lines.push(`  report contract v${report.reportContractVersion}${report.generatedAt ? ` · ${report.generatedAt}` : ""}`);

  lines.push("\nPLATFORM");
  lines.push(label("os", `${report.platform.os} ${report.platform.release} (${report.platform.arch})`));
  if (report.platform.distro) lines.push(label("distro", report.platform.distro));
  if (report.platform.isWsl) lines.push(label("wsl", "yes"));
  lines.push(label("cpu", `${report.cpu.model ?? "unknown"} (${report.cpu.logicalCount ?? "?"} logical)`));
  lines.push(label("system memory", report.memory.totalGb != null ? `${report.memory.totalGb} GB` : "unknown"));

  if (report.appleMemory) {
    lines.push("\nAPPLE UNIFIED MEMORY");
    lines.push(label("chip", report.appleMemory.chip ?? "unknown"));
    lines.push(label("total", `${report.appleMemory.totalMemoryGb} GB`));
    lines.push(
      label(
        "usable for models",
        `${report.appleMemory.usableModelMemoryGb} GB  (${report.appleMemory.usableFraction * 100}% — macOS reserves the rest)`,
      ),
    );
    if (report.appleMemory.sourcesAgree != null) {
      lines.push(label("sources agree", report.appleMemory.sourcesAgree ? "yes" : "NO"));
    }
  } else {
    lines.push("\nGPU");
    if (!report.gpu) {
      lines.push("  no VRAM figure available from any source");
    } else {
      lines.push(label("name", report.gpu.name));
      lines.push(label("vram", `${report.gpu.vramGib} GiB (${report.gpu.vramGb} GB) → ${report.gpu.nameplateGb} GB nameplate`));
      lines.push(label("source", report.gpu.selectedSource));
      lines.push(label("corroborated by", `${report.vramSources.independentSources} independent source(s)`));
    }
  }

  if (report.disagreements.length) {
    lines.push("\n*** SOURCE DISAGREEMENTS ***");
    for (const d of report.disagreements) {
      lines.push(`  ${d.card}: ${d.spreadGib} GiB spread (${d.ratio}x)`);
      for (const c of d.claims) {
        lines.push(`      ${c.source} = ${c.gib} GiB${c.knownUnreliable ? "   [known-unreliable source]" : ""}`);
      }
    }
  }

  lines.push("\nOLLAMA");
  if (!report.ollama.installed) {
    // Two different absences. A dead endpoint is "not detected"; an endpoint
    // that DEMANDS CREDENTIALS is running something — just not bare Ollama,
    // which has no authentication. Conflating them reports a working machine
    // as broken. The limits section carries the full explanation.
    lines.push(
      label(
        "status",
        report.ollama.apiAuthRequired
          ? "endpoint demands authentication — not bare Ollama (a gateway or proxy?)"
          : "not detected (API unreachable)",
      ),
    );
  } else {
    lines.push(label("version", report.ollama.version ?? "unknown"));
    lines.push(label("installed models", report.ollama.installedModelCount ?? "unknown"));
    lines.push(label("loaded models", report.ollama.loadedModels.length));
    for (const m of report.ollama.loadedModels) {
      // Context rides beside residency because it is the lever: the same
      // weights load as a different allocation at a different context length.
      const ctx = m.contextLength === null || m.contextLength === undefined ? "" : `, ${m.contextLength} ctx`;
      const spill = m.spilledGb === null || m.spilledGb === undefined ? "" : `, ${m.spilledGb} GB on CPU`;
      lines.push(
        label(`  ${m.name}`, `${m.sizeVramGb}/${m.sizeGb} GB in VRAM (${m.vramResidentPercent}% resident${ctx}${spill})`),
      );
    }
    if (report.ollama.modelStore) {
      lines.push(label("model store", report.ollama.modelStore.path));
      if (report.ollama.modelStore.freeGb != null) {
        lines.push(label("  free / total", `${report.ollama.modelStore.freeGb} / ${report.ollama.modelStore.totalGb} GB`));
      }
    }
  }

  lines.push("\nSHAREABLE SUMMARY (safe to paste in public — bands only, no exact specs)");
  for (const [key, value] of Object.entries(report.exportable)) {
    lines.push(label(key, value));
  }

  if (report.limits.length) {
    lines.push("\nWHAT THIS REPORT DOES NOT CLAIM");
    for (const limit of report.limits) lines.push(`  - ${limit}`);
  }

  return lines.join("\n");
}
