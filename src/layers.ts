import type { Layer, LinkedFile, Psd } from "ag-psd";
import type { LayerInfo } from "./types.js";

/**
 * Recursively walks a PSD layer array and executes a callback
 * for each visited layer (depth-first order).
 *
 * If the callback explicitly returns `false`, traversal into that layer's
 * children is skipped. This lets you prune branches or short-circuit exploration.
 *
 * @param layers List of layers to traverse.
 * @param fn Callback invoked for each layer with the current layer and depth.
 * Return `false` to skip traversing that layer's children.
 * @param depth Starting depth (0 for root). Used internally during recursive
 * calls; keep the default value for normal usage.
 * @returns `void`.
 *
 * @example
 * ```ts
 * walkLayers(psd.children ?? [], (layer, depth) => {
 *   console.log(`${"  ".repeat(depth)}${layer.name ?? "(unnamed)"}`);
 * });
 * ```
 *
 * @example
 * ```ts
 * // Do not traverse hidden group contents
 * walkLayers(psd.children ?? [], (layer) => {
 *   if (layer.hidden && layer.children) return false;
 * });
 * ```
 */
export function walkLayers(
	layers: Layer[],
	fn: (layer: Layer, depth: number) => boolean | undefined,
	depth = 0,
): void {
	for (const layer of layers) {
		const result = fn(layer, depth);
		if (result !== false && layer.children) {
			walkLayers(layer.children, fn, depth + 1);
		}
	}
}

/**
 * Finds a layer by exact name in a PSD (first match, depth-first traversal).
 *
 * @param psd Target PSD document.
 * @param name Exact layer name to find (case-sensitive).
 * @returns The first matching layer, or `null` if no match is found.
 *
 * @example
 * ```ts
 * const titleLayer = findLayerByName(psd, "Title");
 * if (!titleLayer) {
 *   throw new Error("Layer Title not found");
 * }
 * ```
 */
export function findLayerByName(psd: Psd, name: string): Layer | null {
	let found: Layer | null = null;
	walkLayers(psd.children ?? [], (layer) => {
		if (layer.name === name) {
			found = layer;
			return false;
		}
	});
	return found;
}

/**
 * Resolves the `LinkedFile` associated with a smart object layer.
 *
 * A smart object exposes `layer.placedLayer.id`, which matches
 * `psd.linkedFiles[n].id`.
 *
 * @param psd PSD document containing the `linkedFiles` table.
 * @param layer Layer that may be a smart object.
 * @returns The matching `LinkedFile`, or `undefined` if the layer is not a
 * smart object or if the linked entry cannot be found.
 *
 * @example
 * ```ts
 * const layer = findLayerByName(psd, "Product Mockup");
 * if (layer) {
 *   const linked = getLinkedFile(psd, layer);
 *   console.log(linked?.name);
 * }
 * ```
 */
export function getLinkedFile(psd: Psd, layer: Layer): LinkedFile | undefined {
	if (!layer.placedLayer || !psd.linkedFiles) return undefined;
	return psd.linkedFiles.find((lf) => lf.id === layer.placedLayer!.id);
}

/**
 * Determines the semantic type of a layer for the `LayerInfo` shape.
 *
 * Condition order matters: for example, text is detected before group to keep
 * inspection output stable and predictable.
 *
 * @param layer Layer to classify.
 * @returns Semantic layer type (`text`, `image`, `smartObject`, `group`,
 * `adjustment`, or `other`).
 *
 * @example
 * ```ts
 * const type = getLayerType(layer);
 * if (type === "text") {
 *   console.log("Text layer detected");
 * }
 * ```
 */
export function getLayerType(layer: Layer): LayerInfo["type"] {
	if (layer.text) return "text";
	if (layer.children) return "group";
	if (layer.adjustment) return "adjustment";
	if (layer.placedLayer) return "smartObject";
	if (layer.canvas || layer.imageData) return "image";
	return "other";
}

/**
 * Builds a descriptive tree of every layer in the PSD.
 *
 * This representation is useful for discovering layer names, displaying an
 * inspection view in a UI, or validating replacement targets.
 *
 * @param psd PSD document to inspect.
 * @returns Array of `LayerInfo` entries representing root layers and descendants.
 *
 * @example
 * ```ts
 * const layers = inspectLayers(psd);
 * console.dir(layers, { depth: null });
 * ```
 */
export function inspectLayers(psd: Psd): LayerInfo[] {
	function buildTree(layers: Layer[]): LayerInfo[] {
		return layers.map((layer): LayerInfo => {
			const type = getLayerType(layer);
			const info: LayerInfo = {
				name: layer.name ?? "(unnamed)",
				type,
				bounds: {
					top: layer.top ?? 0,
					left: layer.left ?? 0,
					bottom: layer.bottom ?? 0,
					right: layer.right ?? 0,
				},
				visible: !layer.hidden,
				blendMode: layer.blendMode,
				opacity: layer.opacity,
			};

			if (layer.text) {
				info.textContent = layer.text.text;
			}

			// Resolve linked file name for smart objects
			const linkedFile = getLinkedFile(psd, layer);
			if (linkedFile) {
				info.linkedFileName = linkedFile.name;
			}

			if (layer.children) {
				info.children = buildTree(layer.children);
			}

			return info;
		});
	}

	return buildTree(psd.children ?? []);
}

/**
 * Prints the layer tree to standard output.
 *
 * Each line includes depth, detected type, layer name, a short text preview for
 * text layers, and linked resource info for smart objects.
 *
 * @param psd PSD document to print.
 * @returns `void`.
 *
 * @example
 * ```ts
 * const psd = readPsd(fs.readFileSync("template.psd"));
 * printLayerTree(psd);
 * ```
 */
export function printLayerTree(psd: Psd): void {
	walkLayers(psd.children ?? [], (layer, depth) => {
		const indent = "  ".repeat(depth);
		const type = getLayerType(layer);
		const name = layer.name ?? "(unnamed)";
		const text = layer.text ? ` → "${layer.text.text.slice(0, 40)}"` : "";
		const linkedFile = getLinkedFile(psd, layer);
		const linked = linkedFile ? ` [linked: ${linkedFile.name}]` : "";
		console.log(`${indent}[${type}] ${name}${text}${linked}`);
	});
}
