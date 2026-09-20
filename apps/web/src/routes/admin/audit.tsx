import type { MessageDescriptor } from "@lingui/core";
import { i18n } from "@lingui/core";
import { msg, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, stripSearchParams, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import z from "zod";
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from "@reactive-resume/api/audit-actions";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@reactive-resume/ui/components/input-group";
import { Combobox } from "@/components/ui/combobox";
import { orpc } from "@/libs/orpc/client";
import { createNoindexFollowMeta } from "@/libs/seo";
import { AuditTable } from "./-components/audit-table";

const PAGE_SIZE = 25;

const searchSchema = z.object({
	search: z.string().default(""),
	action: z.enum(AUDIT_ACTIONS).optional(),
	targetType: z.enum(AUDIT_TARGET_TYPES).optional(),
	page: z.number().int().min(1).default(1),
});

type Search = z.output<typeof searchSchema>;

const defaultSearch: Search = { search: "", page: 1 };

export const Route = createFileRoute("/admin/audit")({
	component: RouteComponent,
	validateSearch: searchSchema,
	search: { middlewares: [stripSearchParams(defaultSearch)] },
	head: () => ({ meta: [createNoindexFollowMeta(), { title: `${i18n._(msg`Audit Log`)} · ${i18n._(msg`Admin`)}` }] }),
});

/** Same vocabulary as the table's labels, so the filter and the rows agree. */
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

function RouteComponent() {
	const { i18n } = useLingui();
	const { search, action, targetType, page } = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });

	// Typing stays local so the input remains responsive; the URL — and so the
	// query — only updates once typing settles.
	const [searchDraft, setSearchDraft] = useState(search);

	useEffect(() => {
		if (searchDraft === search) return;
		const timer = setTimeout(() => {
			void navigate({ search: (prev: Search) => ({ ...prev, search: searchDraft, page: 1 }), replace: true });
		}, 300);
		return () => clearTimeout(timer);
	}, [searchDraft, search, navigate]);

	const query = useQuery(
		orpc.admin.audit.list.queryOptions({
			input: {
				...(search ? { search } : {}),
				...(action ? { action } : {}),
				...(targetType ? { targetType } : {}),
				limit: PAGE_SIZE,
				offset: (page - 1) * PAGE_SIZE,
			},
		}),
	);

	const actionOptions = [
		{ value: "all", label: i18n._(t`Any action`) },
		...AUDIT_ACTIONS.map((value) => ({ value, label: i18n._(ACTION_LABELS[value] ?? msg`Unknown action`) })),
	];

	const targetOptions = [
		{ value: "all", label: i18n._(t`Any target`) },
		...AUDIT_TARGET_TYPES.map((value) => ({ value, label: i18n._(TARGET_LABELS[value] ?? msg`Other`) })),
	];

	const patchSearch = (patch: Partial<Search>) => {
		void navigate({ search: (prev: Search) => ({ ...prev, ...patch, page: 1 }), replace: true });
	};

	return (
		<div className="flex flex-col gap-4">
			<div>
				<h1 className="font-semibold text-2xl tracking-tight">
					<Trans>Audit Log</Trans>
				</h1>
				<p className="text-muted-foreground text-sm">
					<Trans>Who changed what, and when, across the admin console.</Trans>
				</p>
			</div>

			<div className="flex flex-wrap items-center gap-2">
				<InputGroup className="max-w-xs">
					<InputGroupAddon>
						<MagnifyingGlassIcon />
					</InputGroupAddon>
					<InputGroupInput
						value={searchDraft}
						onChange={(event) => setSearchDraft(event.target.value)}
						placeholder={i18n._(t`Search by administrator or target`)}
						aria-label={i18n._(t`Search audit entries`)}
					/>
				</InputGroup>

				<Combobox
					className="w-60"
					options={actionOptions}
					value={action ?? "all"}
					onValueChange={(value) => patchSearch({ action: value === "all" ? undefined : (value as Search["action"]) })}
				/>

				<Combobox
					className="w-36"
					options={targetOptions}
					value={targetType ?? "all"}
					onValueChange={(value) =>
						patchSearch({ targetType: value === "all" ? undefined : (value as Search["targetType"]) })
					}
				/>
			</div>

			<AuditTable
				entries={query.data?.items ?? []}
				total={query.data?.total ?? 0}
				isLoading={query.isLoading}
				emptyMessage={i18n._(t`No audit entries match these filters.`)}
				pagination={{ pageIndex: page - 1, pageSize: PAGE_SIZE }}
				onPaginationChange={(updater) => {
					const next = typeof updater === "function" ? updater({ pageIndex: page - 1, pageSize: PAGE_SIZE }) : updater;
					void navigate({ search: (prev: Search) => ({ ...prev, page: next.pageIndex + 1 }), replace: true });
				}}
			/>
		</div>
	);
}
