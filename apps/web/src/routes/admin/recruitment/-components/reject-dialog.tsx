import type { RecruitmentPostAdmin } from "@/features/recruitment/types";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
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
import { recruitmentErrorMessage } from "@/features/recruitment/errors";
import { orpc } from "@/libs/orpc/client";

/** Mirrors `MAX_REJECTION_REASON_CHARS` on the server, so the counter cannot promise more. */
const MAX_REASON_CHARS = 500;

type RejectDialogProps = {
	/** The post being rejected; null keeps the dialog closed. */
	post: RecruitmentPostAdmin | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

/**
 * 驳回 — the one moderation action that has to explain itself.
 *
 * The reason is required and the server enforces it (1..500), but the dialog enforces it too:
 * a disabled button says "this is needed" before the click, whereas a 400 says it afterwards
 * and reads as the tool being broken.
 *
 * What it is for is stated in the copy as well: the reason is shown to whoever submitted the
 * post, which is the whole point — a rejection the submitter cannot understand is a
 * disappearance with extra steps (§5.8).
 */
export function RejectDialog({ post, open, onOpenChange }: RejectDialogProps) {
	const queryClient = useQueryClient();
	const [reason, setReason] = useState("");

	useEffect(() => {
		if (open) setReason("");
	}, [open]);

	const invalidate = () => {
		void queryClient.invalidateQueries({ queryKey: orpc.admin.recruitment.posts.list.queryKey() });
	};

	const reject = useMutation(
		orpc.admin.recruitment.posts.update.mutationOptions({
			onSuccess: () => {
				invalidate();
				onOpenChange(false);
				toast.add({ type: "success", description: t`Rejected. The reason is now visible to the submitter.` });
			},
			onError: (error: unknown) => toast.add({ type: "error", description: recruitmentErrorMessage(error) }),
		}),
	);

	const trimmed = reason.trim();

	const submit = () => {
		if (post === null || trimmed.length === 0) return;

		reject.mutate({ action: "reject", id: post.id, rejectionReason: trimmed });
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						<Trans>Reject this post</Trans>
					</DialogTitle>
					<DialogDescription>
						<Trans>The reason is shown to whoever submitted it, so it has to say what to fix.</Trans>
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-2">
					<Label htmlFor="rejection-reason">
						<Trans>Reason</Trans>
					</Label>
					<Textarea
						id="rejection-reason"
						rows={4}
						value={reason}
						maxLength={MAX_REASON_CHARS}
						onChange={(event) => setReason(event.target.value)}
						placeholder={t`For example: the announcement link does not open, or the salary range is missing.`}
						aria-invalid={trimmed.length === 0}
					/>
					<p className="text-muted-foreground text-xs tabular-nums">
						{trimmed.length}/{MAX_REASON_CHARS}
					</p>
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						<Trans>Cancel</Trans>
					</Button>
					<Button variant="destructive" disabled={trimmed.length === 0 || reject.isPending} onClick={submit}>
						<Trans>Reject</Trans>
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
