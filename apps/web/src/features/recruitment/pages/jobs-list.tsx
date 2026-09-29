import type { PaginationState } from "@reactive-resume/ui/components/data-table";
import type { RecruitmentSearch } from "../hooks/use-recruitment-filters";
import type { RecruitmentPost } from "../types";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { MegaphoneIcon } from "@phosphor-icons/react";
import { useCallback } from "react";
import { buildApplicationDraft } from "@reactive-resume/api/features/recruitment/convert";
import { Button } from "@reactive-resume/ui/components/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@reactive-resume/ui/components/empty";
import { useApplicationDraftSheet } from "../components/add-to-applications-button";
import { JobsShell } from "../components/jobs-shell";
import { PostCard } from "../components/post-card";
import { PostFilters } from "../components/post-filters";
import { PostTable } from "../components/post-table";
import { useRecruitmentFilters } from "../hooks/use-recruitment-filters";

type JobsListPageProps = {
	posts: RecruitmentPost[];
	/** Matching rows across all pages — not the size of the page in hand. */
	total: number;
	isLoading: boolean;
	search: RecruitmentSearch;
	onNavigate: (patch: Partial<RecruitmentSearch>) => void;
	/** Anonymous visitors still get the full board; only the tracking button changes. */
	isAuthenticated: boolean;
	loginHref: string;
	pageSize: number;
};

/**
 * The public board list — §5.1's `/jobs`, §5.4's columns.
 *
 * Everything the visitor can change lives in the URL, so the page has no filter state of its
 * own beyond what the back button already owns. Filter changes reset paging, because keeping
 * "page 4" across a narrower result set silently skips rows instead of showing the head of them.
 */
export function JobsListPage({
	posts,
	total,
	isLoading,
	search,
	onNavigate,
	isAuthenticated,
	loginHref,
	pageSize,
}: JobsListPageProps) {
	const setSearch = useCallback((patch: Partial<RecruitmentSearch>) => onNavigate(patch), [onNavigate]);
	const controller = useRecruitmentFilters({ search, setSearch });
	const { startTracking, sheet } = useApplicationDraftSheet();

	const pagination: PaginationState = { pageIndex: search.page - 1, pageSize };

	const trackPost = useCallback((post: RecruitmentPost) => startTracking(buildApplicationDraft(post)), [startTracking]);

	const onPaginationChange = (updater: PaginationState | ((prev: PaginationState) => PaginationState)) => {
		const next = typeof updater === "function" ? updater(pagination) : updater;
		onNavigate({ page: next.pageIndex + 1 });
	};

	const isEmpty = posts.length === 0;

	return (
		<JobsShell
			isAuthenticated={isAuthenticated}
			title={t`Campus jobs`}
			description={<Trans>Campus recruitment openings shared by this community.</Trans>}
		>
			<div className="space-y-4">
				<PostFilters controller={controller} total={total} />

				{isEmpty && !isLoading ? (
					<Empty className="border-border">
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<MegaphoneIcon />
							</EmptyMedia>
							<EmptyTitle>
								{controller.hasActiveFilters ? (
									<Trans>No roles match these filters.</Trans>
								) : (
									<Trans>No roles have been published yet.</Trans>
								)}
							</EmptyTitle>
							<EmptyDescription>
								<Trans>Try widening your search, or check back after the next hiring batch opens.</Trans>
							</EmptyDescription>
						</EmptyHeader>

						{controller.hasActiveFilters && (
							<EmptyContent>
								<Button variant="outline" size="sm" onClick={controller.reset}>
									<Trans>Clear filters</Trans>
								</Button>
							</EmptyContent>
						)}
					</Empty>
				) : (
					<>
						<div className="hidden md:block">
							<PostTable
								posts={posts}
								total={total}
								isLoading={isLoading}
								pagination={pagination}
								onPaginationChange={onPaginationChange}
								onTrack={trackPost}
								isAuthenticated={isAuthenticated}
								loginHref={loginHref}
								emptyMessage={t`No roles match these filters.`}
							/>
						</div>

						<div className="grid gap-3 md:hidden">
							{posts.map((post) => (
								<PostCard
									key={post.id}
									post={post}
									isAuthenticated={isAuthenticated}
									loginHref={loginHref}
									onTrack={trackPost}
								/>
							))}

							{!isLoading && total > pageSize && (
								<div className="flex items-center justify-center gap-x-2">
									<Button
										variant="outline"
										size="sm"
										disabled={search.page <= 1}
										onClick={() => onNavigate({ page: Math.max(1, search.page - 1) })}
									>
										<Trans>Previous</Trans>
									</Button>
									<Button
										variant="outline"
										size="sm"
										disabled={search.page * pageSize >= total}
										onClick={() => onNavigate({ page: search.page + 1 })}
									>
										<Trans>Next</Trans>
									</Button>
								</div>
							)}
						</div>
					</>
				)}

				{/* One sheet for every row: opened pre-filled, never silently created. */}
				{sheet}
			</div>
		</JobsShell>
	);
}
