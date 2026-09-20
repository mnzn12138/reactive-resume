import type { MessageDescriptor } from "@lingui/core";
import type { OnChangeFn, PaginationState } from "@reactive-resume/ui/components/data-table";
import type { RouterOutput } from "@/libs/orpc/client";
import { msg, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useMemo } from "react";
import { Badge } from "@reactive-resume/ui/components/badge";
import { createColumnHelper, DataTable } from "@reactive-resume/ui/components/data-table";

type AuditEntry = RouterOutput["admin"]["audit"]["list"]["items"][number];

type Props = {
	entries: AuditEntry[];
	total: number;
	isLoading: boolean;
	pagination: PaginationState;
	onPaginationChange: OnChangeFn<PaginationState>;
	emptyMessage: string;
};

/**
 * Human labels for the actions the console can produce. Keyed by string rather
 * than by the union so an entry written by a newer release still renders — it
 * falls back to the raw dotted name instead of breaking the table.
 */
const ACTION_LABELS: Record<string, MessageDescriptor> = {
	"user.role.set": msg`Changed a user's role`,
	"user.ban.set": msg`Banned a user`,
	"user.ban.lift": msg`Lifted a ban`,
	"user.delete": msg`Deleted a user`,
	"resume.lock.set": msg`Changed a resume lock`,
	"resume.delete": msg`Deleted a resume`,
	"instance.setting.set": msg`Changed an instance setting`,
};

const TARGET_LABELS: Record<string, MessageDescriptor> = {
	user: msg`User`,
	resume: msg`Resume`,
	instance: msg`Instance`,
};

/** Metadata values are whatever the action recorded, so only primitives print as-is. */
const formatValue = (value: unknown): string => {
	if (value === null || value === undefined) return "—";
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	return JSON.stringify(value);
};

const columnHelper = createColumnHelper<AuditEntry>();

export function AuditTable({ entries, total, isLoading, pagination, onPaginationChange, emptyMessage }: Props) {
	const { i18n } = useLingui();

	const columns = useMemo(
		() => [
			columnHelper.accessor("createdAt", {
				header: t`When`,
				// The list is always newest-first; sorting a log by anything else is not useful.
				enableSorting: false,
				cell: (info) => (
					<span className="whitespace-nowrap text-muted-foreground text-xs">
						{i18n.date(info.getValue(), { dateStyle: "medium", timeStyle: "short" })}
					</span>
				),
			}),
			columnHelper.display({
				id: "actor",
				header: t`Administrator`,
				enableSorting: false,
				cell: (info) => {
					const { actor } = info.row.original;
					if (!actor) {
						return (
							<span className="text-muted-foreground text-xs italic">
								<Trans>Deleted account</Trans>
							</span>
						);
					}
					return (
						<div className="flex flex-col">
							<span>{actor.name}</span>
							<span className="text-muted-foreground text-xs">{actor.email}</span>
						</div>
					);
				},
			}),
			columnHelper.accessor("action", {
				header: t`Action`,
				enableSorting: false,
				cell: (info) => {
					const label = ACTION_LABELS[info.getValue()];
					return label ? i18n._(label) : <span className="font-mono text-xs">{info.getValue()}</span>;
				},
			}),
			columnHelper.display({
				id: "target",
				header: t`Target`,
				enableSorting: false,
				cell: (info) => {
					const { targetType, targetId } = info.row.original;
					return (
						<div className="flex flex-col items-start gap-1">
							<Badge variant="secondary">{i18n._(TARGET_LABELS[targetType] ?? msg`Other`)}</Badge>
							{targetId ? <span className="max-w-40 truncate font-mono text-xs">{targetId}</span> : null}
						</div>
					);
				},
			}),
			columnHelper.display({
				id: "details",
				header: t`Details`,
				enableSorting: false,
				cell: (info) => {
					const { metadata } = info.row.original;
					if (!metadata) return <span className="text-muted-foreground text-xs">—</span>;

					return (
						<dl className="flex flex-col gap-0.5">
							{Object.entries(metadata).map(([key, value]) => (
								<div key={key} className="flex gap-1.5 text-xs">
									<dt className="text-muted-foreground">{key}</dt>
									<dd className="max-w-60 truncate font-mono">{formatValue(value)}</dd>
								</div>
							))}
						</dl>
					);
				},
			}),
		],
		[i18n],
	);

	return (
		<DataTable
			columns={columns}
			data={entries}
			isLoading={isLoading}
			emptyMessage={emptyMessage}
			rowCount={total}
			pagination={pagination}
			onPaginationChange={onPaginationChange}
			previousLabel={i18n._(t`Previous`)}
			nextLabel={i18n._(t`Next`)}
			pageLabel={({ page, pageCount }) => i18n._(t`Page ${page} of ${pageCount}`)}
		/>
	);
}
