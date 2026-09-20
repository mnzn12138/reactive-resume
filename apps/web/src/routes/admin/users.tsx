import { i18n } from "@lingui/core";
import { msg, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, stripSearchParams, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import z from "zod";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@reactive-resume/ui/components/input-group";
import { Combobox } from "@/components/ui/combobox";
import { orpc } from "@/libs/orpc/client";
import { createNoindexFollowMeta } from "@/libs/seo";
import { UsersTable } from "./-components/users-table";

const PAGE_SIZE = 25;

const searchSchema = z.object({
	search: z.string().default(""),
	role: z.enum(["user", "admin"]).optional(),
	banned: z.boolean().optional(),
	sortBy: z.enum(["createdAt", "lastActiveAt", "email", "name"]).default("createdAt"),
	sortOrder: z.enum(["asc", "desc"]).default("desc"),
	page: z.number().int().min(1).default(1),
});

type Search = z.output<typeof searchSchema>;

const defaultSearch: Search = { search: "", sortBy: "createdAt", sortOrder: "desc", page: 1 };

export const Route = createFileRoute("/admin/users")({
	component: RouteComponent,
	validateSearch: searchSchema,
	search: { middlewares: [stripSearchParams(defaultSearch)] },
	head: () => ({ meta: [createNoindexFollowMeta(), { title: `${i18n._(msg`Users`)} · ${i18n._(msg`Admin`)}` }] }),
});

function RouteComponent() {
	const { i18n } = useLingui();
	const { search, role, banned, sortBy, sortOrder, page } = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const { session } = Route.useRouteContext();
	const currentUserId = session?.user?.id;

	const roleOptions = [
		{ value: "all", label: i18n._(t`All roles`) },
		{ value: "admin", label: i18n._(t`Admin`) },
		{ value: "user", label: i18n._(t`User`) },
	];

	const statusOptions = [
		{ value: "all", label: i18n._(t`Any status`) },
		{ value: "active", label: i18n._(t`Active`) },
		{ value: "banned", label: i18n._(t`Banned`) },
	];

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
		orpc.admin.users.list.queryOptions({
			input: {
				...(search ? { search } : {}),
				...(role ? { role } : {}),
				...(banned !== undefined ? { banned } : {}),
				sortBy,
				sortOrder,
				limit: PAGE_SIZE,
				offset: (page - 1) * PAGE_SIZE,
			},
		}),
	);

	const patchSearch = (patch: Partial<Search>) => {
		void navigate({ search: (prev: Search) => ({ ...prev, ...patch, page: 1 }), replace: true });
	};

	return (
		<div className="flex flex-col gap-4">
			<div>
				<h1 className="font-semibold text-2xl tracking-tight">
					<Trans>Users</Trans>
				</h1>
				<p className="text-muted-foreground text-sm">
					<Trans>Search accounts, change roles, ban or delete them.</Trans>
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
						placeholder={i18n._(t`Search by name, email or username`)}
						aria-label={i18n._(t`Search users`)}
					/>
				</InputGroup>

				<Combobox
					className="w-40"
					options={roleOptions}
					value={role ?? "all"}
					onValueChange={(value) => patchSearch({ role: value === "all" ? undefined : (value as Search["role"]) })}
				/>

				<Combobox
					className="w-40"
					options={statusOptions}
					value={banned === undefined ? "all" : banned ? "banned" : "active"}
					onValueChange={(value) => patchSearch({ banned: value === "all" ? undefined : value === "banned" })}
				/>
			</div>

			<UsersTable
				users={query.data?.items ?? []}
				total={query.data?.total ?? 0}
				isLoading={query.isLoading}
				emptyMessage={i18n._(t`No users match these filters.`)}
				currentUserId={currentUserId}
				pagination={{ pageIndex: page - 1, pageSize: PAGE_SIZE }}
				onPaginationChange={(updater) => {
					const next = typeof updater === "function" ? updater({ pageIndex: page - 1, pageSize: PAGE_SIZE }) : updater;
					void navigate({ search: (prev: Search) => ({ ...prev, page: next.pageIndex + 1 }), replace: true });
				}}
				sorting={[{ id: sortBy, desc: sortOrder === "desc" }]}
				onSortingChange={(updater) => {
					const next = typeof updater === "function" ? updater([{ id: sortBy, desc: sortOrder === "desc" }]) : updater;
					const first = next.at(0);
					if (!first) return;
					void navigate({
						search: (prev: Search) => ({
							...prev,
							sortBy: first.id as Search["sortBy"],
							sortOrder: first.desc ? "desc" : "asc",
							page: 1,
						}),
						replace: true,
					});
				}}
			/>
		</div>
	);
}
