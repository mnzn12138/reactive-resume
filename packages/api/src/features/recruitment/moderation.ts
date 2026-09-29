import type { SQL } from "drizzle-orm";
import type {
	AdminRecruitmentReportListInput,
	AdminRecruitmentReportUpdateInput,
	RecruitmentPostReportInput,
} from "../../dto/recruitment";
import { ORPCError } from "@orpc/client";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@reactive-resume/db/client";
import { recruitmentPost, recruitmentPostBookmark, recruitmentPostReport, user } from "@reactive-resume/db/schema";
import { generateId } from "@reactive-resume/utils/string";
import { adminProcedure, protectedProcedure } from "../../context";
import { adminRecruitmentReportDto, RECRUITMENT_ERROR_CODES, recruitmentPostDto } from "../../dto/recruitment";
import { recruitmentSubmissionRateLimit } from "../../middleware/rate-limit";
import { assertBoardEnabled, loadVisiblePost, toViewer } from "./service";

/**
 * Bookmarks and reports — endpoints 8, 9, 10, 15 and 16 of §4.3
 * (`plans/46-campus-board-design.md`).
 *
 * Two choices are worth stating here:
 *
 * 1. **Both bookmark endpoints are idempotent by construction.** `recruitment_post_bookmark`
 *    has a composite primary key of (user, post), so a repeated PUT is a no-op rather than a
 *    duplicate row or a 409, and a repeated DELETE is a no-op too. A toggle-shaped endpoint
 *    would have to answer "what state is it in now", which is a read the client already has.
 * 2. **A report is never silently deduplicated.** The `(post_id, reporter_id)` unique index
 *    is the real guard, but the handler also answers 409 `RECRUITMENT_ALREADY_REPORTED`
 *    instead of swallowing the second report, because `report_count` is what an
 *    administrator sorts the queue by: a caller who thinks their report landed and a queue
 *    that disagrees is worse than an explicit conflict.
 */

/** The actor behind a request. */
type RecruitmentActor = { id: string; role?: unknown };

/** `recruitment_post_report.handled_by` points at `user` too, so the join needs a second name. */
const handlerUser = alias(user, "recruitment_report_handler");

/** Postgres unique-violation, i.e. two reports racing between the SELECT and the INSERT. */
function isUniqueViolation(error: unknown): boolean {
	return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "23505";
}

/**
 * PUT /recruitment/posts/{id}/bookmark — idempotent add.
 *
 * The post is loaded through the ordinary visibility rule first: bookmarking a pending post
 * you cannot see would both leak its existence and put an unreachable row in the caller's
 * private list.
 */
async function bookmark(input: { id: string }, actor: RecruitmentActor) {
	await assertBoardEnabled();

	await loadVisiblePost(input.id, toViewer({ user: actor }));

	await db.insert(recruitmentPostBookmark).values({ userId: actor.id, postId: input.id }).onConflictDoNothing();

	return { bookmarked: true };
}

/**
 * DELETE /recruitment/posts/{id}/bookmark — idempotent remove.
 *
 * No visibility check and no existence check: deleting a bookmark that is already gone (a
 * post that was withdrawn, or a second click) has to stay a no-op rather than a 404, or the
 * button would report failure for the most common double-click there is.
 */
async function unbookmark(input: { id: string }, actor: RecruitmentActor) {
	await assertBoardEnabled();

	await db
		.delete(recruitmentPostBookmark)
		.where(and(eq(recruitmentPostBookmark.userId, actor.id), eq(recruitmentPostBookmark.postId, input.id)));

	return { bookmarked: false };
}

/**
 * POST /recruitment/posts/{id}/report — one report per person per post.
 *
 * The report row and the counter are written in one transaction: `report_count` is what the
 * review queue sorts on, and a counter that missed its row (or a row whose insert rolled
 * back) would let a contested post sit at the bottom of the queue.
 */
async function report(input: RecruitmentPostReportInput, actor: RecruitmentActor) {
	await assertBoardEnabled();

	const post = await loadVisiblePost(input.id, toViewer({ user: actor }));

	if (post.createdBy === actor.id) {
		throw new ORPCError("BAD_REQUEST", {
			message: "You cannot report a post you submitted yourself.",
			data: { code: RECRUITMENT_ERROR_CODES.selfReport },
		});
	}

	const [existing] = await db
		.select({ id: recruitmentPostReport.id })
		.from(recruitmentPostReport)
		.where(and(eq(recruitmentPostReport.postId, input.id), eq(recruitmentPostReport.reporterId, actor.id)))
		.limit(1);

	if (existing) {
		throw new ORPCError("CONFLICT", {
			message: "You have already reported this post.",
			data: { code: RECRUITMENT_ERROR_CODES.alreadyReported, reportId: existing.id },
		});
	}

	const id = generateId();

	try {
		return await db.transaction(async (tx) => {
			await tx.insert(recruitmentPostReport).values({
				id,
				postId: input.id,
				reporterId: actor.id,
				reason: input.reason,
				...(input.detail !== undefined ? { detail: input.detail } : {}),
			});

			// Incremented in SQL rather than read-then-written: two concurrent reports must
			// both be counted.
			const [updated] = await tx
				.update(recruitmentPost)
				.set({ reportCount: sql`${recruitmentPost.reportCount} + 1` })
				.where(eq(recruitmentPost.id, input.id))
				.returning({ reportCount: recruitmentPost.reportCount });

			return { id, reportCount: updated?.reportCount ?? 0 };
		});
	} catch (error) {
		// The SELECT above cannot see a report committed by a concurrent request, so the
		// unique index is still the final arbiter — translate it into the same 409.
		if (isUniqueViolation(error)) {
			throw new ORPCError("CONFLICT", {
				message: "You have already reported this post.",
				data: { code: RECRUITMENT_ERROR_CODES.alreadyReported },
			});
		}

		throw error;
	}
}

const reportListColumns = {
	id: recruitmentPostReport.id,
	postId: recruitmentPostReport.postId,
	reason: recruitmentPostReport.reason,
	detail: recruitmentPostReport.detail,
	handled: recruitmentPostReport.handled,
	handledAt: recruitmentPostReport.handledAt,
	createdAt: recruitmentPostReport.createdAt,
	reporterId: user.id,
	reporterName: user.name,
	reporterEmail: user.email,
	handlerId: handlerUser.id,
	handlerName: handlerUser.name,
	postCompany: recruitmentPost.company,
	postRole: recruitmentPost.role,
	postStatus: recruitmentPost.status,
};

function buildReportFilters(input: AdminRecruitmentReportListInput): SQL[] {
	const filters: SQL[] = [];

	if (input.postId) filters.push(eq(recruitmentPostReport.postId, input.postId));
	if (input.reason) filters.push(eq(recruitmentPostReport.reason, input.reason));
	if (input.handled !== undefined) filters.push(eq(recruitmentPostReport.handled, input.handled));

	return filters;
}

/** GET /admin/recruitment/reports — the report queue, unhandled-first by way of newest-first. */
async function listReports(input: AdminRecruitmentReportListInput) {
	await assertBoardEnabled();

	const where = and(...buildReportFilters(input));

	const [rows, totals] = await Promise.all([
		db
			.select(reportListColumns)
			.from(recruitmentPostReport)
			.innerJoin(recruitmentPost, eq(recruitmentPost.id, recruitmentPostReport.postId))
			.innerJoin(user, eq(user.id, recruitmentPostReport.reporterId))
			.leftJoin(handlerUser, eq(handlerUser.id, recruitmentPostReport.handledBy))
			.where(where)
			.orderBy(desc(recruitmentPostReport.createdAt))
			.limit(input.limit)
			.offset(input.offset),
		db.select({ value: count() }).from(recruitmentPostReport).where(where),
	]);

	return {
		// Mapped inline rather than through a helper so the row type keeps the enum-typed
		// columns the schema declares (`reason`, `status`) instead of widening them to string.
		items: rows.map((row) => ({
			id: row.id,
			postId: row.postId,
			post: {
				id: row.postId,
				company: row.postCompany,
				role: row.postRole,
				status: row.postStatus,
			},
			// `reporter_id` is `on delete cascade`, so the inner join always yields a row; the
			// fallback keeps the mapping total for a row restored outside the constraint.
			reporter: {
				id: row.reporterId ?? "",
				name: row.reporterName ?? "",
				email: row.reporterEmail ?? "",
			},
			reason: row.reason,
			detail: row.detail,
			handled: row.handled,
			// `handled_by` is `on delete set null`: a handler that no longer exists keeps the
			// verdict but loses the attribution, which is why this is a left join.
			handledBy: row.handlerId && row.handlerName !== null ? { id: row.handlerId, name: row.handlerName } : null,
			handledAt: row.handledAt,
			createdAt: row.createdAt,
		})),
		total: Number(totals?.at(0)?.value ?? 0),
	};
}

/**
 * PATCH /admin/recruitment/reports/{id} — mark handled, or reopen.
 *
 * Reopening clears `handled_by` / `handled_at` rather than leaving them at their old values:
 * a report showing `handled = false` next to a handler and a timestamp is unattributable in
 * exactly the way the schema comment warns about.
 */
async function updateReport(input: AdminRecruitmentReportUpdateInput, actor: RecruitmentActor) {
	await assertBoardEnabled();

	const [existing] = await db
		.select({ id: recruitmentPostReport.id })
		.from(recruitmentPostReport)
		.where(eq(recruitmentPostReport.id, input.id))
		.limit(1);

	if (!existing) {
		throw new ORPCError("NOT_FOUND", {
			message: "Recruitment post report not found.",
			data: { code: RECRUITMENT_ERROR_CODES.postNotFound },
		});
	}

	await db
		.update(recruitmentPostReport)
		.set({
			handled: input.handled,
			handledBy: input.handled ? actor.id : null,
			handledAt: input.handled ? new Date() : null,
		})
		.where(eq(recruitmentPostReport.id, input.id));

	return { id: input.id, handled: input.handled };
}

export const moderationRouter = {
	bookmark: protectedProcedure
		.route({
			method: "PUT",
			path: "/recruitment/posts/{id}/bookmark",
			tags: ["Recruitment"],
			operationId: "bookmarkRecruitmentPost",
			summary: "Save a campus recruitment post",
			description:
				"Adds a post to the caller's bookmarks. Idempotent: saving a post that is already saved changes nothing and returns the same result. Requires authentication.",
			successDescription: "The bookmark state after the call.",
		})
		.input(recruitmentPostDto.bookmark.input)
		.output(recruitmentPostDto.bookmark.output)
		.handler(async ({ input, context }) => bookmark(input, { id: context.user.id, role: context.user.role })),

	unbookmark: protectedProcedure
		.route({
			method: "DELETE",
			path: "/recruitment/posts/{id}/bookmark",
			tags: ["Recruitment"],
			operationId: "unbookmarkRecruitmentPost",
			summary: "Remove a saved campus recruitment post",
			description:
				"Removes a post from the caller's bookmarks. Idempotent: removing a bookmark that is already gone is a no-op, not an error. Requires authentication.",
			successDescription: "The bookmark state after the call.",
		})
		.input(recruitmentPostDto.unbookmark.input)
		.output(recruitmentPostDto.unbookmark.output)
		.handler(async ({ input, context }) => unbookmark(input, { id: context.user.id, role: context.user.role })),

	report: protectedProcedure
		.route({
			method: "POST",
			path: "/recruitment/posts/{id}/report",
			tags: ["Recruitment"],
			operationId: "reportRecruitmentPost",
			summary: "Report a campus recruitment post",
			description:
				"Files a report against a published post. One report per person per post: a second one is answered with 409. Reporting your own post is a 400. Requires authentication.",
			successDescription: "The id of the report and the post's report count after it.",
		})
		.input(recruitmentPostDto.report.input)
		.use(recruitmentSubmissionRateLimit)
		.output(recruitmentPostDto.report.output)
		.handler(async ({ input, context }) => report(input, { id: context.user.id, role: context.user.role })),
};

/** Endpoints 15 and 16. Mounted under `/admin` by `features/admin/router.ts`. */
export const adminReportRouter = {
	list: adminProcedure
		.route({
			method: "GET",
			path: "/admin/recruitment/reports",
			tags: ["Internal"],
			operationId: "adminListRecruitmentReports",
			summary: "List campus recruitment reports",
			description:
				"Returns a page of reports about campus recruitment posts, newest first, with the reported post, the reporter and who handled it. Filterable by post, reason and handled state. Administrator access required.",
			successDescription: "The current page of reports and the total number of matching reports.",
		})
		.input(adminRecruitmentReportDto.list.input)
		.output(adminRecruitmentReportDto.list.output)
		.handler(async ({ input }) => listReports(input)),

	update: adminProcedure
		.route({
			method: "PATCH",
			path: "/admin/recruitment/reports/{id}",
			tags: ["Internal"],
			operationId: "adminUpdateRecruitmentReport",
			summary: "Mark a campus recruitment report handled",
			description:
				"Marks a report handled, recording who handled it and when, or reopens it, clearing both. Administrator access required.",
			successDescription: "The report id and its handled state after the call.",
		})
		.input(adminRecruitmentReportDto.update.input)
		.output(adminRecruitmentReportDto.update.output)
		.handler(async ({ input, context }) => updateReport(input, { id: context.user.id, role: context.user.role })),
};

export { bookmark, listReports, report, unbookmark, updateReport };
