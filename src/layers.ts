import type { Layer, LinkedFile, Psd } from "ag-psd";
import type { LayerInfo } from "./types.js";

/**
 * Recursively walk all layers in a PSD and call `fn` on each.
 * Returns early (stops walking that branch) if `fn` returns `false`.
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
 * Find a layer by exact name (first match, depth-first).
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
 * Resolve the LinkedFile for a smart object layer.
 * Smart object layers have a `placedLayer.id` that matches a `LinkedFile.id`
 * in `psd.linkedFiles`.
 */
export function getLinkedFile(psd: Psd, layer: Layer): LinkedFile | undefined {
	if (!layer.placedLayer || !psd.linkedFiles) return undefined;
	return psd.linkedFiles.find((lf) => lf.id === layer.placedLayer!.id);
}

/**
 * Determine the semantic type of a layer for the LayerInfo descriptor.
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
 * Build a human-readable tree of all layers — handy for discovering names.
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
 * Pretty-print the layer tree to stdout — useful during development.
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
