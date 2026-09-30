import type { ReportReason } from "@reactive-resume/schema/recruitment/data";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { FlagIcon } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { REPORT_REASONS } from "@reactive-resume/schema/recruitment/data";
import { Alert, AlertDescription } from "@reactive-resume/ui/components/alert";
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
import { Textarea } from "@reactive-resume/ui/components/textarea";
import { toast } from "@reactive-resume/ui/components/toast";
import { Combobox } from "@/components/ui/combobox";
import { orpc } from "@/libs/orpc/client";
import { toRecruitmentFailure } from "../errors";
import { reportReasonLabels } from "../labels";

const MAX_DETAIL_CHARS = 500;

type ReportDialogProps = {
	postId: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/**
	 * Fired when the report is on record — whether it was filed now or turns out to have been
	 * filed already. The caller flips its button to 「已举报」 either way.
	 */
	onReported?: () => void;
};

/**
 * 举报 — one report per person per post, and the conflict is answered, not swallowed.
 *
 * The server rejects a second report with 409 `RECRUITMENT_ALREADY_REPORTED` on purpose
 * (§5.6): `report_count` is what an administrator sorts the queue by, so silently accepting
 * the duplicate would keep the counter honest but leave the reader believing twice as many
 * people complained as actually did. The dialog therefore treats the 409 as a *success of a
 * different shape* — the report is on record, say so, and close.
 *
 * The report count itself is deliberately nowhere in this file: no public surface shows it,
 * because publishing it turns reports into a weapon against a post.
 */
export function ReportDialog({ postId, open, onOpenChange, onReported }: ReportDialogProps) {
	const { i18n } = useLingui();
	const queryClient = useQueryClient();

	const [reason, setReason] = useState<ReportReason | null>(null);
	const [detail, setDetail] = useState("");
	const [error, setError] = useState<string | null>(null);

	const reasonOptions = REPORT_REASONS.map((value) => ({ value, label: i18n.t(reportReasonLabels[value]) }));

	const reset = useCallback(() => {
		setReason(null);
		setDetail("");
		setError(null);
	}, []);

	const close = useCallback(
		(next: boolean) => {
			if (!next) reset();
			onOpenChange(next);
		},
		[onOpenChange, reset],
	);

	const report = useMutation(
		orpc.recruitment.report.mutationOptions({
			onSuccess: () => {
				onReported?.();
				reset();
				onOpenChange(false);
				toast.add({ type: "success", description: t`Thanks — an administrator will look at this post.` });
			},
			onError: (thrown: unknown) => {
				const failure = toRecruitmentFailure(thrown);

				if (failure.alreadyReported) {
					// Not an error to the reader: their report is on record either way, so the
					// button flips to 「已举报」 and an info toast says where it went.
					setError(null);
					onReported?.();
					reset();
					onOpenChange(false);
					toast.add({ type: "info", description: failure.message });
					return;
				}

				setError(failure.message);
			},
			onSettled: () => {
				void queryClient.invalidateQueries({ queryKey: orpc.admin.recruitment.reports.list.queryKey() });
			},
		}),
	);

	// `other` carries no information on its own, so the detail is what makes the report
	// actionable; the server enforces the same rule, this only saves a round trip.
	const detailMissing = reason === "other" && detail.trim().length === 0;

	const submit = () => {
		if (reason === null || detailMissing) return;

		report.mutate({
			id: postId,
			reason,
			...(detail.trim() ? { detail: detail.trim() } : {}),
		});
	};

	return (
		<Dialog open={open} onOpenChange={close}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						<Trans>Report this post</Trans>
					</DialogTitle>
					<DialogDescription>
						<Trans>An administrator reviews reports. You can report a post once.</Trans>
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-4">
					<div className="flex flex-col gap-2">
						<Label htmlFor="report-reason">
							<Trans>Reason</Trans>
						</Label>
						<Combobox
							id="report-reason"
							options={reasonOptions}
							value={reason}
							onValueChange={(value) => setReason(value)}
							placeholder={i18n._(t`Pick a reason`)}
						/>
					</div>

					<div className="flex flex-col gap-2">
						<Label htmlFor="report-detail">
							{reason === "other" ? <Trans>What is wrong with it?</Trans> : <Trans>Details (optional)</Trans>}
						</Label>
						<Textarea
							id="report-detail"
							value={detail}
							maxLength={MAX_DETAIL_CHARS}
							rows={4}
							onChange={(event) => setDetail(event.target.value)}
							placeholder={i18n._(t`Anything that helps an administrator judge this`)}
						/>
						{detailMissing && (
							<p className="text-destructive text-xs">
								<Trans>Say what is wrong — "something else" on its own cannot be acted on.</Trans>
							</p>
						)}
					</div>

					{error !== null && (
						<Alert variant="destructive">
							<AlertDescription>{error}</AlertDescription>
						</Alert>
					)}
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => close(false)}>
						<Trans>Cancel</Trans>
					</Button>
					<Button
						variant="destructive"
						disabled={reason === null || detailMissing || report.isPending}
						onClick={submit}
					>
						<Trans>Send report</Trans>
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

type ReportButtonProps = {
	onClick: () => void;
	/** Set once this reader's report is on record; the button then stops offering a second one. */
	reported?: boolean;
	className?: string;
};

/** The trigger that opens `ReportDialog`; disabled rather than hidden once reported. */
export function ReportButton({ onClick, reported = false, className }: ReportButtonProps) {
	return (
		<Button
			variant="outline"
			className={className}
			disabled={reported}
			aria-label={reported ? t`Reported` : t`Report this post`}
			onClick={onClick}
		>
			<FlagIcon weight={reported ? "fill" : "regular"} />
			{reported ? <Trans>Reported</Trans> : <Trans>Report</Trans>}
		</Button>
	);
}

/**
 * Owns the one dialog a page needs, together with the 「已举报」 state it flips.
 *
 * Kept beside the button rather than inside it for the same reason as the application sheet:
 * a list can offer the button on every row while mounting one dialog.
 */
export function useReportDialog(postId: string) {
	const [open, setOpen] = useState(false);
	const [reported, setReported] = useState(false);

	const dialog = (
		<ReportDialog postId={postId} open={open} onOpenChange={setOpen} onReported={() => setReported(true)} />
	);

	return { openReport: () => setOpen(true), reported, dialog };
}
