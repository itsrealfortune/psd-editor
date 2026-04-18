// Main class
export { PsdTemplate } from "./template.js";

// Types
export type {
  TextReplacement,
  ImageReplacement,
  TemplateReplacements,
  ExportOptions,
  LayerInfo,
} from "./types.js";

// Utilities (useful for advanced use cases)
export { walkLayers, findLayerByName, inspectLayers, printLayerTree } from "./layers.js";
