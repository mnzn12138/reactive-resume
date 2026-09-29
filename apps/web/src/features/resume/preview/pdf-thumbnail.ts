import type { PreviewPageSize } from "./preview.shared.utils";
import type { ResumeThumbnailSize } from "./resume-thumbnail.shared";
import { getResumeThumbnailRenderSize } from "./resume-thumbnail.shared";

export type PdfPageRenderSize = { height: number; scale: number; width: number };

/**
 * Turns the natural size of a PDF page into the size it should be rendered at.
 *
 * @param pageSize - The size of the page at scale 1, in PDF points.
 * @returns The pixel size to render the page at.
 */
export type PdfPageRenderSizeResolver = (pageSize: PreviewPageSize) => PdfPageRenderSize;

/** The page numbers to render, or `"all"` for every page of the document. */
export type PdfPageSelection = "all" | number[];

/**
 * Renders a page at a fixed multiple of its natural size.
 *
 * Thumbnail rendering fits a page inside a measured target instead (`getResumeThumbnailRenderSize`);
 * exports that need a predictable resolution — a 2× share card, for instance — use this.
 *
 * @param pageSize - The size of the page at scale 1, in PDF points.
 * @param scale - The zoom factor, e.g. `2` for twice the natural size.
 * @returns The pixel size to render the page at.
 */
export const getPdfPageRenderSize = (pageSize: PreviewPageSize, scale: number): PdfPageRenderSize => {
	const factor = Number.isFinite(scale) && scale > 0 ? scale : 1;

	return {
		height: Math.ceil(pageSize.height * factor),
		scale: factor,
		width: Math.ceil(pageSize.width * factor),
	};
};

const canvasToBlob = (canvas: HTMLCanvasElement) =>
	new Promise<Blob>((resolve, reject) => {
		canvas.toBlob((blob) => {
			if (!blob) {
				reject(new Error("Failed to create resume thumbnail image."));
				return;
			}

			resolve(blob);
		}, "image/png");
	});

/**
 * Renders the requested pages of a PDF into canvases, inside a single document load.
 *
 * @param file - The PDF file to render.
 * @param options - The pages to render and how to size each of them.
 * @param signal - Aborts the render and tears the PDF document down.
 * @returns One canvas per requested page, in page order.
 */
export const createPdfPageCanvases = async (
	file: Blob,
	options: { pages: PdfPageSelection; resolveRenderSize: PdfPageRenderSizeResolver },
	signal?: AbortSignal,
): Promise<HTMLCanvasElement[]> => {
	signal?.throwIfAborted();
	const { AnnotationMode, GlobalWorkerOptions, getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
	GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();

	const arrayBuffer = await file.arrayBuffer();
	signal?.throwIfAborted();
	const loadingTask = getDocument({ data: new Uint8Array(arrayBuffer) });
	let pdfDocument: Awaited<typeof loadingTask.promise> | undefined;
	let renderTask: { cancel: () => void } | undefined;
	let destruction: Promise<void> | undefined;
	const destroy = () => (destruction ??= loadingTask.destroy());
	const abort = () => {
		renderTask?.cancel();
		void destroy();
	};
	signal?.addEventListener("abort", abort, { once: true });

	try {
		signal?.throwIfAborted();
		pdfDocument = await loadingTask.promise;
		signal?.throwIfAborted();

		const pageNumbers =
			options.pages === "all" ? Array.from({ length: pdfDocument.numPages }, (_, index) => index + 1) : options.pages;

		const canvases: HTMLCanvasElement[] = [];

		for (const pageNumber of pageNumbers) {
			const page = await pdfDocument.getPage(pageNumber);

			try {
				signal?.throwIfAborted();
				const baseViewport = page.getViewport({ scale: 1 });
				const pageSize: PreviewPageSize = { height: baseViewport.height, width: baseViewport.width };
				const renderSize = options.resolveRenderSize(pageSize);

				const canvas = document.createElement("canvas");
				const canvasContext = canvas.getContext("2d");

				if (!canvasContext) throw new Error("Failed to create resume thumbnail canvas context.");

				canvas.height = renderSize.height;
				canvas.width = renderSize.width;

				const viewport = page.getViewport({ scale: renderSize.scale });
				const task = page.render({
					canvas,
					canvasContext,
					viewport,
					annotationMode: AnnotationMode.DISABLE,
					background: "white",
				});
				renderTask = task;

				await task.promise;
				signal?.throwIfAborted();

				canvases.push(canvas);
			} finally {
				page.cleanup();
			}
		}

		return canvases;
	} catch (error) {
		if (signal?.aborted) throw new DOMException("Thumbnail generation aborted.", "AbortError");
		throw error;
	} finally {
		signal?.removeEventListener("abort", abort);
		void destroy();
	}
};

export const createPdfFirstPageImageUrl = async (file: Blob, targetSize: ResumeThumbnailSize, signal?: AbortSignal) => {
	const canvases = await createPdfPageCanvases(
		file,
		{
			pages: [1],
			resolveRenderSize: (pageSize) => getResumeThumbnailRenderSize(pageSize, targetSize),
		},
		signal,
	);

	const canvas = canvases[0];
	if (!canvas) throw new Error("Failed to create resume thumbnail image.");

	const image = await canvasToBlob(canvas);
	signal?.throwIfAborted();

	return URL.createObjectURL(image);
};
