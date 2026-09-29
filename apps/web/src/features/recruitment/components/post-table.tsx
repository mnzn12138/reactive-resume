import type { OnChangeFn, PaginationState } from "@reactive-resume/ui/components/data-table";
import type { RecruitmentPost } from "../types";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { ArrowSquareOutIcon, BriefcaseIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { Badge } from "@reactive-resume/ui/components/badge";
import { Button } from "@reactive-resume/ui/components/button";
import { createColumnHelper, DataTable } from "@reactive-resume/ui/components/data-table";
import { batchLabels, benefitLabels, educationLabels } from "../labels";
import { AvailabilityBadge } from "./availability-badge";
import { CompanyLogo } from "./company-logo";
import { EnumBadgeList } from "./enum-badge-list";

type PostTableProps = {
	posts: RecruitmentPost[];
	total: number;
	isLoading: boolean;
	pagination: PaginationState;
	onPaginationChange: OnChangeFn<PaginationState>;
	/** Pre-fills the application form. The sheet itself belongs to the page, not to each row. */
	onTrack: (post: RecruitmentPost) => void;
	/** Anonymous rows get a sign-in shortcut instead of a tracking button. */
	isAuthenticated: boolean;
	loginHref: string;
	emptyMessage: string;
};

/**
 * Desktop table for the board — §5.4's nine columns.
 *
 * Every column sets `enableSorting: false` on purpose. Sorting here is server-side and driven by
 * the single `sortBy` dropdown, so a clickable header would either sort only the twenty rows in
 * memory (lying about total order) or send a field the DTO rejects. Leaving it off is honest.
 */
export function PostTable({
	posts,
	total,
	isLoading,
	pagination,
	onPaginationChange,
	onTrack,
	isAuthenticated,
	loginHref,
	emptyMessage,
}: PostTableProps) {
	const { i18n } = useLingui();

	const columnHelper = createColumnHelper<RecruitmentPost>();

	const columns = [
		columnHelper.accessor("companyLogoUrl", {
			id: "logo",
			header: "",
			enableSorting: false,
			cell: ({ row }) => <CompanyLogo company={row.original.company} logoUrl={row.original.companyLogoUrl} />,
		}),
		columnHelper.accessor("company", {
			header: t`Company`,
			enableSorting: false,
			cell: ({ getValue }) => <span className="font-medium">{getValue()}</span>,
		}),
		columnHelper.accessor("role", {
			header: t`Role`,
			enableSorting: false,
			cell: ({ row }) => (
				<Link
					to="/jobs/$postId"
					params={{ postId: row.original.id }}
					className="text-primary underline-offset-4 hover:underline"
				>
					{row.original.role}
				</Link>
			),
		}),
		columnHelper.accessor("batch", {
			header: t`Batch`,
			enableSorting: false,
			cell: ({ getValue }) => <Badge variant="outline">{i18n.t(batchLabels[getValue()])}</Badge>,
		}),
		columnHelper.accessor("locations", {
			header: t`Locations`,
			enableSorting: false,
			cell: ({ row }) =>
				row.original.locations.length > 0 ? (
					<span className="text-muted-foreground text-xs">{row.original.locations.join(" / ")}</span>
				) : (
					<span className="text-muted-foreground text-xs">—</span>
				),
		}),
		columnHelper.accessor("educationRequired", {
			header: t`Education`,
			enableSorting: false,
			cell: ({ row }) => <EnumBadgeList values={row.original.educationRequired} labels={educationLabels} max={2} />,
		}),
		columnHelper.accessor("benefits", {
			header: t`Benefits`,
			enableSorting: false,
			cell: ({ row }) => <EnumBadgeList values={row.original.benefits} labels={benefitLabels} max={2} />,
		}),
		columnHelper.accessor("availability", {
			header: t`Availability`,
			enableSorting: false,
			cell: ({ row }) => (
				<AvailabilityBadge
					availability={row.original.availability}
					daysUntilDeadline={row.original.daysUntilDeadline}
				/>
			),
		}),
		columnHelper.display({
			id: "actions",
			header: "",
			cell: ({ row }) => (
				<div className="flex items-center justify-end gap-x-1">
					<Button
						size="icon-sm"
						variant="ghost"
						nativeButton={false}
						aria-label={t`View details`}
						render={
							<Link to="/jobs/$postId" params={{ postId: row.original.id }}>
								<ArrowSquareOutIcon />
							</Link>
						}
					/>
					{isAuthenticated ? (
						<Button
							size="icon-sm"
							variant="outline"
							aria-label={t`Add to my applications`}
							onClick={() => onTrack(row.original)}
						>
							<BriefcaseIcon />
						</Button>
					) : (
						<Button
							size="icon-sm"
							variant="outline"
							nativeButton={false}
							aria-label={t`Log in to track this role`}
							render={
								<a href={loginHref}>
									<BriefcaseIcon />
								</a>
							}
						/>
					)}
				</div>
			),
		}),
	];

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
			previousLabel={t`Previous`}
			nextLabel={t`Next`}
			pageLabel={({ page, pageCount }) => (
				<Trans>
					Page {page} of {pageCount}
				</Trans>
			)}
		/>
	);
}
