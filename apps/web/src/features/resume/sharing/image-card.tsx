import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { ImageCardMode } from "./image-card.shared";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { ImageIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@reactive-resume/ui/components/dialog";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { toast } from "@reactive-resume/ui/components/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@reactive-resume/ui/components/tooltip";
import { downloadWithAnchor } from "@reactive-resume/utils/file";
import { createPdfPageCanvases, getPdfPageRenderSize } from "@/features/resume/preview/pdf-thumbnail";
import { canvasToPngBlob, stitchCanvases } from "./canvas";
import {
	getImageCardFilename,
	IMAGE_CARD_MAX_HEIGHT,
	IMAGE_CARD_SCALE,
	resolveImageCardPages,
} from "./image-card.shared";

/**
 * Renders the resume to a PDF in the browser.
 *
 * Imported lazily: the renderer pulls in `@reactive-resume/pdf`, which is only needed
 * once the user actually opens the dialog, and would otherwise drag it into the import
 * graph of the whole builder right sidebar.
 */
const renderResumePdf = async (data: ResumeData) => {
	const { createResumePdfBlob } = await import("@/features/resume/export/pdf-document");
	return createResumePdfBlob(data);
};

export type ImageCardButtonProps = {
	onOpen: () => void;
};

/**
 * Icon button that opens the image card dialog. Unlike the QR card, an image of the
 * resume itself does not depend on the public URL, so it is always available.
 */
export function ImageCardButton({ onOpen }: ImageCardButtonProps) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button size="icon" variant="ghost" aria-label={t`Generate Image Card`} onClick={onOpen}>
						<ImageIcon />
					</Button>
				}
			/>

			<TooltipContent>{t`Turn your resume into an image you can share`}</TooltipContent>
		</Tooltip>
	);
}

export type ImageCardDialogProps = {
	data: ResumeData;
	name: string;
	onClose: () => void;
};

/**
 * Previews and downloads the resume as an image: the first page as a 单页图, or every
 * page stitched into one 长图, both rendered from the existing browser PDF pipeline.
 */
export function ImageCardDialog({ data, name, onClose }: ImageCardDialogProps) {
	// The builder keeps mutating the draft; the preview and the download must agree.
	const dataRef = useRef(data);
	const [mode, setMode] = useState<ImageCardMode>("single");
	const [previewUrl, setPreviewUrl] = useState<string | null>(null);
	const [hasPreviewFailed, setHasPreviewFailed] = useState(false);
	const [isPending, setIsPending] = useState(false);

	useEffect(() => {
		const controller = new AbortController();
		let url: string | null = null;

		setPreviewUrl(null);
		setHasPreviewFailed(false);

		void (async () => {
			try {
				const pdf = await renderResumePdf(dataRef.current);
				controller.signal.throwIfAborted();

				const [canvas] = await createPdfPageCanvases(
					pdf,
					{
						pages: [1],
						resolveRenderSize: (pageSize) => getPdfPageRenderSize(pageSize, IMAGE_CARD_SCALE),
					},
					controller.signal,
				);

				if (!canvas) throw new Error("Failed to render the first page of the resume.");
				controller.signal.throwIfAborted();

				url = URL.createObjectURL(await canvasToPngBlob(canvas));
				controller.signal.throwIfAborted();

				setPreviewUrl(url);
			} catch (error) {
				if (controller.signal.aborted) return;

				console.error("Failed to generate the image card preview", error);
				setHasPreviewFailed(true);
			}
		})();

		return () => {
			controller.abort();
			if (url) URL.revokeObjectURL(url);
		};
	}, []);

	const onDownload = useCallback(async () => {
		setIsPending(true);

		try {
			const pdf = await renderResumePdf(dataRef.current);

			const canvases = await createPdfPageCanvases(pdf, {
				pages: resolveImageCardPages(mode),
				resolveRenderSize: (pageSize) => getPdfPageRenderSize(pageSize, IMAGE_CARD_SCALE),
			});

			const [first] = canvases;
			if (!first) throw new Error("Failed to render the resume pages.");

			const image = canvases.length > 1 ? stitchCanvases(canvases, IMAGE_CARD_MAX_HEIGHT) : first;
			const blob = await canvasToPngBlob(image);

			downloadWithAnchor(
				blob,
				getImageCardFilename(
					name,
					t({ comment: "Filename suffix of the downloaded resume image card", message: "resume-image" }),
				),
			);
		} catch (error) {
			console.error("Failed to generate the image card", error);
			toast.add({ type: "error", description: t`Something went wrong. Please try again.` });
		} finally {
			setIsPending(false);
		}
	}, [mode, name]);

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>
						<Trans>Image Card</Trans>
					</DialogTitle>

					<DialogDescription>
						<Trans>
							Turn your resume into an image you can post on 朋友圈, send to a WeChat contact or share on QQ.
						</Trans>
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-3">
					<div className="flex items-center gap-x-2">
						<Button
							type="button"
							size="sm"
							variant={mode === "single" ? "secondary" : "ghost"}
							aria-pressed={mode === "single"}
							onClick={() => setMode("single")}
						>
							<Trans>First Page</Trans>
						</Button>

						<Button
							type="button"
							size="sm"
							variant={mode === "long" ? "secondary" : "ghost"}
							aria-pressed={mode === "long"}
							onClick={() => setMode("long")}
						>
							<Trans comment="Image card mode that stitches every resume page into one tall image">Long Image</Trans>
						</Button>
					</div>

					<div className="flex min-h-48 items-center justify-center overflow-hidden rounded-md border bg-muted/40 p-2">
						{previewUrl ? (
							<img
								src={previewUrl}
								alt={t({
									comment: "Alt text of the resume image card preview",
									message: "Preview of the resume image card",
								})}
								className="max-h-80 w-auto rounded-sm bg-white shadow"
							/>
						) : hasPreviewFailed ? (
							<p className="text-muted-foreground text-sm">
								<Trans>Could not generate the preview. Please try again.</Trans>
							</p>
						) : (
							<Spinner className="size-6 text-muted-foreground" />
						)}
					</div>

					<p className="text-muted-foreground text-xs">
						{mode === "single" ? (
							<Trans>Downloads the first page of your resume as a PNG image.</Trans>
						) : (
							<Trans>Downloads every page of your resume stitched into one tall PNG image.</Trans>
						)}
					</p>
				</div>

				<DialogFooter>
					<Button variant="outline" disabled={isPending} onClick={onClose}>
						<Trans>Cancel</Trans>
					</Button>

					<Button disabled={isPending || !previewUrl} onClick={() => void onDownload()}>
						<Trans>Download</Trans>
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
