import type { PlatformId } from "@reactive-resume/resume/platform-profiles";
import type { PlatformBlock } from "@reactive-resume/resume/platform-text";
import { Select } from "@base-ui/react";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { CaretDownIcon, CheckIcon, ClipboardIcon, CopyIcon, DownloadSimpleIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useCopyToClipboard } from "usehooks-ts";
import {
	DEFAULT_PLATFORM_ID,
	PLATFORM_PROFILES,
	RECRUITMENT_PLATFORMS,
} from "@reactive-resume/resume/platform-profiles";
import { Button } from "@reactive-resume/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@reactive-resume/ui/components/dialog";
import { Label } from "@reactive-resume/ui/components/label";
import { toast } from "@reactive-resume/ui/components/toast";
import { useResumeExport } from "./use-resume-export";

type CopyableResume = Parameters<typeof useResumeExport>[0];

type ResumePlatformCopyDialogProps = {
	resume: CopyableResume;
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

/** Picker labels. The values are brand names, so they stay identical in every locale. */
const PLATFORM_ITEMS = Object.fromEntries(
	RECRUITMENT_PLATFORMS.map((id) => [id, PLATFORM_PROFILES[id].name]),
) as Record<PlatformId, string>;

/**
 * Copies the resume out in one recruitment platform's field order and vocabulary.
 *
 * Each block is one page of the target form, so the candidate pastes a block at a time instead of
 * scrolling one long document looking for the line that belongs in the current input.
 */
export function ResumePlatformCopyDialog({ resume, open, onOpenChange }: ResumePlatformCopyDialogProps) {
	const [platform, setPlatform] = useState<PlatformId>(DEFAULT_PLATFORM_ID);
	const [blocks, setBlocks] = useState<PlatformBlock[]>([]);
	const [isLoadingBlocks, setIsLoadingBlocks] = useState(false);
	const [, copyToClipboard] = useCopyToClipboard();
	const { getPlatformBlocks, onCopyPlatformText, onDownloadPlatformText, isExporting } = useResumeExport(resume);

	// Section titles are resolved per locale and the resolver is async, so the preview is fetched.
	useEffect(() => {
		if (!open) return;

		let cancelled = false;
		setIsLoadingBlocks(true);

		void getPlatformBlocks(platform)
			.then((result) => {
				if (!cancelled) setBlocks(result);
			})
			.catch(() => {
				if (!cancelled) setBlocks([]);
			})
			.finally(() => {
				if (!cancelled) setIsLoadingBlocks(false);
			});

		return () => {
			cancelled = true;
		};
	}, [getPlatformBlocks, open, platform]);

	const onCopyBlock = async (block: PlatformBlock) => {
		try {
			await copyToClipboard(block.text);
			toast.add({ type: "success", description: t`Block copied to clipboard.` });
		} catch {
			toast.add({ type: "error", description: t`Could not copy the text. Please try again.` });
		}
	};

	const profile = PLATFORM_PROFILES[platform];
	const isEmpty = !isLoadingBlocks && blocks.length === 0;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="gap-5 sm:max-w-xl">
				<DialogHeader className="pe-8">
					<DialogTitle>
						<Trans>Copy for a job-site form</Trans>
					</DialogTitle>
					<DialogDescription>
						<Trans>
							Pick the site you are filling in. Every field is ordered and named the way its form asks for it, so you
							can paste one block at a time.
						</Trans>
					</DialogDescription>
				</DialogHeader>

				<div className="grid gap-2">
					<Label>
						<Trans>Platform</Trans>
					</Label>

					<Select.Root
						items={PLATFORM_ITEMS}
						value={platform}
						onValueChange={(value) => setPlatform((value ?? DEFAULT_PLATFORM_ID) as PlatformId)}
					>
						<Select.Trigger className="flex h-9 w-full items-center justify-between rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 [&_svg]:size-4 [&_svg]:text-muted-foreground">
							<Select.Value />
							<Select.Icon>
								<CaretDownIcon />
							</Select.Icon>
						</Select.Trigger>

						<Select.Portal>
							<Select.Positioner className="isolate z-50" sideOffset={6} align="start">
								<Select.Popup className="max-h-(--available-height) min-w-(--anchor-width) origin-(--transform-origin) overflow-hidden rounded-lg bg-popover/70 text-popover-foreground shadow-md ring-1 ring-foreground/10 backdrop-blur-xl">
									<Select.List className="no-scrollbar max-h-72 overflow-y-auto p-1">
										{RECRUITMENT_PLATFORMS.map((id) => (
											<Select.Item
												key={id}
												value={id}
												className="flex cursor-default select-none items-center gap-2 rounded-md py-1.5 ps-2 pe-8 text-sm outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
											>
												<Select.ItemText>{PLATFORM_PROFILES[id].name}</Select.ItemText>
												<Select.ItemIndicator className="absolute inset-e-2 flex size-4 items-center justify-center">
													<CheckIcon />
												</Select.ItemIndicator>
											</Select.Item>
										))}
									</Select.List>
								</Select.Popup>
							</Select.Positioner>
						</Select.Portal>
					</Select.Root>

					<p className="text-muted-foreground text-xs leading-normal">
						{profile.id === DEFAULT_PLATFORM_ID ? (
							<Trans>The plain text download, unchanged: one line per field in the default order.</Trans>
						) : (
							<Trans>Expect 期望职位, 期望薪资, and similar fields to come from your own custom fields.</Trans>
						)}
					</p>
				</div>

				<div className="grid max-h-72 gap-3 overflow-y-auto rounded-lg border bg-muted/20 p-3">
					{isEmpty ? (
						<p className="text-muted-foreground text-sm">
							<Trans>This resume has no content to export yet.</Trans>
						</p>
					) : (
						blocks.map((block) => (
							<div key={block.id} className="grid gap-2">
								<div className="flex items-center justify-between gap-3">
									<h3 className="font-medium text-sm">{block.title}</h3>
									<Button
										size="sm"
										variant="ghost"
										className="h-7 px-2"
										aria-label={t`Copy ${block.title}`}
										disabled={isLoadingBlocks}
										onClick={() => void onCopyBlock(block)}
									>
										<CopyIcon />
										<Trans>Copy</Trans>
									</Button>
								</div>
								<pre className="wrap-anywhere whitespace-pre-wrap rounded-md border bg-background p-2.5 font-mono text-xs leading-relaxed">
									{block.text}
								</pre>
							</div>
						))
					)}
				</div>

				<DialogFooter>
					<Button
						variant="outline"
						disabled={isExporting || isEmpty}
						onClick={() => void onDownloadPlatformText(platform)}
					>
						<DownloadSimpleIcon />
						<Trans>Download TXT</Trans>
					</Button>

					<Button disabled={isExporting || isEmpty} onClick={() => void onCopyPlatformText(platform)}>
						<ClipboardIcon />
						<Trans>Copy all</Trans>
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
