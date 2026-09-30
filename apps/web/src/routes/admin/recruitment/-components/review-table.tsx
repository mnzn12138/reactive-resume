import type { OnChangeFn, PaginationState, SortingState } from "@reactive-resume/ui/components/data-table";
import type { RecruitmentPostAdmin } from "@/features/recruitment/types";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { CheckIcon, DotsThreeVerticalIcon, FlagIcon, ProhibitIcon, TrashIcon } from "@phosphor-icons/react";
import { useMemo } from "react";
import { Badge } from "@reactive-resume/ui/components/badge";
import { Button } from "@reactive-resume/ui/components/button";
import { createColumnHelper, DataTable } from "@reactive-resume/ui/components/data-table";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@reactive-resume/ui/components/dropdown-menu";
import { PostStatusBadge } from "@/features/recruitment/components/post-status-badge";

type ReviewTableProps = {
	posts: RecruitmentPostAdmin[];
	total: number;
	isLoading: boolean;
	emptyMessage: string;
	pagination: PaginationState;
	onPaginationChange: OnChangeFn<PaginationState>;
	sorting: SortingState;
	onSortingChange: OnChangeFn<SortingState>;
	/** Opens the full review sheet for one row. */
	onOpen: (post: RecruitmentPostAdmin) => void;
	onApprove: (post: RecruitmentPostAdmin) => void;
	onReject: (post: RecruitmentPostAdmin) => void;
	onClose: (post: RecruitmentPostAdmin) => void;
	onDelete: (post: RecruitmentPostAdmin) => void;
};

/**
 * The review queue — one row per submission, whatever state it is in.
 *
 * All four verdicts live in the row menu rather than behind a detail view: a reviewer works
 * through a queue, and a queue that needs a click per row to reach its only purpose costs
 * twice as many clicks as it needs to.
 *
 * Approve and reject are disabled in the states where they mean nothing, because a button
 * that can only fail is worse than no button — an already-published post has no "approve".
 */
export function ReviewTable({
	posts,
	total,
	isLoading,
	emptyMessage,
	pagination,
	onPaginationChange,
	sorting,
	onSortingChange,
	onOpen,
	onApprove,
	onReject,
	onClose,
	onDelete,
}: ReviewTableProps) {
	const { i18n } = useLingui();

	const columnHelper = createColumnHelper<RecruitmentPostAdmin>();

	const columns = useMemo(
		() => [
			columnHelper.accessor("role", {
				header: t`Role`,
				enableSorting: false,
				cell: (info) => (
					<div className="flex flex-col">
						<button
							type="button"
							className="cursor-pointer text-start font-medium underline-offset-4 hover:underline"
							onClick={() => onOpen(info.row.original)}
						>
							{info.getValue()}
						</button>
						<span className="text-muted-foreground text-xs">{info.row.original.company}</span>
					</div>
				),
			}),
			columnHelper.accessor("createdBy", {
				header: t`Submitted by`,
				enableSorting: false,
				cell: (info) => {
					const author = info.getValue();
					return author === null ? (
						<span className="text-muted-foreground text-xs">—</span>
					) : (
						<span className="text-muted-foreground text-xs">{author.name}</span>
					);
				},
			}),
			columnHelper.accessor("status", {
				header: t`Status`,
				enableSorting: false,
				cell: (info) => <PostStatusBadge status={info.getValue()} />,
			}),
			columnHelper.accessor("reportCount", {
				header: t`Reports`,
				enableSorting: true,
				cell: (info) =>
					info.getValue() > 0 ? (
						<Badge variant="destructive" className="tabular-nums">
							{info.getValue()}
						</Badge>
					) : (
						<span className="text-muted-foreground text-xs">—</span>
					),
			}),
			columnHelper.accessor("createdAt", {
				header: t`Submitted`,
				enableSorting: true,
				cell: (info) => <span className="text-muted-foreground text-xs">{i18n.date(info.getValue())}</span>,
			}),
			columnHelper.display({
				id: "actions",
				header: () => <span className="sr-only">{t`Actions`}</span>,
				cell: (info) => {
					const target = info.row.original;
					const isLive = target.status === "published";

					return (
						<div className="flex justify-end">
							<DropdownMenu>
								<DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="size-8" />}>
									<DotsThreeVerticalIcon />
									<span className="sr-only">{t`Actions`}</span>
								</DropdownMenuTrigger>

								<DropdownMenuContent align="end">
									<DropdownMenuItem onClick={() => onOpen(target)}>
										<Trans>Review details</Trans>
									</DropdownMenuItem>

									<DropdownMenuSeparator />

									<DropdownMenuItem disabled={isLive} onClick={() => onApprove(target)}>
										<CheckIcon />
										<Trans>Approve</Trans>
									</DropdownMenuItem>

									<DropdownMenuItem disabled={target.status === "rejected"} onClick={() => onReject(target)}>
										<FlagIcon />
										<Trans>Reject</Trans>
									</DropdownMenuItem>

									<DropdownMenuItem disabled={target.status === "closed"} onClick={() => onClose(target)}>
										<ProhibitIcon />
										<Trans>Take down</Trans>
									</DropdownMenuItem>

									<DropdownMenuSeparator />

									<DropdownMenuItem variant="destructive" onClick={() => onDelete(target)}>
										<TrashIcon />
										<Trans>Delete</Trans>
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						</div>
					);
				},
			}),
		],
		[i18n, onApprove, onClose, onDelete, onOpen, onReject, columnHelper.display, columnHelper.accessor],
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
			sorting={sorting}
			onSortingChange={onSortingChange}
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
