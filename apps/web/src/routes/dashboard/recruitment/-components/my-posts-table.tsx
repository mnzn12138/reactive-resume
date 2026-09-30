import type { OnChangeFn, PaginationState } from "@reactive-resume/ui/components/data-table";
import type { RecruitmentPostOwner } from "@/features/recruitment/types";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { ArrowSquareOutIcon, DotsThreeVerticalIcon, PencilSimpleIcon, TrashIcon } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { createColumnHelper, DataTable } from "@reactive-resume/ui/components/data-table";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@reactive-resume/ui/components/dropdown-menu";
import { toast } from "@reactive-resume/ui/components/toast";
import { PostStatusBadge } from "@/features/recruitment/components/post-status-badge";
import { recruitmentErrorMessage } from "@/features/recruitment/errors";
import { useConfirm } from "@/hooks/use-confirm";
import { orpc } from "@/libs/orpc/client";

type MyPostsTableProps = {
	posts: RecruitmentPostOwner[];
	total: number;
	isLoading: boolean;
	pagination: PaginationState;
	onPaginationChange: OnChangeFn<PaginationState>;
	emptyMessage: string;
	/** Opens the edit sheet with this row. */
	onEdit: (post: RecruitmentPostOwner) => void;
};

/**
 * 「我的提交」 — the submitter's own posts in every moderation state.
 *
 * The rejection reason is rendered inline rather than in a tooltip or a detail view: a post
 * that was refused and says nothing about why is the exact "silent disappearance" the design
 * forbids (§5.8), and this is the only surface the submitter has.
 */
export function MyPostsTable({
	posts,
	total,
	isLoading,
	pagination,
	onPaginationChange,
	emptyMessage,
	onEdit,
}: MyPostsTableProps) {
	const { i18n } = useLingui();
	const queryClient = useQueryClient();
	const confirm = useConfirm();

	const invalidate = () => {
		void queryClient.invalidateQueries({ queryKey: orpc.recruitment.mine.queryKey() });
		void queryClient.invalidateQueries({ queryKey: orpc.recruitment.list.queryKey() });
	};

	const remove = useMutation(
		orpc.recruitment.delete.mutationOptions({
			onSuccess: invalidate,
			onError: (error: unknown) => toast.add({ type: "error", description: recruitmentErrorMessage(error) }),
		}),
	);

	const handleDelete = useCallback(
		async (target: RecruitmentPostOwner) => {
			const confirmed = await confirm(t`Withdraw this submission?`, {
				description: t`${target.role} at ${target.company} will be deleted. Reports and bookmarks go with it; applications you already created from it stay.`,
				confirmText: t`Withdraw`,
			});

			if (confirmed) remove.mutate({ id: target.id });
		},
		[confirm, remove.mutate],
	);

	const columnHelper = createColumnHelper<RecruitmentPostOwner>();

	const columns = useMemo(
		() => [
			columnHelper.accessor("role", {
				header: t`Role`,
				enableSorting: false,
				cell: (info) => (
					<div className="flex flex-col gap-y-1">
						<span className="font-medium">{info.getValue()}</span>
						<span className="text-muted-foreground text-xs">{info.row.original.company}</span>
						{info.row.original.status === "rejected" && info.row.original.rejectionReason !== null && (
							<span className="text-destructive text-xs" data-testid="rejection-reason">
								{info.row.original.rejectionReason}
							</span>
						)}
					</div>
				),
			}),
			columnHelper.accessor("status", {
				header: t`Status`,
				enableSorting: false,
				cell: (info) => <PostStatusBadge status={info.getValue()} />,
			}),
			columnHelper.accessor("locations", {
				header: t`Locations`,
				enableSorting: false,
				cell: (info) =>
					info.getValue().length > 0 ? (
						<span className="text-muted-foreground text-xs">{info.getValue().join(" / ")}</span>
					) : (
						<span className="text-muted-foreground text-xs">—</span>
					),
			}),
			columnHelper.accessor("createdAt", {
				header: t`Submitted`,
				enableSorting: false,
				cell: (info) => <span className="text-muted-foreground text-xs">{i18n.date(info.getValue())}</span>,
			}),
			columnHelper.display({
				id: "actions",
				header: () => <span className="sr-only">{t`Actions`}</span>,
				cell: (info) => {
					const target = info.row.original;

					return (
						<div className="flex justify-end">
							<DropdownMenu>
								<DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="size-8" />}>
									<DotsThreeVerticalIcon />
									<span className="sr-only">{t`Actions`}</span>
								</DropdownMenuTrigger>

								<DropdownMenuContent align="end">
									<DropdownMenuItem onClick={() => onEdit(target)}>
										<PencilSimpleIcon />
										<Trans>Edit</Trans>
									</DropdownMenuItem>

									{target.status === "published" && (
										<DropdownMenuItem
											render={
												<Link to="/jobs/$postId" params={{ postId: target.id }}>
													<ArrowSquareOutIcon />
													<Trans>Open on the board</Trans>
												</Link>
											}
										/>
									)}

									<DropdownMenuSeparator />

									<DropdownMenuItem
										variant="destructive"
										disabled={remove.isPending}
										onClick={() => void handleDelete(target)}
									>
										<TrashIcon />
										<Trans>Withdraw</Trans>
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						</div>
					);
				},
			}),
		],
		[handleDelete, i18n, onEdit, remove.isPending, columnHelper.display, columnHelper.accessor],
	);

	return (
		<DataTable
			columns={columns}
			data={posts}
			rowCount={total}
			isLoading={isLoading}
			emptyMessage={emptyMessage}
			initialPageSize={pagination.pageSize}
			pagination={pagination}
			onPaginationChange={onPaginationChange}
			previousLabel={i18n._(t`Previous`)}
			nextLabel={i18n._(t`Next`)}
			pageLabel={({ page, pageCount }) => (
				<Trans>
					Page {page} of {pageCount}
				</Trans>
			)}
		/>
	);
}
