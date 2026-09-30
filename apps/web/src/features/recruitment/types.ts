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

/** What a submitter sees about their own post: contact, rejection reason, report count. */
export type RecruitmentPostOwner = RouterOutput["recruitment"]["mine"]["items"][number];

/** The review queue's row: everything the owner sees, plus submitter and reviewer. */
export type RecruitmentPostAdmin = RouterOutput["admin"]["recruitment"]["posts"]["list"]["items"][number];

/** One row of the report queue. */
export type RecruitmentReportAdmin = RouterOutput["admin"]["recruitment"]["reports"]["list"]["items"][number];

/** The four moderation actions, as the discriminated union the server declares them. */
export type AdminRecruitmentPostUpdateInput = RouterInput["admin"]["recruitment"]["posts"]["update"];

/** Input of the submitter's own create / update pair. */
export type RecruitmentPostCreateInput = RouterInput["recruitment"]["create"];
export type RecruitmentPostUpdateInput = RouterInput["recruitment"]["update"];
