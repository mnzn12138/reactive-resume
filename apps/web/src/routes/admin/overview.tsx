import { i18n } from "@lingui/core";
import { msg, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Skeleton } from "@reactive-resume/ui/components/skeleton";
import { orpc } from "@/libs/orpc/client";
import { createNoindexFollowMeta } from "@/libs/seo";
import { SignupTrend } from "./-components/signup-trend";

export const Route = createFileRoute("/admin/overview")({
	component: RouteComponent,
	head: () => ({ meta: [createNoindexFollowMeta(), { title: `${i18n._(msg`Overview`)} · ${i18n._(msg`Admin`)}` }] }),
});

type StatCardProps = {
	label: string;
	value: string;
	hint?: string;
};

function StatCard({ label, value, hint }: StatCardProps) {
	return (
		<div className="flex flex-col gap-1 rounded-lg border bg-background p-4">
			<span className="text-muted-foreground text-xs">{label}</span>
			<span className="font-semibold text-2xl tabular-nums tracking-tight">{value}</span>
			{hint ? <span className="text-muted-foreground text-xs">{hint}</span> : null}
		</div>
	);
}

/** Binary units, matching how a file manager would report the same total. */
function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;

	const units = ["KB", "MB", "GB", "TB"];
	let value = bytes / 1024;
	let unit = 0;

	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}

	return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

function RouteComponent() {
	const { i18n } = useLingui();
	const query = useQuery(orpc.admin.overview.get.queryOptions());

	const formatNumber = (value: number) => new Intl.NumberFormat(i18n.locale).format(value);

	if (query.isLoading || !query.data) {
		return (
			<div className="flex flex-col gap-4">
				<div>
					<h1 className="font-semibold text-2xl tracking-tight">
						<Trans>Overview</Trans>
					</h1>
					<p className="text-muted-foreground text-sm">
						<Trans>Instance-wide totals and signup trends for this deployment.</Trans>
					</p>
				</div>

				<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
					{Array.from({ length: 4 }).map((_, index) => (
						<Skeleton key={`stat-skeleton-${index}`} className="h-24 rounded-lg" />
					))}
				</div>

				<Skeleton className="h-56 rounded-lg" />
			</div>
		);
	}

	const { totals, signups, storage } = query.data;

	return (
		<div className="flex flex-col gap-4">
			<div>
				<h1 className="font-semibold text-2xl tracking-tight">
					<Trans>Overview</Trans>
				</h1>
				<p className="text-muted-foreground text-sm">
					<Trans>Instance-wide totals and signup trends for this deployment.</Trans>
				</p>
			</div>

			<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
				<StatCard label={i18n._(t`Users`)} value={formatNumber(totals.users)} />
				<StatCard label={i18n._(t`Resumes`)} value={formatNumber(totals.resumes)} />
				<StatCard
					label={i18n._(t`Public resumes`)}
					value={formatNumber(totals.publicResumes)}
					hint={i18n._(t`Shared through a public link.`)}
				/>
				<StatCard
					label={i18n._(t`Storage`)}
					// A null reading means the backend could not be reached; showing zero
					// would read as "this instance stores nothing".
					value={storage ? formatBytes(storage.bytes) : i18n._(t`Unavailable`)}
					hint={storage ? i18n._(t`${formatNumber(storage.objects)} files`) : i18n._(t`Storage backend unreachable.`)}
				/>
			</div>

			<SignupTrend data={signups} />
		</div>
	);
}
