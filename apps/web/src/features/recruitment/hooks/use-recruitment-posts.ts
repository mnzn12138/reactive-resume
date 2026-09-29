import type { RecruitmentListInput } from "../types";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { orpc } from "@/libs/orpc/client";

/**
 * Public list query for the campus recruitment board.
 *
 * `keepPreviousData` is what makes paging and filtering feel continuous: the table keeps
 * showing the previous page while the next one is in flight instead of flashing the empty
 * state on every page change. The trade-off — `data` can be one page stale during the fetch —
 * is why callers read `isPlaceholderData` alongside it when they want to dim stale rows.
 *
 * The board is semi-public, so the caller never gates this on a session: an anonymous visitor
 * is served the same rows with `contact` cut by the server.
 */
export function useRecruitmentPosts(input: RecruitmentListInput) {
	return useQuery({
		...orpc.recruitment.list.queryOptions({ input }),
		placeholderData: keepPreviousData,
	});
}

/** Single-post query used by the detail page. */
export function useRecruitmentPost(postId: string) {
	return useQuery(orpc.recruitment.getById.queryOptions({ input: { id: postId } }));
}
