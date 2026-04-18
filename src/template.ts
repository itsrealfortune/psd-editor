import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";

import "ag-psd/initialize-canvas";
import { readPsd, writePsdBuffer } from "ag-psd";
import type { Layer, Psd } from "ag-psd";

import sharp from "sharp";
import {
	findLayerByName,
	getLinkedFile,
	printLayerTree,
	inspectLayers,
} from "./layers.js";
import type {
	ExportOptions,
	ImageReplacement,
	TemplateReplacements,
	TextReplacement,
} from "./types.js";

// ─── Text replacements ────────────────────────────────────────────────────────

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

		// Build a node-canvas from the resized source image
		const { data, info } = await sharp(rep.imagePath)
			.resize(w, h, { fit: sharpFit[fit], position: "center" })
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
			const pngBuf = await sharp(rep.imagePath)
				.resize(w, h, { fit: sharpFit[fit], position: "center" })
				.png()
				.toBuffer();

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

	/** Parse a PSD from disk and return a template instance. */
	static async load(psdPath: string): Promise<PsdTemplate> {
		fs.accessSync(psdPath, fs.constants.R_OK);
		return new PsdTemplate(path.resolve(psdPath));
	}

	/** Print the full layer tree to stdout. Use this to discover exact layer names. */
	printLayers(): void {
		printLayerTree(this.readPsd());
	}

	/** Return the layer tree as structured data (useful for building UIs or validation). */
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

	private readPsd(): Psd {
		const buffer = fs.readFileSync(this.sourcePath);
		return readPsd(buffer, {
			skipLayerImageData: false,
			skipCompositeImageData: false,
			skipThumbnail: true,
		});
	}
}
