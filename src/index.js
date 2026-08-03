// Public surface. Kept deliberately small: the collection boundary, the pure
// report builder, the renderer, and the version constants.

export { collect } from "./collect/index.js";
export { buildReport } from "./derive/report.js";
export { renderReport } from "./derive/render.js";
export {
  CLIENT_VERSION,
  CAPTURE_SCHEMA_VERSION,
  REPORT_CONTRACT_VERSION,
} from "./version.js";
export {
  APPLE_USABLE_MEMORY_FRACTION,
  GPU_VENDORS,
  MEMORY_BANDS,
  appleUsableMemoryGb,
  gpuVendorClass,
  memoryBand,
} from "./derive/bands.js";
export { nameplateGb, toGb, toGib } from "./units.js";
