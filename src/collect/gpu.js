// GPU / video-memory collection. Returns RAW per-source captures and does not
// reconcile them — reconciliation is a pure function in src/derive/vram.js.
//
// THE DESIGN RULE: every source is captured, and none is discarded for
// disagreeing. On Windows that is the entire point — the obvious API is wrong
// in a way only a second source can reveal.

import os from "node:os";
import path from "node:path";
import fsp from "node:fs/promises";
import { run, powershellJson } from "./exec.js";
import { mibToBytes } from "../units.js";

const DISPLAY_CLASS_GUID = "{4d36e968-e325-11ce-bfc1-08002be10318}";

/**
 * nvidia-smi is frequently absent from PATH on Windows even when the driver is
 * perfectly healthy — it ships into System32 or the driver directory. Probing
 * only PATH reports "no NVIDIA GPU" on machines that plainly have one.
 */
async function findNvidiaSmi() {
  if (process.platform !== "win32") return "nvidia-smi";
  const candidates = [
    "nvidia-smi",
    path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "nvidia-smi.exe"),
    "C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe",
  ];
  for (const candidate of candidates) {
    const res = await run(candidate, ["--version"], { timeout: 4000 });
    if (res.ok) return candidate;
  }
  return null;
}

export async function collectNvidiaSmi() {
  const bin = await findNvidiaSmi();
  if (!bin) {
    return { available: false, reason: "nvidia-smi not on PATH or in known driver locations" };
  }
  const res = await run(
    bin,
    ["--query-gpu=index,name,memory.total,memory.used,driver_version", "--format=csv,noheader,nounits"],
    { timeout: 8000 },
  );
  if (!res.ok) return { available: false, reason: res.error };

  const gpus = res.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [index, name, totalMib, usedMib, driver] = line.split(",").map((s) => s.trim());
      return {
        index: Number(index),
        name,
        vramBytes: mibToBytes(Number(totalMib)),
        vramUsedBytes: mibToBytes(Number(usedMib)),
        driver,
      };
    });
  return { available: true, gpus };
}

async function collectWindows() {
  const out = {};

  // Win32_VideoController.AdapterRAM is a uint32 and SATURATES at 4 GiB, so a
  // 12 GiB card reports ~4 GiB. Captured precisely BECAUSE it is wrong: it is
  // the most obvious API, so the report has to be able to show that it is
  // contradicted rather than silently preferring something else.
  const cim = await powershellJson(
    "@(Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion,PNPDeviceID) | ConvertTo-Json -Compress",
  );
  out.win32VideoController = cim.ok
    ? cim.value.map((c) => ({
        name: c.Name,
        adapterRamBytes: c.AdapterRAM ?? null,
        driver: c.DriverVersion,
        // PCI vendor id classifies hardware without trusting a marketing string.
        pciVendorId: /VEN_([0-9A-F]{4})/i.exec(c.PNPDeviceID ?? "")?.[1]?.toUpperCase() ?? null,
      }))
    : { error: cim.error };

  // The display-class registry's qwMemorySize is 64-bit, so it does not
  // saturate, and it is vendor-neutral — making it the candidate path for AMD
  // and Intel Arc on Windows, where no vendor CLI exists.
  //
  // VERIFIED ONLY AGAINST NVIDIA, where nvidia-smi provided a ground truth to
  // check it against (it matched exactly). It is UNPROVEN for the non-NVIDIA
  // hardware it primarily exists to serve. Do not promote it to authoritative
  // for AMD/Intel without a second source on that hardware.
  const registry = await powershellJson(
    `$b='HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\${DISPLAY_CLASS_GUID}'; ` +
      "@(Get-ChildItem $b -ErrorAction SilentlyContinue | ForEach-Object { " +
      "$p = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue; " +
      "if ($p.DriverDesc) { [pscustomobject]@{ DriverDesc=$p.DriverDesc; " +
      "QwMemorySize=$p.'HardwareInformation.qwMemorySize' } } }) | ConvertTo-Json -Compress",
  );
  out.displayClassRegistry = registry.ok
    ? registry.value.map((r) => {
        const bytes = r.QwMemorySize == null ? null : Number(r.QwMemorySize);
        return {
          name: r.DriverDesc,
          vramBytes: bytes,
          // An absent qwMemorySize is itself signal rather than a failure:
          // integrated parts share system RAM and have no dedicated pool.
          likelyIntegrated: bytes == null,
        };
      })
    : { error: registry.error };

  return out;
}

async function collectLinux() {
  const out = {};

  const lspci = await run("lspci", ["-nn"]);
  out.lspci = lspci.ok
    ? {
        displayDevices: lspci.stdout
          .split("\n")
          .filter((l) => /VGA compatible|3D controller|Display controller/i.test(l))
          .map((l) => l.trim()),
      }
    : { error: lspci.error };

  // AMD exposes true VRAM through sysfs with no tooling required. This node
  // does NOT exist under NVIDIA's proprietary driver, which is why an NVIDIA
  // Linux box ends up with exactly one VRAM source and no cross-check at all —
  // the opposite of the Windows situation.
  try {
    const cards = (await fsp.readdir("/sys/class/drm")).filter((d) => /^card\d+$/.test(d));
    const sysfs = [];
    for (const card of cards) {
      const total = await fsp
        .readFile(`/sys/class/drm/${card}/device/mem_info_vram_total`, "utf8")
        .catch(() => null);
      if (!total) continue;
      const vendor = await fsp
        .readFile(`/sys/class/drm/${card}/device/vendor`, "utf8")
        .catch(() => null);
      sysfs.push({
        card,
        vramBytes: Number(total.trim()),
        pciVendorId: vendor?.trim().replace(/^0x/, "").toUpperCase() ?? null,
      });
    }
    out.sysfsDrm = sysfs.length
      ? sysfs
      : { note: "no mem_info_vram_total nodes (expected on the NVIDIA proprietary driver)" };
  } catch (err) {
    out.sysfsDrm = { error: String(err.message).slice(0, 160) };
  }

  const rocm = await run("rocm-smi", ["--showmeminfo", "vram", "--json"]);
  out.rocmSmi = rocm.ok ? { raw: rocm.stdout.slice(0, 2000) } : { error: rocm.error };

  return out;
}

/**
 * Apple Silicon has NO discrete VRAM. CPU and GPU share one unified-memory
 * pool, so "which source reports VRAM correctly" is the wrong question here.
 * The right one is how much of the single pool is usable for a model, which
 * derive/report.js answers via the 75% fraction — not a hardware read.
 *
 * `sysctl hw.memsize` is exact bytes and present on every Mac with no
 * entitlements required, so it is the ground truth; system_profiler is captured
 * as an independent cross-check. On the tested M1 they agreed exactly.
 */
async function collectMacos() {
  const out = {};

  const memsize = await run("sysctl", ["-n", "hw.memsize"]);
  out.sysctlHwMemsize = memsize.ok
    ? { totalBytes: Number(memsize.stdout.trim()) }
    : { error: memsize.error };

  // machdep.cpu.brand_string reports "Apple M1" etc. Apple kept the sysctl name
  // from the x86 era even though these are ARM cores.
  const chip = await run("sysctl", ["-n", "machdep.cpu.brand_string"]);
  out.chip = chip.ok ? chip.stdout.trim() : { error: chip.error };

  const profiler = await run("system_profiler", ["SPHardwareDataType", "-json"], { timeout: 15000 });
  if (profiler.ok) {
    try {
      const parsed = JSON.parse(profiler.stdout);
      const raw = parsed?.SPHardwareDataType?.[0]?.physical_memory ?? null;
      const match = /^([\d.]+)\s*GB$/i.exec(raw ?? "");
      out.systemProfiler = { physicalMemoryRaw: raw, parsedGb: match ? Number(match[1]) : null };
    } catch {
      out.systemProfiler = { error: "unparseable system_profiler json" };
    }
  } else {
    out.systemProfiler = { error: profiler.error };
  }

  return out;
}

export async function collectGpu() {
  const gpu = { nvidiaSmi: await collectNvidiaSmi() };
  if (process.platform === "win32") gpu.windows = await collectWindows();
  else if (process.platform === "linux") gpu.linux = await collectLinux();
  else if (process.platform === "darwin") gpu.macos = await collectMacos();
  return gpu;
}

export async function collectPlatform() {
  const out = {
    nodePlatform: process.platform,
    nodeArch: process.arch,
    nodeVersion: process.version,
    osRelease: os.release(),
  };
  if (process.platform === "linux") {
    const release = await fsp.readFile("/etc/os-release", "utf8").catch(() => null);
    out.distro = release?.match(/^PRETTY_NAME="?([^"\n]+)/m)?.[1] ?? null;
    const procVersion = (await fsp.readFile("/proc/version", "utf8").catch(() => null)) ?? "";
    // WSL matters: GPU passthrough and Ollama's host both differ from bare metal.
    out.isWsl = /microsoft/i.test(procVersion);
  }
  return out;
}

export async function collectSystem() {
  const cpus = os.cpus();
  const system = {
    cpu: { nodeOsCpus: { model: cpus[0]?.model?.trim() ?? null, logicalCount: cpus.length } },
    memory: { nodeTotalmem: { bytes: os.totalmem() } },
  };

  if (process.platform === "linux") {
    const cpuinfo = await fsp.readFile("/proc/cpuinfo", "utf8").catch(() => null);
    if (cpuinfo) {
      system.cpu.procCpuinfo = {
        model: cpuinfo.match(/^model name\s*:\s*(.+)$/m)?.[1]?.trim() ?? null,
      };
    }
    const meminfo = await fsp.readFile("/proc/meminfo", "utf8").catch(() => null);
    const kb = Number(meminfo?.match(/^MemTotal:\s+(\d+) kB/m)?.[1] ?? 0);
    if (kb) system.memory.procMeminfo = { bytes: kb * 1024 };
  }

  if (process.platform === "win32") {
    const cim = await powershellJson(
      "@(Get-CimInstance Win32_ComputerSystem | Select-Object TotalPhysicalMemory) | ConvertTo-Json -Compress",
    );
    const bytes = Number(cim.value?.[0]?.TotalPhysicalMemory ?? 0);
    if (bytes) system.memory.win32ComputerSystem = { bytes };
  }

  return system;
}
