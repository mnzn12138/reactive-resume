/**
 * Canvas plumbing shared by the resume image card and the QR 名片 card.
 *
 * Only the size arithmetic is pure; the two drawing helpers need a real canvas and are
 * therefore exercised through the browser rather than unit tests.
 */

export type CanvasSize = { height: number; width: number };

/**
 * Computes the size of a canvas that stacks every page vertically, shrinking the stack
 * when it would exceed `maxHeight`.
 *
 * @param sizes - The size of each page canvas, top to bottom.
 * @param maxHeight - The tallest canvas that should be produced.
 * @returns The output size plus the scale each page has to be drawn at.
 */
export const getStitchedCanvasSize = (
	sizes: readonly CanvasSize[],
	maxHeight: number,
): CanvasSize & { scale: number } => {
	const width = sizes.reduce((widest, size) => Math.max(widest, size.width), 0);
	const height = sizes.reduce((total, size) => total + size.height, 0);
	const limit = maxHeight > 0 ? maxHeight : Number.POSITIVE_INFINITY;
	const scale = Math.min(1, limit / height);

	return {
		height: Math.max(1, Math.round(height * scale)),
		scale,
		width: Math.max(1, Math.round(width * scale)),
	};
};

/**
 * Stacks page canvases into one tall canvas, centred horizontally on a white background.
 *
 * @param canvases - The rendered pages, in page order.
 * @param maxHeight - The tallest canvas that should be produced.
 * @returns A single canvas holding every page.
 */
export const stitchCanvases = (canvases: readonly HTMLCanvasElement[], maxHeight: number): HTMLCanvasElement => {
	const { height, scale, width } = getStitchedCanvasSize(canvases, maxHeight);

	const canvas = document.createElement("canvas");
	canvas.height = height;
	canvas.width = width;

	const context = canvas.getContext("2d");
	if (!context) throw new Error("Failed to create the stitched image canvas context.");

	context.fillStyle = "#ffffff";
	context.fillRect(0, 0, width, height);

	let top = 0;

	for (const page of canvases) {
		const pageWidth = page.width * scale;
		const pageHeight = page.height * scale;

		context.drawImage(page, Math.round((width - pageWidth) / 2), Math.round(top), pageWidth, pageHeight);
		top += pageHeight;
	}

	return canvas;
};

/**
 * Encodes a canvas as a PNG blob.
 *
 * @param canvas - The canvas to encode.
 * @returns A PNG blob of the canvas contents.
 */
export const canvasToPngBlob = (canvas: HTMLCanvasElement): Promise<Blob> =>
	new Promise<Blob>((resolve, reject) => {
		canvas.toBlob((blob) => {
			if (!blob) {
				reject(new Error("Failed to encode the canvas as a PNG image."));
				return;
			}

			resolve(blob);
		}, "image/png");
	});
