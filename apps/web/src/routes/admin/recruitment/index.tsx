import type { OnChangeFn, PaginationState } from "@reactive-resume/ui/components/data-table";
import type { RecruitmentPostAdmin } from "@/features/recruitment/types";
import { i18n } from "@lingui/core";
import { msg, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, notFound, stripSearchParams, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import z from "zod";
import { Badge } from "@reactive-resume/ui/components/badge";
import { Button } from "@reactive-resume/ui/components/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@reactive-resume/ui/components/input-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@reactive-resume/ui/components/tabs";
import { toast } from "@reactive-resume/ui/components/toast";
import { Combobox } from "@/components/ui/combobox";
import { recruitmentErrorMessage } from "@/features/recruitment/errors";
import { statusLabels } from "@/features/recruitment/labels";
import { useConfirm } from "@/hooks/use-confirm";
import { orpc } from "@/libs/orpc/client";
import { createNoindexFollowMeta } from "@/libs/seo";
import { RejectDialog } from "./-components/reject-dialog";
import { ReportTable } from "./-components/report-table";
import { ReviewSheet } from "./-components/review-sheet";
import { ReviewTable } from "./-components/review-table";

const PAGE_SIZE = 25;

/** Every moderation state, plus "any", so a reviewer can also find published posts. */
const STATUS_VALUES = ["draft", "pending", "published", "rejected", "closed", "expired"] as const;

const searchSchema = z.object({
	tab: z.enum(["posts", "reports"]).default("posts"),
	search: z.string().default(""),
	status: z.enum(STATUS_VALUES).optional(),
	sortBy: z.enum(["createdAt", "publishedAt", "deadline", "reportCount"]).default("createdAt"),
	sortOrder: z.enum(["asc", "desc"]).default("desc"),
	page: z.number().int().min(1).default(1),
});

type Search = z.output<typeof searchSchema>;

const defaultSearch: Search = { tab: "posts", search: "", sortBy: "createdAt", sortOrder: "desc", page: 1 };

export const Route = createFileRoute("/admin/recruitment/")({
	component: RouteComponent,
	validateSearch: searchSchema,
	search: { middlewares: [stripSearchParams(defaultSearch)] },

	// The board switch gates the console too: with the board off there is nothing to moderate,
	// and a console that renders an empty queue would suggest the data went missing.
	beforeLoad: ({ context }) => {
		if (!context.flags.recruitmentBoardEnabled) throw notFound();
	},

	head: () => ({
		meta: [createNoindexFollowMeta(), { title: `${i18n._(msg`Recruitment review`)} · ${i18n._(msg`Admin`)}` }],
	}),
});

function RouteComponent() {
	const { i18n } = useLingui();
	const { tab, search, status, sortBy, sortOrder, page } = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const queryClient = useQueryClient();
	const confirm = useConfirm();

	const [reviewing, setReviewing] = useState<RecruitmentPostAdmin | null>(null);
	const [rejecting, setRejecting] = useState<RecruitmentPostAdmin | null>(null);
	const [searchDraft, setSearchDraft] = useState(search);

	// Typing stays local; the URL — and so the query — follows once it settles.
	useEffect(() => {
		if (searchDraft === search) return;
		const timer = setTimeout(() => {
			void navigate({ search: (prev: Search) => ({ ...prev, search: searchDraft, page: 1 }), replace: true });
		}, 300);
		return () => clearTimeout(timer);
	}, [searchDraft, search, navigate]);

	const offset = (page - 1) * PAGE_SIZE;

	const posts = useQuery(
		orpc.admin.recruitment.posts.list.queryOptions({
			input: {
				...(search ? { search } : {}),
				...(status ? { status } : {}),
				sortBy,
				sortOrder,
				limit: PAGE_SIZE,
				offset,
			},
		}),
	);

	const reports = useQuery(orpc.admin.recruitment.reports.list.queryOptions({ input: { limit: PAGE_SIZE, offset } }));

	const invalidate = () => {
		void queryClient.invalidateQueries({ queryKey: orpc.admin.recruitment.posts.list.queryKey() });
		void queryClient.invalidateQueries({ queryKey: orpc.admin.recruitment.reports.list.queryKey() });
	};

	const onError = (error: unknown) => toast.add({ type: "error", description: recruitmentErrorMessage(error) });

	const moderate = useMutation(
		orpc.admin.recruitment.posts.update.mutationOptions({
			onSuccess: (result) => {
				setReviewing(null);
				invalidate();
				toast.add({
					type: "success",
					description:
						result.status === "published" ? t`Approved — it is on the board now.` : t`Taken down. It is off the board.`,
				});
			},
			onError,
		}),
	);

	const remove = useMutation(
		orpc.admin.recruitment.posts.delete.mutationOptions({
			onSuccess: () => {
				setReviewing(null);
				invalidate();
				toast.add({ type: "success", description: t`Deleted. Applications created from it were kept.` });
			},
			onError,
		}),
	);

	const statusOptions = [
		{ value: "all", label: i18n._(t`Any state`) },
		...STATUS_VALUES.map((value) => ({ value, label: i18n.t(statusLabels[value]) })),
	];

	const patchSearch = (patch: Partial<Search>) => {
		void navigate({ search: (prev: Search) => ({ ...prev, ...patch, page: 1 }), replace: true });
	};

	const onClose = async (post: RecruitmentPostAdmin) => {
		const confirmed = await confirm(t`Take this post down?`, {
			description: t`${post.role} at ${post.company} comes off the board. The submitter can share it again, and it will come back here for review.`,
			confirmText: t`Take down`,
		});

		if (confirmed) moderate.mutate({ action: "close", id: post.id });
	};

	const onDelete = async (post: RecruitmentPostAdmin) => {
		const confirmed = await confirm(t`Delete this post?`, {
			description: t`${post.role} at ${post.company} is deleted for good, together with its reports and bookmarks. Applications created from it are kept. This cannot be undone.`,
			confirmText: t`Delete`,
		});

		if (confirmed) remove.mutate({ id: post.id });
	};

	const pagination: PaginationState = { pageIndex: page - 1, pageSize: PAGE_SIZE };

	// Paging lives in the URL like every other filter here, so a reviewer can send a colleague
	// "page 3 of the rejected ones" and have it open on the same rows.
	const onPaginationChange: OnChangeFn<PaginationState> = (updater) => {
		const next = typeof updater === "function" ? updater(pagination) : updater;
		void navigate({ search: (prev: Search) => ({ ...prev, page: next.pageIndex + 1 }), replace: true });
	};

	return (
		<div className="flex flex-col gap-4">
			<div>
				<h1 className="font-semibold text-2xl tracking-tight">
					<Trans>Recruitment review</Trans>
				</h1>
				<p className="text-muted-foreground text-sm">
					<Trans>Approve, reject, take down or delete submissions, and work through reports.</Trans>
				</p>
			</div>

			<Tabs value={tab} onValueChange={(value) => patchSearch({ tab: value === "reports" ? "reports" : "posts" })}>
				<TabsList>
					<TabsTrigger value="posts">
						<Trans>Review queue</Trans>
					</TabsTrigger>
					<TabsTrigger value="reports">
						<Trans>Reports</Trans>
						{reports.data !== undefined && reports.data.total > 0 && (
							<Badge variant="destructive" className="ms-2 tabular-nums">
								{reports.data.total}
							</Badge>
						)}
					</TabsTrigger>
				</TabsList>

				<TabsContent value="posts" className="space-y-3">
					<div className="flex flex-wrap items-center gap-2">
						<InputGroup className="max-w-xs">
							<InputGroupAddon>
								<MagnifyingGlassIcon />
							</InputGroupAddon>
							<InputGroupInput
								value={searchDraft}
								onChange={(event) => setSearchDraft(event.target.value)}
								placeholder={i18n._(t`Search by company, role or submitter`)}
								aria-label={i18n._(t`Search submissions`)}
							/>
						</InputGroup>

						<Combobox
							className="w-40"
							options={statusOptions}
							value={status ?? "all"}
							onValueChange={(value) =>
								patchSearch({ status: value === "all" ? undefined : (value as Search["status"]) })
							}
						/>

						<Combobox
							className="w-44"
							options={[
								{ value: "createdAt", label: i18n._(t`Newest first`) },
								{ value: "reportCount", label: i18n._(t`Most reported`) },
								{ value: "deadline", label: i18n._(t`Deadline`) },
								{ value: "publishedAt", label: i18n._(t`Publication date`) },
							]}
							value={sortBy}
							onValueChange={(value) => patchSearch({ sortBy: (value ?? "createdAt") as Search["sortBy"] })}
						/>

						<Button variant="outline" onClick={() => patchSearch({ sortOrder: sortOrder === "desc" ? "asc" : "desc" })}>
							{sortOrder === "desc" ? <Trans>Descending</Trans> : <Trans>Ascending</Trans>}
						</Button>
					</div>

					<ReviewTable
						posts={posts.data?.items ?? []}
						total={posts.data?.total ?? 0}
						isLoading={posts.isLoading}
						emptyMessage={i18n._(t`Nothing matches these filters.`)}
						pagination={pagination}
						onPaginationChange={onPaginationChange}
						sorting={[{ id: sortBy, desc: sortOrder === "desc" }]}
						onSortingChange={(updater) => {
							const next =
								typeof updater === "function" ? updater([{ id: sortBy, desc: sortOrder === "desc" }]) : updater;
							const first = next.at(0);
							if (!first) return;
							patchSearch({
								sortBy: first.id as Search["sortBy"],
								sortOrder: first.desc ? "desc" : "asc",
							});
						}}
						onOpen={setReviewing}
						onApprove={(post) => moderate.mutate({ action: "approve", id: post.id })}
						onReject={setRejecting}
						onClose={(post) => void onClose(post)}
						onDelete={(post) => void onDelete(post)}
					/>
				</TabsContent>

				<TabsContent value="reports" className="space-y-3">
					<ReportTable
						reports={reports.data?.items ?? []}
						total={reports.data?.total ?? 0}
						isLoading={reports.isLoading}
						emptyMessage={i18n._(t`No reports have been filed.`)}
						pagination={pagination}
						onPaginationChange={onPaginationChange}
					/>
				</TabsContent>
			</Tabs>

			<ReviewSheet
				post={reviewing}
				open={reviewing !== null}
				onOpenChange={(open) => !open && setReviewing(null)}
				onApprove={(post) => moderate.mutate({ action: "approve", id: post.id })}
				onReject={setRejecting}
				onClose={(post) => void onClose(post)}
				onDelete={(post) => void onDelete(post)}
			/>

			<RejectDialog post={rejecting} open={rejecting !== null} onOpenChange={(open) => !open && setRejecting(null)} />
		</div>
	);
}
