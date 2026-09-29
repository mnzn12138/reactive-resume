import { slugify } from "./string";

const FILENAME_FORBIDDEN_CHARACTERS = /[\\/:*?"<>|\p{Cc}]+/gu;
const FILENAME_WHITESPACE = /\s+/g;
const FILENAME_EDGE_SEPARATORS = /^[.-]+|[.-]+$/g;
const FILENAME_FALLBACK = "resume";

export function generateFilename(prefix: string, extension?: string) {
	const name = slugify(prefix);
	return `${name}${extension ? `.${extension}` : ""}`;
}

/**
 * Builds a filename that preserves non-ASCII characters.
 *
 * `generateFilename` slugifies the prefix with `@sindresorhus/slugify`, which erases CJK
 * (`slugify("张三-名片")` is an empty string) and then substitutes a random animal name.
 * Chinese-first filenames therefore use this variant, which keeps every character a
 * filesystem accepts instead of transliterating it away.
 *
 * @param prefix - The human readable name of the file, without extension.
 * @param extension - The extension to append, without a leading dot.
 * @returns The file name, falling back to `resume` when nothing usable is left.
 */
export function generateLocalizedFilename(prefix: string, extension?: string) {
	const name = prefix
		.replace(FILENAME_FORBIDDEN_CHARACTERS, " ")
		.replace(FILENAME_WHITESPACE, "-")
		.replace(FILENAME_EDGE_SEPARATORS, "");

	return `${name || FILENAME_FALLBACK}${extension ? `.${extension}` : ""}`;
}

export function downloadWithAnchor(blob: Blob, filename: string) {
	const a = document.createElement("a");
	const url = URL.createObjectURL(blob);

	a.href = url;
	a.rel = "noopener";
	a.download = filename;

	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);

	setTimeout(() => URL.revokeObjectURL(url), 5000);
}
