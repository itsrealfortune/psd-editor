import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { Layer, Psd } from "ag-psd";
import { readPsd, writePsdBuffer } from "ag-psd";
import "ag-psd/initialize-canvas";

import sharp from "sharp";
import {
	findLayerByName,
	getLinkedFile,
	inspectLayers,
	printLayerTree,
} from "./layers.js";
import type {
	ExportOptions,
	ImageReplacement,
	TemplateReplacements,
	TextReplacement,
} from "./types.js";

// ─── Text replacements ────────────────────────────────────────────────────────

/**
 * Applies a list of text replacements to text layers in a PSD.
 *
 * For each entry:
 * - the layer is resolved by exact name;
 * - text content is replaced;
 * - optional font size/color are applied to both the main style and
 *   `styleRuns` to avoid per-run style overrides.
 *
 * Non-blocking issues (missing layer or wrong layer type) are logged and
 * processing continues for remaining replacements.
 *
 * @param psd PSD document to mutate in memory.
 * @param replacements Text replacement entries to apply.
 * @returns `void`.
 *
 * @example
 * ```ts
 * applyTextReplacements(psd, [
 *   { layerName: "Title", text: "Summer Collection" },
 *   {
 *     layerName: "Price",
 *     text: "$29.90",
 *     fontSize: 48,
 *     color: [255, 255, 255],
 *   },
 * ]);
 * ```
 */
function applyTextReplacements(
	psd: Psd,
	replacements: TextReplacement[],
): void {
	for (const rep of replacements) {
		const layer = findLayerByName(psd, rep.layerName);

		if (!layer) {
			console.warn(
				`[psd-template] ⚠ Text layer "${rep.layerName}" not found — skipping.`,
			);
			continue;
		}
		if (!layer.text) {
			console.warn(
				`[psd-template] ⚠ Layer "${rep.layerName}" is not a text layer — skipping.`,
			);
			continue;
		}

		layer.text.text = rep.text;

		if (rep.fontSize !== undefined || rep.color !== undefined) {
			layer.text.style = layer.text.style ?? {};

			if (rep.fontSize !== undefined) {
				layer.text.style.fontSize = rep.fontSize;
			}
			if (rep.color !== undefined) {
				layer.text.style.fillColor = {
					r: rep.color[0],
					g: rep.color[1],
					b: rep.color[2],
				};
			}

			// Keep every styleRun in sync so per-run overrides don't win
			if (layer.text.styleRuns) {
				for (const run of layer.text.styleRuns) {
					if (!run.style) continue;
					if (rep.fontSize !== undefined) run.style.fontSize = rep.fontSize;
					if (rep.color !== undefined) {
						run.style.fillColor = {
							r: rep.color[0],
							g: rep.color[1],
							b: rep.color[2],
						};
					}
				}
			}
		}

		console.log(
			`[psd-template] ✓ Text "${rep.layerName}" → "${rep.text.slice(0, 40)}"`,
		);
	}
}

// ─── Image replacements ───────────────────────────────────────────────────────

/**
 * Applies image replacements to bitmap and smart object layers.
 *
 * The source image is resized with `sharp` to the layer bounds, then injected
 * into an `ag-psd`-compatible `canvas`. For smart objects, associated
 * `LinkedFile` bytes are also replaced (PNG), preserving final PSD -> PNG output.
 *
 * @param psd PSD document to mutate in memory.
 * @param replacements Image replacement entries to apply.
 * @returns A promise that resolves when all replacements are complete.
 *
 * @example
 * ```ts
 * await applyImageReplacements(psd, [
 *   { layerName: "Hero", imagePath: "./assets/hero.jpg", fit: "cover" },
 *   { layerName: "Logo", imagePath: "./assets/logo.png", fit: "contain" },
 * ]);
 * ```
 */
async function applyImageReplacements(
	psd: Psd,
	replacements: ImageReplacement[],
): Promise<void> {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const { createCanvas, createImageData } =
		require("canvas") as typeof import("canvas");

	const sharpFit: Record<string, keyof sharp.FitEnum> = {
		cover: "cover",
		contain: "contain",
		stretch: "fill",
	};

	for (const rep of replacements) {
		const layer = findLayerByName(psd, rep.layerName);

		if (!layer) {
			console.warn(
				`[psd-template] ⚠ Image layer "${rep.layerName}" not found — skipping.`,
			);
			continue;
		}

		const w = (layer.right ?? 0) - (layer.left ?? 0);
		const h = (layer.bottom ?? 0) - (layer.top ?? 0);

		if (w <= 0 || h <= 0) {
			console.warn(
				`[psd-template] ⚠ Layer "${rep.layerName}" has zero bounds — skipping.`,
			);
			continue;
		}

		const fit = rep.fit ?? "cover";

		const resized = sharp(rep.imagePath).resize(w, h, {
			fit: sharpFit[fit],
			position: "center",
		});

		// Build a node-canvas from the resized source image
		const { data, info } = await resized
			.clone()
			.ensureAlpha()
			.raw()
			.toBuffer({ resolveWithObject: true });

		const canvas = createCanvas(info.width, info.height);
		const ctx = canvas.getContext("2d");
		ctx.putImageData(
			createImageData(new Uint8ClampedArray(data), info.width, info.height),
			0,
			0,
		);

		(layer as Layer & { canvas: unknown }).canvas = canvas;

		// For smart objects: also replace the embedded linked-file bytes.
		// layer.placedLayer.id matches psd.linkedFiles[n].id
		const linkedFile = getLinkedFile(psd, layer);
		if (linkedFile) {
			const pngBuf = await resized.clone().png().toBuffer();

			linkedFile.data = new Uint8Array(pngBuf);
			console.log(
				`[psd-template] ✓ Smart object "${rep.layerName}" linked file replaced.`,
			);
		}

		console.log(
			`[psd-template] ✓ Image "${rep.layerName}" canvas replaced (${w}×${h}).`,
		);
	}
}

// ─── ImageMagick detection ────────────────────────────────────────────────────

/**
 * Detects the available ImageMagick command in the current environment.
 *
 * Tries `magick` (ImageMagick v7+) first, then `convert` (legacy naming).
 * If neither command is found, throws an error with OS-specific install hints.
 *
 * @returns Executable command name to use (`magick` or `convert`).
 * @throws {Error} If ImageMagick is not installed or not available in `PATH`.
 *
 * @example
 * ```ts
 * const magick = detectMagick();
 * execSync(`${magick} input.psd -flatten output.png`);
 * ```
 */
function detectMagick(): string {
	for (const cmd of ["magick", "convert"]) {
		try {
			execSync(`which ${cmd}`, { stdio: "ignore" });
			return cmd;
		} catch {
			// not found
		}
	}
	throw new Error(
		"[psd-template] ImageMagick not found.\n" +
			"  macOS:  brew install imagemagick\n" +
			"  Ubuntu: sudo apt install imagemagick\n" +
			"  Windows: winget install ImageMagick.ImageMagick",
	);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * A PSD file used as a reusable template.
 *
 * @example
 * ```ts
 * const tpl = await PsdTemplate.load("card.psd");
 * tpl.printLayers();   // discover exact layer names
 *
 * await tpl.render(
 *   {
 *     texts:  [{ layerName: "Title", text: "Hello!" }],
 *     images: [{ layerName: "Photo", imagePath: "shot.jpg", fit: "cover" }],
 *   },
 *   { outputPath: "result.png" }
 * );
 * ```
 */
export class PsdTemplate {
	private constructor(private readonly sourcePath: string) {}

	/**
	 * Loads a PSD file from disk and returns a reusable template instance.
	 *
	 * This method first validates read access, then stores the absolute path.
	 * Actual parsing happens on each `render()` call, allowing safe reuse of the
	 * same instance across multiple renders without side effects.
	 *
	 * @param psdPath Path to the source PSD file.
	 * @returns A promise resolving to a ready-to-use `PsdTemplate` instance.
	 * @throws {Error} If the file does not exist or is not readable.
	 *
	 * @example
	 * ```ts
	 * const template = await PsdTemplate.load("./templates/card.psd");
	 * ```
	 */
	static async load(psdPath: string): Promise<PsdTemplate> {
		fs.accessSync(psdPath, fs.constants.R_OK);
		return new PsdTemplate(path.resolve(psdPath));
	}

	/**
	 * Prints the complete layer tree to standard output.
	 *
	 * Useful for discovering exact layer names to use in
	 * `TemplateReplacements`.
	 *
	 * @returns `void`.
	 *
	 * @example
	 * ```ts
	 * const tpl = await PsdTemplate.load("card.psd");
	 * tpl.printLayers();
	 * ```
	 */
	printLayers(): void {
		printLayerTree(this.readPsd());
	}

	/**
	 * Returns the layer tree as structured data.
	 *
	 * Useful for building inspection UIs, running validations, or serializing
	 * the layer structure.
	 *
	 * @returns Array of `LayerInfo` descriptors representing document layers.
	 *
	 * @example
	 * ```ts
	 * const tpl = await PsdTemplate.load("card.psd");
	 * const layers = tpl.inspectLayers();
	 * console.log(layers.map((l) => l.name));
	 * ```
	 */
	inspectLayers() {
		return inspectLayers(this.readPsd());
	}

	/**
	 * Apply replacements and export a flattened PNG.
	 *
	 * Pipeline:
	 *   1. Parse PSD fresh from disk (safe to call render() multiple times)
	 *   2. Patch text layers (content + optional style overrides)
	 *   3. Replace image / smart-object layers
	 *   4. writePsdBuffer → temp .psd file
	 *   5. ImageMagick -flatten → temp .png  (all blending modes preserved ✅)
	 *   6. sharp optional scale → final outputPath
	 *
	 * @param replacements Object describing text and/or image replacements.
	 * @param options Final PNG export options (path, compression, scaling).
	 * @returns A promise that resolves once the output file is written to disk.
	 * @throws {Error} If PSD parsing, image processing, or export fails.
	 *
	 * @example
	 * ```ts
	 * const tpl = await PsdTemplate.load("./templates/banner.psd");
	 * await tpl.render(
	 *   {
	 *     texts: [{ layerName: "Headline", text: "New Arrivals" }],
	 *     images: [
	 *       { layerName: "Product", imagePath: "./images/product.jpg", fit: "cover" },
	 *     ],
	 *   },
	 *   { outputPath: "./out/banner.png", compressionLevel: 7, scale: 2 },
	 * );
	 * ```
	 */
	async render(
		replacements: TemplateReplacements,
		options: ExportOptions,
	): Promise<void> {
		const psd = this.readPsd();

		if (replacements.texts?.length) {
			applyTextReplacements(psd, replacements.texts);
		}
		if (replacements.images?.length) {
			await applyImageReplacements(psd, replacements.images);
		}

		const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
		const tmpPsd = path.join(os.tmpdir(), `psd-tpl-${stamp}.psd`);
		const tmpPng = path.join(os.tmpdir(), `psd-tpl-${stamp}.png`);

		try {
			fs.writeFileSync(tmpPsd, writePsdBuffer(psd));

			const magick = detectMagick();
			const cmd = `${magick} "${tmpPsd}" -flatten "${tmpPng}"`;
			console.log(`[psd-template] $ ${cmd}`);
			execSync(cmd, { stdio: "inherit" });

			fs.mkdirSync(path.dirname(path.resolve(options.outputPath)), {
				recursive: true,
			});

			const scale = options.scale ?? 1;
			let pipeline = sharp(tmpPng);

			if (scale !== 1) {
				const meta = await pipeline.metadata();
				pipeline = pipeline.resize(
					Math.round((meta.width ?? 1) * scale),
					Math.round((meta.height ?? 1) * scale),
				);
			}

			await pipeline
				.png({ compressionLevel: options.compressionLevel ?? 6 })
				.toFile(options.outputPath);

			console.log(`[psd-template] ✓ PNG written → ${options.outputPath}`);
		} finally {
			if (fs.existsSync(tmpPsd)) fs.unlinkSync(tmpPsd);
			if (fs.existsSync(tmpPng)) fs.unlinkSync(tmpPng);
		}
	}

	/**
	 * Reads and parses the source PSD from disk with render-ready options
	 * (layer image data and composite image data enabled).
	 *
	 * @returns Parsed `Psd` object ready for replacement operations.
	 */
	private readPsd(): Psd {
		const buffer = fs.readFileSync(this.sourcePath);
		return readPsd(buffer, {
			skipLayerImageData: false,
			skipCompositeImageData: false,
			skipThumbnail: true,
		});
	}
}
