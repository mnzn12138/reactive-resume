import type { RecruitmentPost } from "../types";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { Badge } from "@reactive-resume/ui/components/badge";
import { Button } from "@reactive-resume/ui/components/button";
import { batchLabels, benefitLabels, educationLabels, employmentTypeLabels } from "../labels";
import { AddToApplicationsButton } from "./add-to-applications-button";
import { AvailabilityBadge } from "./availability-badge";
import { CompanyLogo } from "./company-logo";
import { EnumBadgeList } from "./enum-badge-list";

type PostCardProps = {
	post: RecruitmentPost;
	onTrack: (post: RecruitmentPost) => void;
	isAuthenticated: boolean;
	loginHref: string;
};

/**
 * Narrow-screen stand-in for `PostTable`.
 *
 * Same data, read as a card rather than scanned as a row: below `md` the nine columns collapse
 * into something unusable, and a job board is mostly opened on a phone between lectures.
 */
export function PostCard({ post, onTrack, isAuthenticated, loginHref }: PostCardProps) {
	const { i18n } = useLingui();

	return (
		<article className="space-y-3 rounded-xl border bg-card p-4">
			<header className="flex items-start gap-x-3">
				<CompanyLogo company={post.company} logoUrl={post.companyLogoUrl} />

				<div className="min-w-0 flex-1">
					<p className="truncate font-medium">{post.company}</p>

					<Link
						to="/jobs/$postId"
						params={{ postId: post.id }}
						className="line-clamp-2 text-primary text-sm underline-offset-4 hover:underline"
					>
						{post.role}
					</Link>
				</div>

				<Button
					size="icon-sm"
					variant="ghost"
					nativeButton={false}
					aria-label={t`View details`}
					render={
						<Link to="/jobs/$postId" params={{ postId: post.id }}>
							<ArrowSquareOutIcon />
						</Link>
					}
				/>
			</header>

			<div className="flex flex-wrap items-center gap-2">
				<Badge variant="outline">{i18n.t(batchLabels[post.batch])}</Badge>

				<AvailabilityBadge availability={post.availability} daysUntilDeadline={post.daysUntilDeadline} />
			</div>

			{post.locations.length > 0 && <p className="text-muted-foreground text-xs">{post.locations.join(" / ")}</p>}

			{post.employmentType.length > 0 && (
				<EnumBadgeList values={post.employmentType} labels={employmentTypeLabels} max={4} />
			)}

			<div className="space-y-1.5">
				<div className="flex items-center gap-x-2">
					<span className="w-16 shrink-0 text-muted-foreground text-xs">
						<Trans>Education</Trans>
					</span>
					<EnumBadgeList values={post.educationRequired} labels={educationLabels} max={2} />
				</div>

				<div className="flex items-center gap-x-2">
					<span className="w-16 shrink-0 text-muted-foreground text-xs">
						<Trans>Benefits</Trans>
					</span>
					<EnumBadgeList values={post.benefits} labels={benefitLabels} max={2} />
				</div>
			</div>

			<AddToApplicationsButton
				post={post}
				isAuthenticated={isAuthenticated}
				loginHref={loginHref}
				onStartTracking={() => onTrack(post)}
				className="w-full"
			/>
		</article>
	);
}
