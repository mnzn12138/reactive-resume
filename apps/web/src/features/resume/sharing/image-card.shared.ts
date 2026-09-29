/**
 * Parameters of the downloadable resume image card (简历图片卡).
 *
 * The PDF itself is rendered by the existing thumbnail pipeline
 * (`createPdfPageCanvases`); this module only decides at which scale, which pages and
 * under which filename the result is shared.
 */

import type { PdfPageSelection } from "@/features/resume/preview/pdf-thumbnail";
import { generateLocalizedFilename } from "@reactive-resume/utils/file";

/** Zoom factor of the exported image: A4 renders at roughly 1190 × 1684 px. */
export const IMAGE_CARD_SCALE = 2;

/**
 * Height ceiling of the stitched 长图, in pixels. Long resumes are scaled down to fit so
 * the canvas stays within what browsers will encode.
 */
export const IMAGE_CARD_MAX_HEIGHT = 12000;

/** `single` renders the first page, `long` stitches every page into one image. */
export type ImageCardMode = "long" | "single";

/**
 * Maps a card mode onto the pages the PDF pipeline has to render.
 *
 * @param mode - The card mode selected in the dialog.
 * @returns The page selection to hand to `createPdfPageCanvases`.
 */
export const resolveImageCardPages = (mode: ImageCardMode): PdfPageSelection => (mode === "long" ? "all" : [1]);

/**
 * Builds the download filename of the card, keeping CJK characters intact.
 *
 * @param name - The resume name.
 * @param suffix - The localized suffix, e.g. 「简历图」.
 * @returns A `.png` filename safe for every mainstream filesystem.
 */
export const getImageCardFilename = (name: string, suffix: string): string =>
	generateLocalizedFilename(`${name}-${suffix}`, "png");
