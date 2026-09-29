import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { useRecruitmentPost } from "@/features/recruitment/hooks/use-recruitment-posts";
import { JobsDetailPage } from "@/features/recruitment/pages/jobs-detail";
import { orpc } from "@/libs/orpc/client";
import { createNoindexFollowMeta } from "@/libs/seo";

export const Route = createFileRoute("/jobs/$postId")({
	component: RouteComponent,
	ssr: "data-only",

	/** Same gate as the list: the flag decides availability, nothing else does. */
	beforeLoad: ({ context }) => {
		if (!context.flags.recruitmentBoardEnabled) throw notFound();
	},

	loader: async ({ context, params }) =>
		context.queryClient.ensureQueryData(orpc.recruitment.getById.queryOptions({ input: { id: params.postId } })),

	head: ({ loaderData }) => {
		const fallback = `${i18n._(msg`Campus jobs`)} · Reactive Resume`;

		return {
			meta: [
				createNoindexFollowMeta(),
				{ title: loaderData ? `${loaderData.role} · ${loaderData.company}` : fallback },
			],
		};
	},

	// A withdrawn post and a missing one are indistinguishable to the caller by design — both 404.
	onError: () => {
		throw notFound();
	},
});

function RouteComponent() {
	const { postId } = Route.useParams();
	const { session } = Route.useRouteContext();
	const { data, isLoading } = useRecruitmentPost(postId);

	return (
		<JobsDetailPage
			post={data}
			isLoading={isLoading}
			isAuthenticated={session !== null}
			loginHref={`/auth/login?callbackURL=${encodeURIComponent(`/jobs/${postId}`)}`}
		/>
	);
}
