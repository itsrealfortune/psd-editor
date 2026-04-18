/**
 * Configuration for a text layer replacement
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
 * Configuration for a smart object / image layer replacement
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
 * Full set of replacements for one render pass
 */
export interface TemplateReplacements {
	texts?: TextReplacement[];
	images?: ImageReplacement[];
}

/**
 * Options for the final PNG export
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
 * Describes a layer found in the PSD — useful for discovery
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
