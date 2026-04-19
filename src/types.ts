/**
 * Configuration used to replace the content of a text layer.
 *
 * @example
 * ```ts
 * const title: TextReplacement = {
 *   layerName: "Title",
 *   text: "Black Friday",
 *   fontSize: 72,
 *   color: [255, 255, 255],
 * };
 * ```
 */
export interface TextReplacement {
	/** Layer name in the PSD (case-sensitive) */
	layerName: string;
	/** New text content */
	text: string;
	/** Optional: override font size (in points) */
	fontSize?: number;
	/** Optional: override color as [R, G, B] 0-255 */
	color?: [number, number, number];
}

/**
 * Configuration used to replace an image or smart object layer.
 *
 * @example
 * ```ts
 * const heroImage: ImageReplacement = {
 *   layerName: "Hero",
 *   imagePath: "./assets/hero.jpg",
 *   fit: "cover",
 * };
 * ```
 */
export interface ImageReplacement {
	/** Layer name in the PSD (case-sensitive) */
	layerName: string;
	/**
	 * Path to the new image file on disk.
	 * Supported formats: PNG, JPEG, WEBP (via sharp)
	 */
	imagePath: string;
	/**
	 * How to fit the image into the layer bounds.
	 * - "cover"  : crop to fill (default)
	 * - "contain": letterbox/pillarbox
	 * - "stretch": ignore aspect ratio
	 */
	fit?: "cover" | "contain" | "stretch";
}

/**
 * Full set of replacements applied in a single render pass.
 *
 * Arrays are optional: you can replace only text, only images, or both.
 *
 * @example
 * ```ts
 * const replacements: TemplateReplacements = {
 *   texts: [{ layerName: "Title", text: "Hello" }],
 *   images: [{ layerName: "Photo", imagePath: "./photo.png" }],
 * };
 * ```
 */
export interface TemplateReplacements {
	texts?: TextReplacement[];
	images?: ImageReplacement[];
}

/**
 * Final PNG export options.
 *
 * @example
 * ```ts
 * const options: ExportOptions = {
 *   outputPath: "./out/card.png",
 *   compressionLevel: 7,
 *   scale: 2,
 * };
 * ```
 */
export interface ExportOptions {
	/** Output PNG file path */
	outputPath: string;
	/** PNG compression level 0-9 (default: 6) */
	compressionLevel?: number;
	/** Scale factor for the output (default: 1) */
	scale?: number;
}

/**
 * Describes a layer returned by PSD inspection.
 *
 * This shape is intended for exploration (debugging, UI, validation)
 * rather than direct PSD mutation.
 *
 * @example
 * ```ts
 * const layer: LayerInfo = {
 *   name: "Title",
 *   type: "text",
 *   bounds: { top: 10, left: 20, bottom: 90, right: 600 },
 *   visible: true,
 *   textContent: "Sample",
 * };
 * ```
 */
export interface LayerInfo {
	name: string;
	type: "text" | "image" | "smartObject" | "group" | "adjustment" | "other";
	/** Bounding box in pixels */
	bounds: { top: number; left: number; bottom: number; right: number };
	visible: boolean;
	blendMode?: string;
	opacity?: number;
	/** For text layers: the current text content */
	textContent?: string;
	/** For smart objects: the embedded filename */
	linkedFileName?: string;
	children?: LayerInfo[];
}
