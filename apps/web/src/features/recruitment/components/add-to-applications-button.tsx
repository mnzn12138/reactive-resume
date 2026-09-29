import type { RecruitmentApplicationDraft } from "@reactive-resume/api/features/recruitment/convert";
import type { RecruitmentPost } from "../types";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { BriefcaseIcon, SignInIcon } from "@phosphor-icons/react";
import { useCallback, useState } from "react";
import { buildApplicationDraft } from "@reactive-resume/api/features/recruitment/convert";
import { Button } from "@reactive-resume/ui/components/button";
import { ApplicationFormSheet } from "@/features/applications/components/application-form-sheet";

type AddToApplicationsButtonProps = {
	/** The row or detail this button belongs to; its fields seed the draft. */
	post: RecruitmentPost;
	/** Receives the draft; opening the sheet — never creating an application — is the caller's job. */
	onStartTracking: (draft: RecruitmentApplicationDraft) => void;
	/** Anonymous visitors see a sign-in call to action instead: contact details are cut for them anyway. */
	isAuthenticated: boolean;
	loginHref: string;
	variant?: "default" | "outline";
	className?: string;
};

/**
 * 「加入我的申请追踪」 — the one feature the board exists for (§5.7).
 *
 * The mapping itself lives in `packages/api` and is used by both ends of the pipeline; this
 * component only calls it. What it deliberately does **not** do is create anything: the draft
 * goes to the existing `application-form-sheet`, where the user reviews it and saves explicitly.
 * A stray click should cost nothing more than a dismissed sheet.
 */
export function AddToApplicationsButton({
	post,
	onStartTracking,
	isAuthenticated,
	loginHref,
	variant = "default",
	className,
}: AddToApplicationsButtonProps) {
	if (!isAuthenticated) {
		return (
			<Button
				variant={variant}
				nativeButton={false}
				className={className}
				render={
					<a href={loginHref}>
						<SignInIcon />
						<Trans>Log in to track this role</Trans>
					</a>
				}
			/>
		);
	}

	return (
		<Button
			variant={variant}
			className={className}
			aria-label={t`Add to my applications`}
			onClick={() => onStartTracking(buildApplicationDraft(post))}
		>
			<BriefcaseIcon />
			<Trans>Add to my applications</Trans>
		</Button>
	);
}

/**
 * Owns the one `ApplicationFormSheet` a page needs.
 *
 * Kept here rather than inside the button so a table can offer the button on every row while
 * mounting exactly one sheet. The sheet only mounts while a draft exists, which also keeps the
 * form's own queries (resume list, tags, AI providers) off pages nobody has acted on yet.
 */
export function useApplicationDraftSheet() {
	const [draft, setDraft] = useState<RecruitmentApplicationDraft | null>(null);

	const close = useCallback(() => setDraft(null), []);

	const sheet =
		draft === null ? null : (
			<ApplicationFormSheet
				open
				onOpenChange={(open) => {
					if (!open) close();
				}}
				draft={draft}
			/>
		);

	return { draft, startTracking: setDraft, sheet };
}
