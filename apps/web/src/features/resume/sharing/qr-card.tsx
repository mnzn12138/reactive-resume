import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { QrCodeIcon } from "@phosphor-icons/react";
import { QRCodeCanvas } from "qrcode.react";
import { useCallback, useRef, useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@reactive-resume/ui/components/dialog";
import { toast } from "@reactive-resume/ui/components/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@reactive-resume/ui/components/tooltip";
import { downloadWithAnchor } from "@reactive-resume/utils/file";
import { canvasToPngBlob } from "./canvas";
import { drawQrCard, getQrCardFilename, getQrCardLayout, QR_CARD_PREVIEW_SIZE } from "./qr-card.shared";

export type QrCardButtonProps = {
	/** Disabled while the resume is private: there is nothing to scan yet. */
	disabled: boolean;
	onOpen: () => void;
};

/**
 * Icon button that opens the QR 名片 dialog. When disabled it explains why through a
 * tooltip, so the button can stay visible next to the public URL.
 */
export function QrCardButton({ disabled, onOpen }: QrCardButtonProps) {
	const label = t`Download QR Card`;

	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button size="icon" variant="ghost" aria-label={label} disabled={disabled} onClick={onOpen}>
						<QrCodeIcon />
					</Button>
				}
			/>

			<TooltipContent>
				{disabled ? t`Make the resume public before you can download a QR card.` : t`Download a QR card image to share`}
			</TooltipContent>
		</Tooltip>
	);
}

export type QrCardDialogProps = {
	contact: string;
	headline: string;
	name: string;
	onClose: () => void;
	url: string;
};

/**
 * Shows the QR code for the public resume URL and downloads it as a 名片 image — a
 * white card carrying the name, headline, contact line, QR code and caption, sized for
 * sharing on 朋友圈, WeChat and QQ.
 */
export function QrCardDialog({ contact, headline, name, onClose, url }: QrCardDialogProps) {
	const qrRef = useRef<HTMLCanvasElement>(null);
	const [isPending, setIsPending] = useState(false);
	const layout = getQrCardLayout();

	const onDownload = useCallback(async () => {
		const qr = qrRef.current;
		if (!qr) return;

		setIsPending(true);

		try {
			const canvas = document.createElement("canvas");
			canvas.width = layout.width;
			canvas.height = layout.height;

			const context = canvas.getContext("2d");
			if (!context) throw new Error("Failed to create the QR card canvas context.");

			drawQrCard(
				context,
				{
					caption: t({
						comment: "Caption printed under the QR code on the shareable resume business card",
						message: "Scan to view the full resume",
					}),
					contact,
					headline,
					name,
					url,
				},
				qr,
			);

			const blob = await canvasToPngBlob(canvas);

			downloadWithAnchor(
				blob,
				getQrCardFilename(
					name,
					t({ comment: "Filename suffix of the downloaded QR business card image", message: "card" }),
				),
			);
		} catch (error) {
			console.error("Failed to generate the QR card", error);
			toast.add({ type: "error", description: t`Something went wrong. Please try again.` });
		} finally {
			setIsPending(false);
		}
	}, [contact, headline, layout, name, url]);

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>
						<Trans>QR Card</Trans>
					</DialogTitle>

					<DialogDescription>
						<Trans>
							Download a card with a QR code that opens your resume, ready to share on WeChat, QQ or in print.
						</Trans>
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col items-center gap-y-3">
					<QRCodeCanvas
						ref={qrRef}
						value={url}
						size={layout.qr.size}
						level="M"
						marginSize={2}
						bgColor="#FFFFFF"
						fgColor="#111827"
						className="rounded-md border"
						style={{ height: QR_CARD_PREVIEW_SIZE, width: QR_CARD_PREVIEW_SIZE }}
						title={t({
							comment: "Accessible title for the QR code that links to the public resume",
							message: "QR code linking to the public resume",
						})}
					/>

					<div className="space-y-1 text-center">
						<p className="font-medium leading-tight">{name}</p>
						{headline && <p className="text-muted-foreground text-sm">{headline}</p>}
						{contact && <p className="text-muted-foreground text-xs">{contact}</p>}
						<p className="text-muted-foreground text-xs">{url}</p>
					</div>
				</div>

				<DialogFooter>
					<Button variant="outline" disabled={isPending} onClick={onClose}>
						<Trans>Cancel</Trans>
					</Button>

					<Button disabled={isPending} onClick={() => void onDownload()}>
						<Trans>Download</Trans>
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
