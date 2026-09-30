import type { ReactNode } from "react";
import type { RecruitmentPostDetail } from "../types";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { ArrowSquareOutIcon, CalendarBlankIcon, MegaphoneIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { useCallback } from "react";
import { buildApplicationDraft } from "@reactive-resume/api/features/recruitment/convert";
import { Badge } from "@reactive-resume/ui/components/badge";
import { Button } from "@reactive-resume/ui/components/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@reactive-resume/ui/components/empty";
import { Separator } from "@reactive-resume/ui/components/separator";
import { Skeleton } from "@reactive-resume/ui/components/skeleton";
import { cn } from "@reactive-resume/utils/style";
import { AddToApplicationsButton, useApplicationDraftSheet } from "../components/add-to-applications-button";
import { AvailabilityBadge } from "../components/availability-badge";
import { BookmarkButton } from "../components/bookmark-button";
import { CompanyLogo } from "../components/company-logo";
import { ContactPanel } from "../components/contact-panel";
import { EnumBadgeList } from "../components/enum-badge-list";
import { JobsShell } from "../components/jobs-shell";
import { ReportButton, useReportDialog } from "../components/report-dialog";
import {
	batchLabels,
	benefitLabels,
	educationLabels,
	employmentTypeLabels,
	sourceLabels,
	workIntensityLabels,
	workModeLabels,
} from "../labels";

type JobsDetailPageProps = {
	post: RecruitmentPostDetail | undefined;
	isLoading: boolean;
	isAuthenticated: boolean;
	loginHref: string;
};

/**
 * One posting — §5.5's detail page.
 *
 * The states are resolved here and the body delegated below, so the masthead (and therefore the
 * way back home) stays visible while the post loads or turns out to be gone.
 */
export function JobsDetailPage({ post, isLoading, isAuthenticated, loginHref }: JobsDetailPageProps) {
	let content: ReactNode;

	if (isLoading && post === undefined) {
		content = (
			<div className="space-y-3">
				<Skeleton className="h-8 w-64" />
				<Skeleton className="h-64 w-full" />
			</div>
		);
	} else if (post === undefined) {
		content = (
			<Empty className="border-border">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<MegaphoneIcon />
					</EmptyMedia>
					<EmptyTitle>
						<Trans>This role is no longer listed.</Trans>
					</EmptyTitle>
					<EmptyDescription>
						<Trans>It may have been taken down, or its deadline has passed.</Trans>
					</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	} else {
		content = <PostDetailBody post={post} isAuthenticated={isAuthenticated} loginHref={loginHref} />;
	}

	return (
		<JobsShell
			isAuthenticated={isAuthenticated}
			title={post?.role ?? t`Campus jobs`}
			description={post?.company ?? <Trans>Campus recruitment opening.</Trans>}
		>
			{content}
		</JobsShell>
	);
}

type PostDetailBodyProps = {
	post: RecruitmentPostDetail;
	isAuthenticated: boolean;
	loginHref: string;
};

/**
 * The post itself.
 *
 * The main action sits in a sticky panel beside the content rather than at its end, because this
 * page exists to be acted on: someone who read the whole description should not have to scroll
 * back up to track it. Nothing here writes to the board — the only mutation available is the
 * application the visitor confirms themselves.
 */
function PostDetailBody({ post, isAuthenticated, loginHref }: PostDetailBodyProps) {
	const { i18n } = useLingui();
	const { startTracking, sheet } = useApplicationDraftSheet();
	const { openReport, reported, dialog: reportDialog } = useReportDialog(post.id);

	const track = useCallback(() => startTracking(buildApplicationDraft(post)), [post, startTracking]);

	return (
		<div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
			<div className="space-y-5">
				<header className="flex items-start gap-x-3">
					<CompanyLogo company={post.company} logoUrl={post.companyLogoUrl} className="size-12" />

					<div className="min-w-0 space-y-1">
						<p className="text-muted-foreground text-xs">{post.company}</p>
						<h2 className="font-semibold text-xl tracking-tight">{post.role}</h2>

						<div className="flex flex-wrap items-center gap-2">
							<Badge variant="outline">{i18n.t(batchLabels[post.batch])}</Badge>
							<AvailabilityBadge availability={post.availability} daysUntilDeadline={post.daysUntilDeadline} />
							{/* The id is null until `application.recruitment_post_id` ships; the link is already
							    wired so the badge becomes a way in rather than a dead end on the day it isn't. */}
							{post.myApplicationId !== null && (
								<Link to="/dashboard/applications" aria-label={t`Open my applications`}>
									<Badge variant="secondary">
										<Trans>Already in my applications</Trans>
									</Badge>
								</Link>
							)}
						</div>
					</div>
				</header>

				<dl className="divide-y rounded-xl border">
					<FieldRow label={t`Company`}>{post.company}</FieldRow>
					<FieldRow label={t`Role`}>{post.role}</FieldRow>
					<FieldRow label={t`Batch`}>
						<Badge variant="outline">{i18n.t(batchLabels[post.batch])}</Badge>
					</FieldRow>
					<FieldRow label={t`Employment type`}>
						<EnumBadgeList values={post.employmentType} labels={employmentTypeLabels} max={4} />
					</FieldRow>
					<FieldRow label={t`Work mode`}>
						<EnumBadgeList values={post.workMode} labels={workModeLabels} max={3} />
					</FieldRow>
					<FieldRow label={t`Work intensity`}>
						<EnumBadgeList values={post.workIntensity} labels={workIntensityLabels} max={2} />
					</FieldRow>
					<FieldRow label={t`Locations`}>{post.locations.join(" / ")}</FieldRow>
					<FieldRow label={t`Education`}>
						<EnumBadgeList values={post.educationRequired} labels={educationLabels} max={6} />
					</FieldRow>
					<FieldRow label={t`Benefits`}>
						<EnumBadgeList values={post.benefits} labels={benefitLabels} max={7} />
					</FieldRow>
					{post.tags.length > 0 && (
						<FieldRow label={t`Tags`}>
							<span className="text-muted-foreground text-xs">{post.tags.join(" / ")}</span>
						</FieldRow>
					)}
					<FieldRow label={t`Salary`}>{post.salaryText ?? <EmptyValue />}</FieldRow>
					<FieldRow label={t`Deadline`}>
						<span className="tabular-nums">{formatDeadline(post, i18n.locale)}</span>
					</FieldRow>
					<FieldRow label={t`Source`}>
						{post.source !== null ? (
							<Badge variant="outline">{i18n.t(sourceLabels[post.source])}</Badge>
						) : (
							<EmptyValue />
						)}
					</FieldRow>
				</dl>

				{post.summary !== null && (
					<section className="space-y-2">
						<h3 className="font-medium text-sm">
							<Trans>Summary</Trans>
						</h3>
						<p className="whitespace-pre-line text-muted-foreground text-sm">{post.summary}</p>
					</section>
				)}

				{post.sourceUrl !== null && (
					<Button variant="outline" size="sm" nativeButton={false}>
						<a href={post.sourceUrl} target="_blank" rel="noreferrer">
							<ArrowSquareOutIcon />
							<Trans>Original announcement</Trans>
						</a>
					</Button>
				)}
			</div>

			<aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
				{post.applyUrl !== null && (
					<Button className="w-full" nativeButton={false}>
						<a href={post.applyUrl} target="_blank" rel="noreferrer">
							<ArrowSquareOutIcon />
							<Trans>Apply on the company's site</Trans>
						</a>
					</Button>
				)}

				<AddToApplicationsButton
					post={post}
					variant={post.applyUrl !== null ? "outline" : "default"}
					className="w-full"
					isAuthenticated={isAuthenticated}
					loginHref={loginHref}
					onStartTracking={track}
				/>

				<div className="flex items-center gap-x-2">
					<BookmarkButton
						postId={post.id}
						bookmarked={post.bookmarked}
						isAuthenticated={isAuthenticated}
						loginHref={loginHref}
						className="flex-1"
					/>

					<ReportButton onClick={openReport} reported={reported} className="flex-1" />
				</div>

				<ContactPanel contact={post.contact} isAuthenticated={isAuthenticated} loginHref={loginHref} />

				<Separator />

				<p className="flex items-start gap-x-2 text-muted-foreground text-xs">
					<CalendarBlankIcon className="mt-0.5 shrink-0" />
					<Trans>Freshness is decided by the server, so it reads the same wherever this link is opened.</Trans>
				</p>
			</aside>

			{sheet}
			{reportDialog}
		</div>
	);
}

type FieldRowProps = {
	label: ReactNode;
	children: ReactNode;
	className?: string;
};

/** Label/value pair shared by every metadata row, so field labels stay vertically aligned. */
function FieldRow({ label, children, className }: FieldRowProps) {
	return (
		<div className={cn("flex flex-wrap items-start gap-x-4 gap-y-1 px-3 py-2 text-sm", className)}>
			<dt className="w-40 shrink-0 text-muted-foreground text-xs">{label}</dt>
			<dd className="wrap-anywhere min-w-0 flex-1">{children}</dd>
		</div>
	);
}

/** A visible dash, so a missing value reads as "none given" rather than as a rendering bug. */
function EmptyValue() {
	return <span className="text-muted-foreground text-xs">—</span>;
}

/**
 * Deadline in words rather than as a raw timestamp.
 *
 * `rolling` and "no deadline" are genuinely different answers: the first accepts applications
 * indefinitely, the second simply never stated a date.
 */
function formatDeadline(post: RecruitmentPostDetail, locale: string): string {
	if (post.rolling) return t`Applications accepted indefinitely`;
	if (post.deadline === null) return "—";

	return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(post.deadline);
}
