import type { RouterInput, RouterOutput } from "@/libs/orpc/client";

/**
 * Row shapes for the campus recruitment board (`/jobs`).
 *
 * Both come straight off the oRPC contract rather than being re-declared here: a field the
 * server adds later shows up in these types on the next build instead of silently missing.
 */

/** One row of the public list — what `recruitment.list` returns per post. */
export type RecruitmentPost = RouterOutput["recruitment"]["list"]["items"][number];

/** The detail page's row: every public field, plus `contact` and `rejectionReason`. */
export type RecruitmentPostDetail = RouterOutput["recruitment"]["getById"];

/** The list query's input, so helper functions can build one without guessing field names. */
export type RecruitmentListInput = RouterInput["recruitment"]["list"];
