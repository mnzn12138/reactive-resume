import type { OnChangeFn, PaginationState } from "@reactive-resume/ui/components/data-table";
import type { RecruitmentReportAdmin } from "@/features/recruitment/types";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { CheckCircleIcon, DetectiveIcon } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { Badge } from "@reactive-resume/ui/components/badge";
import { Button } from "@reactive-resume/ui/components/button";
import { createColumnHelper, DataTable } from "@reactive-resume/ui/components/data-table";
import { toast } from "@reactive-resume/ui/components/toast";
import { recruitmentErrorMessage } from "@/features/recruitment/errors";
import { reportReasonLabels } from "@/features/recruitment/labels";
import { orpc } from "@/libs/orpc/client";

type ReportTableProps = {
	reports: RecruitmentReportAdmin[];
	total: number;
	isLoading: boolean;
	emptyMessage: string;
	pagination: PaginationState;
	onPaginationChange: OnChangeFn<PaginationState>;
};

/**
 * The report queue (endpoints 15 and 16).
 *
 * Marking handled records who did it and when, and reopening clears both — so the row always
 * shows either a handled flag with an attribution or none at all. The UI keeps that symmetry:
 * an unhandled report offers 「标记已处理」, a handled one offers 「重新打开」, and neither is
 * ever shown as a no-op button.
 */
export function ReportTable({
	reports,
	total,
	isLoading,
	emptyMessage,
	pagination,
	onPaginationChange,
}: ReportTableProps) {
	const { i18n } = useLingui();
	const queryClient = useQueryClient();

	const invalidate = () => {
		void queryClient.invalidateQueries({ queryKey: orpc.admin.recruitment.reports.list.queryKey() });
	};

	const setHandled = useMutation(
		orpc.admin.recruitment.reports.update.mutationOptions({
			onSuccess: (result) => {
				invalidate();
				toast.add({
					type: "success",
					description: result.handled ? t`Marked as handled.` : t`Reopened.`,
				});
			},
			onError: (error: unknown) => toast.add({ type: "error", description: recruitmentErrorMessage(error) }),
		}),
	);

	const columnHelper = createColumnHelper<RecruitmentReportAdmin>();

	const columns = useMemo(
		() => [
			columnHelper.accessor("post", {
				header: t`Post`,
				enableSorting: false,
				cell: (info) => (
					<div className="flex flex-col">
						<span className="font-medium">{info.getValue().role}</span>
						<span className="text-muted-foreground text-xs">{info.getValue().company}</span>
					</div>
				),
			}),
			columnHelper.accessor("reason", {
				header: t`Reason`,
				enableSorting: false,
				cell: (info) => <span className="text-xs">{i18n.t(reportReasonLabels[info.getValue()])}</span>,
			}),
			columnHelper.accessor("detail", {
				header: t`Details`,
				enableSorting: false,
				cell: (info) =>
					info.getValue() === null ? (
						<span className="text-muted-foreground text-xs">—</span>
					) : (
						<span className="wrap-anywhere text-xs">{info.getValue()}</span>
					),
			}),
			columnHelper.accessor("reporter", {
				header: t`Reported by`,
				enableSorting: false,
				cell: (info) => <span className="text-muted-foreground text-xs">{info.getValue().name}</span>,
			}),
			columnHelper.accessor("handled", {
				header: t`State`,
				enableSorting: false,
				cell: (info) =>
					info.getValue() ? (
						<Badge variant="secondary">
							<Trans>Handled</Trans>
						</Badge>
					) : (
						<Badge variant="destructive">
							<Trans>Open</Trans>
						</Badge>
					),
			}),
			columnHelper.accessor("createdAt", {
				header: t`Filed`,
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
							<Button
								size="sm"
								variant="outline"
								disabled={setHandled.isPending}
								onClick={() => setHandled.mutate({ id: target.id, handled: !target.handled })}
							>
								{target.handled ? <DetectiveIcon /> : <CheckCircleIcon />}
								{target.handled ? <Trans>Reopen</Trans> : <Trans>Mark handled</Trans>}
							</Button>
						</div>
					);
				},
			}),
		],
		[i18n, setHandled.isPending, setHandled.mutate, columnHelper.display, columnHelper.accessor],
	);

	return (
		<DataTable
			columns={columns}
			data={reports}
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
