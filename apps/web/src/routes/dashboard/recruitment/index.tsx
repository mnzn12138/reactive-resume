import type { RecruitmentPost, RecruitmentPostOwner } from "@/features/recruitment/types";
import { i18n } from "@lingui/core";
import { msg, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { PlusIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { buildApplicationDraft } from "@reactive-resume/api/features/recruitment/convert";
import { Button } from "@reactive-resume/ui/components/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@reactive-resume/ui/components/tabs";
import { useApplicationDraftSheet } from "@/features/recruitment/components/add-to-applications-button";
import { PostFormSheet } from "@/features/recruitment/components/post-form-sheet";
import { PostTable } from "@/features/recruitment/components/post-table";
import { readRecruitmentFlags } from "@/features/recruitment/flags";
import { orpc } from "@/libs/orpc/client";
import { createNoindexFollowMeta } from "@/libs/seo";
import { MyPostsTable } from "./-components/my-posts-table";

const PAGE_SIZE = 20;

export const Route = createFileRoute("/dashboard/recruitment/")({
	component: RouteComponent,

	/** Same gate as `/jobs`: a switched-off board is a 404, not an empty page. */
	beforeLoad: ({ context }) => {
		if (!context.flags.recruitmentBoardEnabled) throw notFound();
	},

	head: () => ({
		meta: [createNoindexFollowMeta(), { title: `${i18n._(msg`My submissions`)} · ${i18n._(msg`Dashboard`)}` }],
	}),
});

function RouteComponent() {
	const { i18n } = useLingui();
	const { flags } = Route.useRouteContext();
	const board = readRecruitmentFlags(flags);

	const [tab, setTab] = useState<"mine" | "bookmarks">("mine");
	const [page, setPage] = useState(1);
	const [editing, setEditing] = useState<RecruitmentPostOwner | null>(null);
	const [formOpen, setFormOpen] = useState(false);
	// Set when the server refuses a submission because the instance switched it off. The entry
	// point then disappears for the rest of the visit instead of offering a form that can only fail.
	const [submissionClosed, setSubmissionClosed] = useState(false);

	const { startTracking, sheet } = useApplicationDraftSheet();

	const offset = (page - 1) * PAGE_SIZE;

	const mine = useQuery(orpc.recruitment.mine.queryOptions({ input: { limit: PAGE_SIZE, offset } }));

	const bookmarks = useQuery(orpc.recruitment.bookmarks.queryOptions({ input: { limit: PAGE_SIZE, offset } }));

	const openCreate = useCallback(() => {
		setEditing(null);
		setFormOpen(true);
	}, []);

	const openEdit = useCallback((post: RecruitmentPostOwner) => {
		setEditing(post);
		setFormOpen(true);
	}, []);

	// The mapping is the shared one from `packages/api`, so a bookmarked post pre-fills the
	// application form exactly the way the board's own detail page does.
	const track = useCallback((post: RecruitmentPost) => startTracking(buildApplicationDraft(post)), [startTracking]);

	const canSubmit = board.submissionEnabled && !submissionClosed;

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="space-y-1">
					<h1 className="font-semibold text-2xl tracking-tight">
						<Trans>My campus posts</Trans>
					</h1>
					<p className="text-muted-foreground text-sm">
						<Trans>Openings you shared, and the ones you bookmarked.</Trans>
					</p>
				</div>

				{canSubmit && (
					<Button onClick={openCreate}>
						<PlusIcon />
						<Trans>Share an opening</Trans>
					</Button>
				)}
			</div>

			<Tabs value={tab} onValueChange={(value) => setTab(value === "bookmarks" ? "bookmarks" : "mine")}>
				<TabsList>
					<TabsTrigger value="mine">
						<Trans>My submissions</Trans>
					</TabsTrigger>
					<TabsTrigger value="bookmarks">
						<Trans>Bookmarks</Trans>
					</TabsTrigger>
				</TabsList>

				<TabsContent value="mine" className="space-y-3">
					<MyPostsTable
						posts={mine.data?.items ?? []}
						total={mine.data?.total ?? 0}
						isLoading={mine.isLoading}
						emptyMessage={i18n._(
							canSubmit
								? t`You have not shared an opening yet.`
								: t`You have not shared an opening yet, and sharing is turned off on this instance.`,
						)}
						pagination={{ pageIndex: page - 1, pageSize: PAGE_SIZE }}
						onPaginationChange={(updater) => {
							const next =
								typeof updater === "function" ? updater({ pageIndex: page - 1, pageSize: PAGE_SIZE }) : updater;
							setPage(next.pageIndex + 1);
						}}
						onEdit={openEdit}
					/>
				</TabsContent>

				<TabsContent value="bookmarks" className="space-y-3">
					<PostTable
						posts={bookmarks.data?.items ?? []}
						total={bookmarks.data?.total ?? 0}
						isLoading={bookmarks.isLoading}
						emptyMessage={i18n._(t`You have not bookmarked any openings yet.`)}
						pagination={{ pageIndex: page - 1, pageSize: PAGE_SIZE }}
						onPaginationChange={(updater) => {
							const next =
								typeof updater === "function" ? updater({ pageIndex: page - 1, pageSize: PAGE_SIZE }) : updater;
							setPage(next.pageIndex + 1);
						}}
						onTrack={track}
						isAuthenticated
						loginHref="/auth/login?callbackURL=%2Fdashboard%2Frecruitment"
					/>
				</TabsContent>
			</Tabs>

			<PostFormSheet
				open={formOpen}
				onOpenChange={setFormOpen}
				post={editing}
				requireReview={board.requireReview}
				onSubmissionDisabled={() => setSubmissionClosed(true)}
			/>

			{sheet}
		</div>
	);
}
