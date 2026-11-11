import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { extractMacDisplays } from "../src/collect/gpu.js";
import { buildReport } from "../src/derive/report.js";
import { renderReport } from "../src/derive/render.js";
import { macDiscreteGpus, macIntegratedGpuName, parseMacVramBytes } from "../src/derive/vram.js";
import { resolveGradingHardware } from "../src/serve/routes.js";
import { GIB, MIB } from "../src/units.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = async (name) =>
  JSON.parse(await readFile(path.join(root, "fixtures", `${name}.json`), "utf8"));

// The GPU-level keys of `system_profiler SPDisplaysDataType -json` exactly as the
// 2015 MacBook Pro (Iris Pro, no discrete GPU) printed them on macOS 15.5. The
// attached-monitor record is replaced by sentinels: the real one carried the
// panel's EDID and IDs, which is precisely what extraction must drop.
const IRIS_PRO_OUTPUT = {
  SPDisplaysDataType: [
    {
      _name: "kHW_IntelIrisProItem",
      _spdisplays_vram: "1536 MB",
      "spdisplays_device-id": "0x0d26",
      spdisplays_ndrvs: [
        {
          _IODisplayEDID: "SENTINEL-EDID",
          _name: "Color LCD",
          "_spdisplays_display-serial-number": "SENTINEL-SERIAL",
          _spdisplays_displayID: "SENTINEL-DISPLAY-ID",
        },
      ],
      "spdisplays_revision-id": "0x0008",
      spdisplays_vendor: "Intel",
      spdisplays_vram_shared: "1536 MB",
      sppci_bus: "spdisplays_builtin",
      sppci_device_type: "spdisplays_gpu",
      sppci_model: "Intel Iris Pro",
    },
  ],
};

// NOT A REAL CAPTURE. No Intel Mac with a discrete GPU was available. This entry
// uses the keys macOS reports for a discrete card (its own `spdisplays_vram`, on
// the PCIe bus rather than the built-in one) so the selection logic can be tested;
// replace it with a real capture when one exists.
const DISCRETE_AMD_ENTRY = {
  model: "AMD Radeon Pro 560X",
  vendor: "sppci_vendor_amd",
  bus: "spdisplays_pcie_device",
  deviceType: "spdisplays_gpu",
  vramRaw: "4 GB",
  vramSharedRaw: null,
};

test("extraction keeps the GPU fields and drops every attached-monitor field", () => {
  const displays = extractMacDisplays(IRIS_PRO_OUTPUT);
  assert.deepEqual(displays, [
    {
      model: "Intel Iris Pro",
      vendor: "Intel",
      bus: "spdisplays_builtin",
      deviceType: "spdisplays_gpu",
      vramRaw: null,
      vramSharedRaw: "1536 MB",
    },
  ]);
  assert.doesNotMatch(JSON.stringify(displays), /SENTINEL|ndrvs|EDID/i);
});

test("extraction degrades to an empty list, never a throw", () => {
  assert.deepEqual(extractMacDisplays(null), []);
  assert.deepEqual(extractMacDisplays({}), []);
  assert.deepEqual(extractMacDisplays({ SPDisplaysDataType: "nope" }), []);
  assert.deepEqual(extractMacDisplays({ SPDisplaysDataType: [{ _name: "kHW_X" }] }), [
    { model: "kHW_X", vendor: null, bus: null, deviceType: null, vramRaw: null, vramSharedRaw: null },
  ]);
});

test("system_profiler VRAM strings are binary units", () => {
  assert.equal(parseMacVramBytes("1536 MB"), 1536 * MIB);
  assert.equal(parseMacVramBytes("4 GB"), 4 * GIB);
  assert.equal(parseMacVramBytes("8GB"), 8 * GIB);
  assert.equal(parseMacVramBytes(" 0.5 GB "), 0.5 * GIB);
  for (const bad of [null, "", "0 MB", "lots", "4 TB", "-2 GB"]) {
    assert.equal(parseMacVramBytes(bad), null, `${bad} must not parse`);
  }
});

test("shared memory is never counted as VRAM; only a discrete card is", () => {
  const iris = { macos: { displays: extractMacDisplays(IRIS_PRO_OUTPUT) } };
  assert.deepEqual(macDiscreteGpus(iris), [], "an integrated chip's shared RAM is not VRAM");
  assert.equal(macIntegratedGpuName(iris), "Intel Iris Pro");

  const both = { macos: { displays: [...iris.macos.displays, DISCRETE_AMD_ENTRY] } };
  assert.deepEqual(macDiscreteGpus(both), [{ name: "AMD Radeon Pro 560X", vramBytes: 4 * GIB }]);

  // Either condition alone is not enough: a built-in entry with a VRAM key, and
  // an off-bus entry without one, both stay out.
  const builtinWithVram = { ...DISCRETE_AMD_ENTRY, bus: "spdisplays_builtin" };
  const offBusShared = { ...DISCRETE_AMD_ENTRY, vramRaw: null, vramSharedRaw: "1536 MB" };
  assert.deepEqual(macDiscreteGpus({ macos: { displays: [builtinWithVram, offBusShared] } }), []);

  // A failed read is an error object, not a list.
  assert.deepEqual(macDiscreteGpus({ macos: { displays: { error: "timeout" } } }), []);
});

test("intel mac with integrated graphics: CPU/RAM offload, and the chip is named", async () => {
  const report = buildReport(await fixture("macos-intel-iris-pro-16gb"));

  assert.equal(report.appleMemory, null);
  assert.equal(report.gpu, null, "integrated graphics have no VRAM to report");
  assert.equal(report.exportable.vram_band, "unknown");
  assert.equal(report.exportable.ram_band, "16-23");
  assert.ok(report.limits.some((l) => /^Intel Mac: the only graphics found is Intel Iris Pro/.test(l)));
  assert.equal(resolveGradingHardware(report).basis, "cpu-only");
});

test("intel mac with a discrete card is graded on that card's VRAM", async () => {
  const capture = await fixture("macos-intel-iris-pro-16gb");
  capture.gpu.macos.displays = [...capture.gpu.macos.displays, DISCRETE_AMD_ENTRY];
  const report = buildReport(capture);

  assert.equal(report.appleMemory, null);
  assert.equal(report.gpu.name, "AMD Radeon Pro 560X");
  assert.equal(report.gpu.nameplateGb, 4);
  assert.equal(report.gpu.selectedSource, "system_profiler");
  assert.equal(report.exportable.gpu_vendor, "amd");
  assert.equal(report.exportable.vram_band, "lt-8");

  // One source and nothing to check it against: the report has to say so.
  assert.ok(report.limits.some((l) => /exactly one independent source \(system_profiler\)/.test(l)));
  assert.ok(!report.limits.some((l) => /^Intel Mac:/.test(l)), "no CPU-only claim once a card is found");

  const hardware = resolveGradingHardware(report);
  assert.equal(hardware.basis, "discrete-vram-nameplate");
  assert.equal(hardware.vramGb, 4);
  assert.doesNotThrow(() => renderReport(report));
});

test("apple silicon ignores display data and keeps the unified-memory path", async () => {
  const capture = await fixture("macos-m1-8gb");
  // What an M1 lists: the chip itself, on the built-in bus, with no VRAM key.
  capture.gpu.macos.displays = [
    { model: "Apple M1", vendor: "sppci_vendor_Apple", bus: "spdisplays_builtin", deviceType: "spdisplays_gpu", vramRaw: null, vramSharedRaw: null },
  ];
  const report = buildReport(capture);
  assert.equal(report.gpu, null);
  assert.equal(report.appleMemory.usableModelMemoryGb, 5.3);
  assert.equal(report.exportable.vram_band, "lt-8");
  assert.equal(report.exportable.gpu_vendor, "apple");
});

test("an intel mac whose display read failed keeps the could-not-read wording", async () => {
  const capture = await fixture("macos-intel-iris-pro-16gb");
  capture.gpu.macos.displays = { error: "timeout" };
  const report = buildReport(capture);
  assert.ok(report.limits.some((l) => /graphics card could not be read/.test(l)));
});
