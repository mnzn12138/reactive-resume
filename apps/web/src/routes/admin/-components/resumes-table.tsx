import type { OnChangeFn, PaginationState, SortingState } from "@reactive-resume/ui/components/data-table";
import type { RouterOutput } from "@/libs/orpc/client";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { DotsThreeVerticalIcon, GlobeIcon, LockSimpleIcon, LockSimpleOpenIcon, TrashIcon } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
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
import { toast } from "@reactive-resume/ui/components/toast";
import { useConfirm } from "@/hooks/use-confirm";
import { orpc } from "@/libs/orpc/client";

type AdminResume = RouterOutput["admin"]["resumes"]["list"]["items"][number];

type Props = {
	resumes: AdminResume[];
	total: number;
	isLoading: boolean;
	pagination: PaginationState;
	onPaginationChange: OnChangeFn<PaginationState>;
	sorting: SortingState;
	onSortingChange: OnChangeFn<SortingState>;
	emptyMessage: string;
};

const columnHelper = createColumnHelper<AdminResume>();

export function ResumesTable({
	resumes,
	total,
	isLoading,
	pagination,
	onPaginationChange,
	sorting,
	onSortingChange,
	emptyMessage,
}: Props) {
	const { i18n } = useLingui();
	const queryClient = useQueryClient();
	const confirm = useConfirm();

	const invalidate = () => {
		void queryClient.invalidateQueries({ queryKey: orpc.admin.resumes.list.queryKey() });
	};

	const onError = () => toast.add({ type: "error", description: t`Something went wrong. Please try again.` });

	const setLock = useMutation(orpc.admin.resumes.setLock.mutationOptions({ onSuccess: invalidate, onError }));
	const remove = useMutation(orpc.admin.resumes.delete.mutationOptions({ onSuccess: invalidate, onError }));

	// Kept stable so the column definitions below don't rebuild on every render.
	const handleDelete = useCallback(
		async (target: AdminResume) => {
			const confirmed = await confirm(t`Delete this resume?`, {
				description: t`"${target.name}" by ${target.owner.email} will be permanently deleted, along with its saved versions. This can't be undone.`,
				confirmText: t`Delete`,
			});
			if (confirmed) remove.mutate({ id: target.id });
		},
		[confirm, remove.mutate],
	);

	const columns = useMemo(
		() => [
			columnHelper.accessor("name", {
				header: t`Resume`,
				cell: (info) => (
					<div className="flex flex-col">
						<span className="font-medium">{info.getValue()}</span>
						<span className="text-muted-foreground text-xs">{info.row.original.slug}</span>
					</div>
				),
			}),
			columnHelper.accessor((row) => row.owner.name, {
				id: "owner",
				header: t`Owner`,
				// The server only sorts by resume fields, so this column stays unsorted.
				enableSorting: false,
				cell: (info) => (
					<div className="flex flex-col">
						<span>{info.getValue()}</span>
						<span className="text-muted-foreground text-xs">{info.row.original.owner.email}</span>
					</div>
				),
			}),
			columnHelper.accessor("isPublic", {
				header: t`Visibility`,
				enableSorting: false,
				cell: (info) => (
					<div className="flex flex-col items-start gap-1">
						{info.getValue() ? (
							<Badge variant="secondary">
								<GlobeIcon />
								<Trans>Public</Trans>
							</Badge>
						) : (
							<span className="text-muted-foreground text-xs">
								<Trans>Private</Trans>
							</span>
						)}
						{info.row.original.hasPassword && (
							<span className="text-muted-foreground text-xs">
								<Trans>Password protected</Trans>
							</span>
						)}
					</div>
				),
			}),
			columnHelper.accessor("isLocked", {
				header: t`Status`,
				enableSorting: false,
				cell: (info) =>
					info.getValue() ? (
						<Badge variant="destructive">
							<Trans>Locked</Trans>
						</Badge>
					) : (
						<span className="text-muted-foreground text-xs">
							<Trans>Unlocked</Trans>
						</span>
					),
			}),
			columnHelper.accessor("updatedAt", {
				header: t`Updated`,
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
									<DropdownMenuItem
										disabled={setLock.isPending}
										onClick={() => setLock.mutate({ id: target.id, locked: !target.isLocked })}
									>
										{target.isLocked ? <LockSimpleOpenIcon /> : <LockSimpleIcon />}
										{target.isLocked ? <Trans>Unlock editing</Trans> : <Trans>Lock editing</Trans>}
									</DropdownMenuItem>

									<DropdownMenuSeparator />

									<DropdownMenuItem
										variant="destructive"
										disabled={remove.isPending}
										onClick={() => void handleDelete(target)}
									>
										<TrashIcon />
										<Trans>Delete resume</Trans>
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						</div>
					);
				},
			}),
		],
		[handleDelete, i18n, remove.isPending, setLock.mutate, setLock.isPending],
	);

	return (
		<DataTable
			columns={columns}
			data={resumes}
			isLoading={isLoading}
			emptyMessage={emptyMessage}
			rowCount={total}
			pagination={pagination}
			onPaginationChange={onPaginationChange}
			sorting={sorting}
			onSortingChange={onSortingChange}
			previousLabel={i18n._(t`Previous`)}
			nextLabel={i18n._(t`Next`)}
			pageLabel={({ page, pageCount }) => i18n._(t`Page ${page} of ${pageCount}`)}
		/>
	);
}
