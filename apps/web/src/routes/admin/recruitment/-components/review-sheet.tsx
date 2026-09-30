import type { ReactNode } from "react";
import type { RecruitmentPostAdmin } from "@/features/recruitment/types";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { ArrowSquareOutIcon, CheckIcon, FlagIcon, ProhibitIcon, TrashIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { Badge } from "@reactive-resume/ui/components/badge";
import { Button } from "@reactive-resume/ui/components/button";
import { Separator } from "@reactive-resume/ui/components/separator";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@reactive-resume/ui/components/sheet";
import { cn } from "@reactive-resume/utils/style";
import { PostStatusBadge } from "@/features/recruitment/components/post-status-badge";
import {
	batchLabels,
	benefitLabels,
	contactKindLabels,
	educationLabels,
	employmentTypeLabels,
	enumLabels,
	sourceLabels,
	workIntensityLabels,
	workModeLabels,
} from "@/features/recruitment/labels";

type ReviewSheetProps = {
	post: RecruitmentPostAdmin | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onApprove: (post: RecruitmentPostAdmin) => void;
	onReject: (post: RecruitmentPostAdmin) => void;
	onClose: (post: RecruitmentPostAdmin) => void;
	onDelete: (post: RecruitmentPostAdmin) => void;
};

/**
 * The reviewer's view of one post — every field, plus the two that decide most verdicts.
 *
 * `dedupeKey` and `duplicateOf` are here because a duplicate is the single most common reason
 * to reject, and spotting one otherwise means searching the board by hand: the server looks
 * up the other holder of the key for every row on the page (§5.8) precisely so this sheet can
 * answer "has this already been posted?" without leaving it.
 *
 * `reportCount` is shown here and nowhere public — it is queue ordering for an administrator,
 * and a weapon for everyone else.
 */
export function ReviewSheet({ post, open, onOpenChange, onApprove, onReject, onClose, onDelete }: ReviewSheetProps) {
	const { i18n } = useLingui();

	if (post === null) return null;

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent className="w-full sm:max-w-2xl">
				<SheetHeader>
					<SheetTitle>
						{post.role} · {post.company}
					</SheetTitle>
					<SheetDescription>
						<Trans>Everything the board stores about this submission.</Trans>
					</SheetDescription>
				</SheetHeader>

				<div className="flex-1 overflow-y-auto px-4">
					<div className="flex flex-wrap items-center gap-2">
						<PostStatusBadge status={post.status} />
						<Badge variant="outline">{i18n.t(batchLabels[post.batch])}</Badge>
						<Badge variant="outline">
							<Trans>Reports</Trans>: <span className="tabular-nums">{post.reportCount}</span>
						</Badge>
					</div>

					<dl className="mt-4 divide-y rounded-xl border">
						<Row label={t`Submitted by`}>
							{post.createdBy !== null ? (
								<span>
									{post.createdBy.name} <span className="text-muted-foreground text-xs">{post.createdBy.email}</span>
								</span>
							) : (
								<EmptyValue />
							)}
						</Row>
						<Row label={t`Last reviewed by`}>{post.reviewedBy !== null ? post.reviewedBy.name : <EmptyValue />}</Row>
						<Row label={t`Employment type`}>
							{enumLabels(i18n, employmentTypeLabels, post.employmentType).join(", ")}
						</Row>
						<Row label={t`Work mode`}>{enumLabels(i18n, workModeLabels, post.workMode).join(", ")}</Row>
						<Row label={t`Work intensity`}>{enumLabels(i18n, workIntensityLabels, post.workIntensity).join(", ")}</Row>
						<Row label={t`Locations`}>{post.locations.join(" / ")}</Row>
						<Row label={t`Education`}>{enumLabels(i18n, educationLabels, post.educationRequired).join(", ")}</Row>
						<Row label={t`Benefits`}>{enumLabels(i18n, benefitLabels, post.benefits).join(", ")}</Row>
						{post.tags.length > 0 && <Row label={t`Tags`}>{post.tags.join(" / ")}</Row>}
						<Row label={t`Salary`}>{post.salaryText ?? <EmptyValue />}</Row>
						<Row label={t`Deadline`}>
							{post.rolling ? (
								<Trans>Applications accepted indefinitely</Trans>
							) : post.deadline !== null ? (
								<span className="tabular-nums">{i18n.date(post.deadline)}</span>
							) : (
								<EmptyValue />
							)}
						</Row>
						<Row label={t`Where this came from`}>
							{post.source !== null ? i18n.t(sourceLabels[post.source]) : <EmptyValue />}
						</Row>
						<Row label={t`Application link`}>
							{post.applyUrl !== null ? <ExternalLink href={post.applyUrl} /> : <EmptyValue />}
						</Row>
						<Row label={t`Original announcement`}>
							{post.sourceUrl !== null ? <ExternalLink href={post.sourceUrl} /> : <EmptyValue />}
						</Row>
						<Row label={t`Contact`}>
							{post.contact !== null ? (
								<span>
									{i18n.t(contactKindLabels[post.contact.kind])}
									{post.contact.referralCode !== null ? ` · ${post.contact.referralCode}` : ""}: {post.contact.value}
								</span>
							) : (
								<EmptyValue />
							)}
						</Row>
						<Row label={t`Submitted`}>{i18n.date(post.createdAt)}</Row>
						<Row label={t`Last edited`}>{i18n.date(post.updatedAt)}</Row>
						<Row label={t`Published`}>{post.publishedAt !== null ? i18n.date(post.publishedAt) : <EmptyValue />}</Row>
						{post.rejectionReason !== null && <Row label={t`Rejection reason`}>{post.rejectionReason}</Row>}
						<Row label={t`Dedupe key`}>
							<code className="wrap-anywhere text-xs">{post.dedupeKey}</code>
						</Row>
						<Row label={t`Possible duplicate`}>
							{post.duplicateOf !== null ? (
								<span className="flex flex-wrap items-center gap-x-2">
									{post.duplicateOf.company} · {post.duplicateOf.role}
									<PostStatusBadge status={post.duplicateOf.status} />
									{post.duplicateOf.status === "published" && (
										<Link
											to="/jobs/$postId"
											params={{ postId: post.duplicateOf.id }}
											className="text-primary text-xs underline-offset-4 hover:underline"
										>
											<Trans>Open</Trans>
										</Link>
									)}
								</span>
							) : (
								<EmptyValue />
							)}
						</Row>
					</dl>

					{post.summary !== null && (
						<section className="mt-4 space-y-2">
							<h3 className="font-medium text-sm">
								<Trans>Summary</Trans>
							</h3>
							<p className="whitespace-pre-line text-muted-foreground text-sm">{post.summary}</p>
						</section>
					)}

					<Separator className="my-4" />

					{post.status === "published" && (
						<Button variant="outline" size="sm" nativeButton={false}>
							<Link to="/jobs/$postId" params={{ postId: post.id }}>
								<ArrowSquareOutIcon />
								<Trans>Open on the board</Trans>
							</Link>
						</Button>
					)}
				</div>

				<SheetFooter>
					<Button variant="outline" onClick={() => onDelete(post)}>
						<TrashIcon />
						<Trans>Delete</Trans>
					</Button>
					<Button variant="outline" onClick={() => onClose(post)}>
						<ProhibitIcon />
						<Trans>Take down</Trans>
					</Button>
					<Button variant="outline" onClick={() => onReject(post)}>
						<FlagIcon />
						<Trans>Reject</Trans>
					</Button>
					<Button onClick={() => onApprove(post)}>
						<CheckIcon />
						<Trans>Approve</Trans>
					</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}

type RowProps = {
	label: ReactNode;
	children: ReactNode;
};

function Row({ label, children }: RowProps) {
	return (
		<div className={cn("flex flex-wrap items-start gap-x-4 gap-y-1 px-3 py-2 text-sm")}>
			<dt className="w-40 shrink-0 text-muted-foreground text-xs">{label}</dt>
			<dd className="wrap-anywhere min-w-0 flex-1">{children}</dd>
		</div>
	);
}

function EmptyValue() {
	return <span className="text-muted-foreground text-xs">—</span>;
}

function ExternalLink({ href }: { href: string }) {
	return (
		<a
			href={href}
			target="_blank"
			rel="noopener noreferrer"
			className="wrap-anywhere text-primary text-xs hover:underline"
		>
			{href}
		</a>
	);
}
