import type { QueryClient } from "@tanstack/react-query";
import type { RecruitmentPostDetail } from "../types";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { BookmarkSimpleIcon, SignInIcon } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@reactive-resume/ui/components/button";
import { toast } from "@reactive-resume/ui/components/toast";
import { orpc } from "@/libs/orpc/client";
import { recruitmentErrorMessage } from "../errors";

type BookmarkButtonProps = {
	/** The post being bookmarked; only its id and current state matter. */
	postId: string;
	bookmarked: boolean;
	/** Anonymous visitors get a sign-in shortcut: the endpoints are behind `protectedProcedure`. */
	isAuthenticated: boolean;
	loginHref: string;
	/** Whether to render the words next to the icon. Off in tight table rows. */
	showLabel?: boolean;
	className?: string;
};

/**
 * Flip `bookmarked` on the cached detail row, if there is one.
 *
 * The cache is written rather than a local state because the same post is on screen in up to
 * three places at once — the detail page, the board list, and the bookmarks tab — and a local
 * state would let them disagree until the next refetch.
 */
function writeBookmarked(
	cache: QueryClient,
	key: readonly unknown[],
	bookmarked: boolean,
): RecruitmentPostDetail | undefined {
	let previous: RecruitmentPostDetail | undefined;

	cache.setQueryData<RecruitmentPostDetail>(key, (current) => {
		previous = current;
		return current === undefined || current === null ? current : { ...current, bookmarked };
	});

	return previous;
}

/**
 * 收藏 / 取消收藏 — optimistic, and idempotent on both directions.
 *
 * The two endpoints are separate (`PUT` / `DELETE`) rather than one toggle, and both are
 * no-ops when the row is already in that state, so a double click is harmless by construction.
 * What the optimistic write buys is the click feeling instant on a board where a bookmark is
 * a pure annotation — there is nothing to wait for and nothing to confirm.
 *
 * Failure rolls the cache back to the exact previous row rather than to `!bookmarked`: the
 * snapshot is what was on screen, and "what was on screen" is the only correct answer when a
 * concurrent refetch may have changed it in the meantime.
 */
export function BookmarkButton({
	postId,
	bookmarked,
	isAuthenticated,
	loginHref,
	showLabel = true,
	className,
}: BookmarkButtonProps) {
	const queryClient = useQueryClient();
	const detailKey = orpc.recruitment.getById.queryKey({ input: { id: postId } });

	const invalidate = () => {
		void queryClient.invalidateQueries({ queryKey: orpc.recruitment.bookmarks.queryKey() });
		void queryClient.invalidateQueries({ queryKey: orpc.recruitment.list.queryKey() });
		void queryClient.invalidateQueries({ queryKey: detailKey });
	};

	const options = {
		onMutate: () => ({ previous: writeBookmarked(queryClient, detailKey, !bookmarked) }),
		onError: (
			error: unknown,
			_input: { id: string },
			context: { previous: RecruitmentPostDetail | undefined } | undefined,
		) => {
			if (context?.previous !== undefined) queryClient.setQueryData(detailKey, context.previous);
			toast.add({ type: "error", description: recruitmentErrorMessage(error) });
		},
		onSuccess: () => {
			toast.add({
				type: "success",
				description: bookmarked ? t`Removed from your bookmarks.` : t`Added to your bookmarks.`,
			});
		},
		onSettled: invalidate,
	};

	const add = useMutation(orpc.recruitment.bookmark.mutationOptions(options));
	const remove = useMutation(orpc.recruitment.unbookmark.mutationOptions(options));

	if (!isAuthenticated) {
		return (
			<Button variant="outline" nativeButton={false} className={className} render={<a href={loginHref} />}>
				<SignInIcon />
				{showLabel ? <Trans>Log in to bookmark</Trans> : null}
			</Button>
		);
	}

	const isPending = add.isPending || remove.isPending;

	return (
		<Button
			variant={bookmarked ? "default" : "outline"}
			className={className}
			disabled={isPending}
			aria-pressed={bookmarked}
			aria-label={bookmarked ? t`Remove bookmark` : t`Bookmark this post`}
			onClick={() => (bookmarked ? remove.mutate({ id: postId }) : add.mutate({ id: postId }))}
		>
			<BookmarkSimpleIcon weight={bookmarked ? "fill" : "regular"} />
			{showLabel ? bookmarked ? <Trans>Bookmarked</Trans> : <Trans>Bookmark</Trans> : null}
		</Button>
	);
}
