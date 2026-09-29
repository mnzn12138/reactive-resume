import type { RecruitmentSearch } from "@/features/recruitment/hooks/use-recruitment-filters";
import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { createFileRoute, notFound, stripSearchParams, useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import {
	defaultRecruitmentSearch,
	recruitmentPageSize,
	recruitmentSearchSchema,
	toRecruitmentListInput,
} from "@/features/recruitment/hooks/use-recruitment-filters";
import { useRecruitmentPosts } from "@/features/recruitment/hooks/use-recruitment-posts";
import { JobsListPage } from "@/features/recruitment/pages/jobs-list";
import { orpc } from "@/libs/orpc/client";
import { createNoindexFollowMeta } from "@/libs/seo";

export const Route = createFileRoute("/jobs/")({
	component: RouteComponent,
	ssr: "data-only",
	validateSearch: recruitmentSearchSchema,
	search: { middlewares: [stripSearchParams(defaultRecruitmentSearch)] },

	/**
	 * Gate on the instance flag rather than on the response: the server already answers 404 when
	 * the board is off, so mirroring that here keeps the two behaviours identical instead of
	 * inventing a second — inevitably divergent — notion of "available".
	 */
	beforeLoad: ({ context }) => {
		if (!context.flags.recruitmentBoardEnabled) throw notFound();
	},

	// Written through `loaderDeps` rather than read off the loader context directly: it is the
	// supported way to react to validated search params, and it keeps the loader's dependencies
	// explicit instead of hidden in whichever fields it happens to touch.
	loaderDeps: ({
		search: {
			search,
			role,
			batch,
			employmentType,
			workMode,
			educationRequired,
			benefits,
			locations,
			availability,
			sortBy,
			sortOrder,
			page,
		},
	}) => ({
		search,
		role,
		batch,
		employmentType,
		workMode,
		educationRequired,
		benefits,
		locations,
		availability,
		sortBy,
		sortOrder,
		page,
	}),

	loader: async ({ context, deps }) =>
		context.queryClient.ensureQueryData(
			orpc.recruitment.list.queryOptions({ input: toRecruitmentListInput(deps, recruitmentPageSize) }),
		),

	head: () => ({
		meta: [createNoindexFollowMeta(), { title: `${i18n._(msg`Campus jobs`)} · Reactive Resume` }],
	}),
});

function RouteComponent() {
	const search = Route.useSearch();
	const { session } = Route.useRouteContext();
	const navigate = useNavigate({ from: "/jobs" });

	const input = useMemo(() => toRecruitmentListInput(search, recruitmentPageSize), [search]);
	const { data, isLoading } = useRecruitmentPosts(input);

	// Filter changes are written with `replace` so paging through results does not fill history
	// with eleven entries for eleven keystrokes.
	const onNavigate = useCallback(
		(patch: Partial<RecruitmentSearch>) => {
			void navigate({ search: (prev: RecruitmentSearch) => ({ ...prev, ...patch }), replace: true });
		},
		[navigate],
	);

	return (
		<JobsListPage
			posts={data?.items ?? []}
			total={data?.total ?? 0}
			isLoading={isLoading}
			search={search}
			onNavigate={onNavigate}
			isAuthenticated={session !== null}
			loginHref="/auth/login?callbackURL=%2Fjobs"
			pageSize={recruitmentPageSize}
		/>
	);
}
