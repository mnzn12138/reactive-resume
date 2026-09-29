/**
 * Shared font type definitions.
 *
 * These live in their own module so `cjk-fallback.ts` and `self-hosted.ts` can
 * describe fonts without importing `index.ts` — `index.ts` owns the generated
 * webfont list and imports both modules at runtime, so keeping the types here
 * avoids a runtime import cycle.
 */

export type FontCategory = "display" | "handwriting" | "monospace" | "serif" | "sans-serif";

export type FontWeight = "100" | "200" | "300" | "400" | "500" | "600" | "700" | "800" | "900";

/** Key of a web font's `files` map: an upright weight, or the same weight suffixed with `italic`. */
export type FontFileWeight = FontWeight | `${FontWeight}italic`;

export type StandardFont = {
	type: "standard";
	category: FontCategory;
	family: string;
	weights: FontWeight[];
};

export type WebFont = {
	type: "web";
	category: FontCategory;
	family: string;
	weights: FontWeight[];
	preview: string;
	/**
	 * Sparse by design: Google Fonts (and any self-hosted override) only ships
	 * the weights a family actually has, so every lookup must handle `undefined`.
	 */
	files: Partial<Record<FontFileWeight, string>>;
};

export type FontRecord = StandardFont | WebFont;
