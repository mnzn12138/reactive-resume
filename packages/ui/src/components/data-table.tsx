import type {
	ColumnDef,
	OnChangeFn,
	PaginationState,
	SortingState,
	Table as TanstackTable,
} from "@tanstack/react-table";
import type * as React from "react";
import { CaretDownIcon, CaretUpDownIcon, CaretUpIcon } from "@phosphor-icons/react";
import {
	flexRender,
	getCoreRowModel,
	getPaginationRowModel,
	getSortedRowModel,
	useReactTable,
} from "@tanstack/react-table";
import { useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { Skeleton } from "@reactive-resume/ui/components/skeleton";
import { cn } from "@reactive-resume/utils/style";

export type { ColumnDef, OnChangeFn, PaginationState, SortingState } from "@tanstack/react-table";
/**
 * Re-exported so consumers can build column definitions without depending on
 * `@tanstack/react-table` themselves — pnpm's strict node_modules would
 * otherwise leave the import unresolvable from `apps/web`.
 */
export { createColumnHelper } from "@tanstack/react-table";

// Stable empty reference: a fresh `[]` on every render invalidates the row model.
const EMPTY_DATA: unknown[] = [];

type DataTableProps<TData> = {
	// `any` is unavoidable here: a table's columns each carry their own value
	// type, so there is no single `TValue` the array could agree on. Only
	// `TData` matters to this component — it never reads cell values itself.
	// biome-ignore lint/suspicious/noExplicitAny: see above
	columns: ColumnDef<TData, any>[];
	data?: TData[];
	className?: string;

	/** Rendered across all columns when there are no rows. */
	emptyMessage?: React.ReactNode;

	/** Page size used when the table owns pagination. Defaults to 25. */
	initialPageSize?: number;

	/**
	 * Total rows across all pages, when the parent pages on the server.
	 * Supplying it switches to manual mode: the table stops slicing and sorting
	 * locally and treats `data` as the already-fetched page.
	 */
	rowCount?: number;

	pagination?: PaginationState;
	onPaginationChange?: OnChangeFn<PaginationState>;

	sorting?: SortingState;
	onSortingChange?: OnChangeFn<SortingState>;

	/** Shows skeleton rows instead of the body. */
	isLoading?: boolean;

	/** Render prop for row selection counts, column toggles, etc. */
	children?: (table: TanstackTable<TData>) => React.ReactNode;
};

/**
 * Shared table shell for the admin console.
 *
 * Paging and sorting are controlled when the parent passes the matching props
 * and fall back to local state otherwise, so small lists stay client-side while
 * the user and resume lists switch to server-side paging without a second
 * component.
 */
export function DataTable<TData>({
	columns,
	data,
	className,
	emptyMessage,
	initialPageSize = 25,
	rowCount,
	pagination: paginationProp,
	onPaginationChange,
	sorting: sortingProp,
	onSortingChange,
	isLoading = false,
	children,
}: DataTableProps<TData>) {
	const [localPagination, setLocalPagination] = useState<PaginationState>({
		pageIndex: 0,
		pageSize: initialPageSize,
	});
	const [localSorting, setLocalSorting] = useState<SortingState>([]);

	const isServerDriven = rowCount !== undefined;

	const table = useReactTable({
		columns,
		data: (data ?? EMPTY_DATA) as TData[],
		state: {
			pagination: paginationProp ?? localPagination,
			sorting: sortingProp ?? localSorting,
		},
		onPaginationChange: onPaginationChange ?? setLocalPagination,
		onSortingChange: onSortingChange ?? setLocalSorting,
		initialState: { pagination: { pageSize: initialPageSize } },
		manualPagination: isServerDriven,
		manualSorting: isServerDriven,
		// `exactOptionalPropertyTypes` rejects an explicit `undefined` here, so the
		// key has to be omitted entirely when the table owns pagination.
		...(isServerDriven && rowCount !== undefined ? { rowCount } : {}),
		autoResetPageIndex: false,
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getPaginationRowModel: getPaginationRowModel(),
	});

	const rows = table.getRowModel().rows;
	const columnCount = table.getAllLeafColumns().length;
	const showFooter = isServerDriven || table.getPageCount() > 1;

	return (
		<div className={cn("flex flex-col gap-3", className)}>
			{children?.(table)}

			<div className="overflow-hidden rounded-lg border">
				<table className="w-full caption-bottom text-sm">
					<thead className="[&_tr]:border-b">
						{table.getHeaderGroups().map((headerGroup) => (
							<tr key={headerGroup.id}>
								{headerGroup.headers.map((header) => {
									const canSort = header.column.getCanSort();
									const sorted = header.column.getIsSorted();

									return (
										<th key={header.id} className="h-10 px-3 text-start align-middle font-medium text-muted-foreground">
											{header.isPlaceholder ? null : canSort ? (
												<button
													type="button"
													onClick={header.column.getToggleSortingHandler()}
													className="inline-flex items-center gap-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
												>
													{flexRender(header.column.columnDef.header, header.getContext())}
													{sorted === "asc" ? (
														<CaretUpIcon className="size-3" />
													) : sorted === "desc" ? (
														<CaretDownIcon className="size-3" />
													) : (
														<CaretUpDownIcon className="size-3 opacity-50" />
													)}
												</button>
											) : (
												flexRender(header.column.columnDef.header, header.getContext())
											)}
										</th>
									);
								})}
							</tr>
						))}
					</thead>

					<tbody className="[&_tr:last-child]:border-0">
						{isLoading ? (
							Array.from({ length: Math.min(table.getState().pagination.pageSize, 5) }).map((_, rowIndex) => (
								<tr key={`skeleton-${rowIndex}`} className="border-b">
									{Array.from({ length: columnCount }).map((__, cellIndex) => (
										<td key={`skeleton-cell-${cellIndex}`} className="p-3">
											<Skeleton className="h-4 w-full" />
										</td>
									))}
								</tr>
							))
						) : rows.length === 0 ? (
							<tr>
								<td colSpan={columnCount} className="p-8 text-center text-muted-foreground">
									{emptyMessage}
								</td>
							</tr>
						) : (
							rows.map((row) => (
								<tr key={row.id} className="border-b transition-colors hover:bg-muted/50">
									{row.getAllCells().map((cell) => (
										<td key={cell.id} className="p-3 align-middle">
											{flexRender(cell.column.columnDef.cell, cell.getContext())}
										</td>
									))}
								</tr>
							))
						)}
					</tbody>
				</table>
			</div>

			{showFooter && (
				<div className="flex items-center justify-between gap-2">
					<p className="text-muted-foreground text-xs">
						Page {table.getState().pagination.pageIndex + 1} of {Math.max(table.getPageCount(), 1)}
					</p>

					<div className="flex items-center gap-2">
						<Button
							variant="outline"
							size="sm"
							onClick={() => table.previousPage()}
							disabled={!table.getCanPreviousPage()}
						>
							Previous
						</Button>
						<Button variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
							Next
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}
