import type { PostStatus } from "@reactive-resume/schema/recruitment/data";
import type { SQL, SQLWrapper } from "drizzle-orm";
import type { AdminRecruitmentPostListInput, AdminRecruitmentPostUpdateInput } from "../../dto/recruitment";
import { ORPCError } from "@orpc/client";
import { and, asc, count, eq, gte, ilike, inArray, isNotNull, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@reactive-resume/db/client";
import { recruitmentPost, user } from "@reactive-resume/db/schema";
import { buildDedupeKey } from "@reactive-resume/schema/recruitment/dedupe";
import { adminProcedure } from "../../context";
import { adminRecruitmentPostDto, RECRUITMENT_ERROR_CODES } from "../../dto/recruitment";
import { recordAudit } from "../admin/audit";
import { escapeLike } from "../admin/sql";
import { assertCrossFieldRules, editableValues, findByDedupeKey, mergeForValidation, postNotFound } from "./crud";
import { notExpiredCondition } from "./expiry";
import { assertBoardEnabled, bookmarkedPostIds, ownerColumns, toOwnerPost } from "./service";

/**
 * The review queue — endpoints 12, 13 and 14 of §4.3 (`plans/46-campus-board-design.md`).
 *
 * Three things this file owns:
 *
 * 1. **The four moderation actions** (approve / reject / close / delete) and the audit trail
 *    that goes with the first three of them plus `delete` (§4.7). The audit write is
 *    best-effort: `recordAudit` logs a failure and never rethrows, because losing a log line
 *    must not take a moderation decision down with it.
 * 2. **`duplicateOf`**, the review card's most useful field: for every row on the page the
 *    server looks up the *other* holder of the same dedupe key, so a reviewer can spot a
 *    repeat submission without leaving the queue. The lookup is deliberately not limited to
 *    the current page — a duplicate on page 3 is still a duplicate.
 * 3. **The admin `edit` action**, which changes fields without touching the moderation state.
 *    It reuses `./crud`'s `editableValues` and `assertCrossFieldRules` so an administrator's
 *    edit and a submitter's edit cannot end up validating different things.
 */

/** `createdBy` and `reviewedBy` both reference `user`, so the join needs two names. */
const authorUser = alias(user, "recruitment_post_author");
const reviewerUser = alias(user, "recruitment_post_reviewer");

const listColumns = {
	...ownerColumns,
	dedupeKey: recruitmentPost.dedupeKey,
	authorId: authorUser.id,
	authorName: authorUser.name,
	authorEmail: authorUser.email,
	reviewerId: reviewerUser.id,
	reviewerName: reviewerUser.name,
};

function buildListFilters(input: AdminRecruitmentPostListInput, now: Date): SQL[] {
	const filters: SQL[] = [];

	if (input.status) filters.push(eq(recruitmentPost.status, input.status));
	if (input.createdBy) filters.push(eq(recruitmentPost.createdBy, input.createdBy));
	if (input.minReportCount !== undefined) filters.push(gte(recruitmentPost.reportCount, input.minReportCount));

	// The deadline filter is the exact negation of the public list's freshness predicate
	// (§3.6): not rolling, dated, and past due. A rolling post has never passed its deadline.
	if (input.hasDeadlinePassed === true) {
		filters.push(
			and(
				eq(recruitmentPost.rolling, false),
				isNotNull(recruitmentPost.deadline),
				lte(recruitmentPost.deadline, now),
			) ?? sql`true`,
		);
	} else if (input.hasDeadlinePassed === false) {
		filters.push(notExpiredCondition(now));
	}

	if (input.search) {
		const term = `%${escapeLike(input.search)}%`;
		const condition = or(
			ilike(recruitmentPost.company, term),
			ilike(recruitmentPost.role, term),
			ilike(authorUser.name, term),
		);
		if (condition) filters.push(condition);
	}

	return filters;
}

function buildListOrderBy(input: AdminRecruitmentPostListInput): SQL[] {
	const direction = input.sortOrder === "asc" ? "asc" : "desc";

	let column: SQLWrapper;
	if (input.sortBy === "reportCount") column = recruitmentPost.reportCount;
	else if (input.sortBy === "deadline") column = recruitmentPost.deadline;
	else if (input.sortBy === "publishedAt") column = recruitmentPost.publishedAt;
	else column = recruitmentPost.createdAt;

	// `nulls last` everywhere: a queue that floats undated posts to the top of a "closing
	// soonest" sort is a queue nobody can work through. `id` breaks ties so paging is stable.
	return [sql`${column} ${sql.raw(direction)} nulls last`, asc(recruitmentPost.id)];
}

type DuplicateSummary = { id: string; company: string; role: string; status: PostStatus };

/**
 * Every holder of each of this page's dedupe keys, keyed by that key.
 *
 * One extra SELECT rather than a self-join: a self-join has to run *before* `limit`, which
 * would make `limit` count pairs instead of posts. The lookup is not restricted to the page,
 * so a duplicate sitting further down the queue still shows up.
 *
 * The whole group is returned rather than one representative because the row being mapped is
 * itself in the group: taking "the first one" would routinely produce the row's own id and
 * leave `duplicateOf` empty on exactly the posts that have a duplicate.
 */
async function findDuplicateGroups(dedupeKeys: string[]): Promise<Map<string, DuplicateSummary[]>> {
	const groups = new Map<string, DuplicateSummary[]>();
	if (dedupeKeys.length === 0) return groups;

	const rows = await db
		.select({
			id: recruitmentPost.id,
			dedupeKey: recruitmentPost.dedupeKey,
			company: recruitmentPost.company,
			role: recruitmentPost.role,
			status: recruitmentPost.status,
		})
		.from(recruitmentPost)
		.where(inArray(recruitmentPost.dedupeKey, dedupeKeys));

	for (const row of rows) {
		const summary: DuplicateSummary = { id: row.id, company: row.company, role: row.role, status: row.status };
		const group = groups.get(row.dedupeKey);

		if (group) group.push(summary);
		else groups.set(row.dedupeKey, [summary]);
	}

	return groups;
}

/** The other holder of the key, i.e. never the row being mapped. */
function duplicateOf(
	groups: Map<string, DuplicateSummary[]>,
	dedupeKey: string,
	rowId: string,
): DuplicateSummary | null {
	return groups.get(dedupeKey)?.find((candidate) => candidate.id !== rowId) ?? null;
}

/** GET /admin/recruitment/posts — the review queue. */
async function list(input: AdminRecruitmentPostListInput, actor: { id: string }) {
	await assertBoardEnabled();
	const now = new Date();
	const where = and(...buildListFilters(input, now));

	const [rows, totals] = await Promise.all([
		db
			.select(listColumns)
			.from(recruitmentPost)
			.leftJoin(authorUser, eq(authorUser.id, recruitmentPost.createdBy))
			.leftJoin(reviewerUser, eq(reviewerUser.id, recruitmentPost.reviewedBy))
			.where(where)
			.orderBy(...buildListOrderBy(input))
			.limit(input.limit)
			.offset(input.offset),
		db.select({ value: count() }).from(recruitmentPost).where(where),
	]);

	const [groups, bookmarked] = await Promise.all([
		findDuplicateGroups(rows.map((row) => row.dedupeKey)),
		bookmarkedPostIds(
			rows.map((row) => row.id),
			actor.id,
		),
	]);

	return {
		items: rows.map((row) => {
			return {
				// The owner's view: public fields plus the contact block, the rejection reason
				// and the report count. An administrator is allowed all of it.
				...toOwnerPost(row, bookmarked.has(row.id), now),
				// `created_by` is `on delete set null`, so a post an administrator imported has
				// no author at all — hence the left join and the nullable block.
				createdBy:
					row.authorId && row.authorName !== null && row.authorEmail !== null
						? { id: row.authorId, name: row.authorName, email: row.authorEmail }
						: null,
				reviewedBy: row.reviewerId && row.reviewerName !== null ? { id: row.reviewerId, name: row.reviewerName } : null,
				dedupeKey: row.dedupeKey,
				// Never the row itself — a one-element group is not a duplicate.
				duplicateOf: duplicateOf(groups, row.dedupeKey, row.id),
			};
		}),
		total: Number(totals?.at(0)?.value ?? 0),
	};
}

/** PATCH /admin/recruitment/posts/{id} — approve, reject, close, or edit. */
async function update(input: AdminRecruitmentPostUpdateInput, actor: { id: string }) {
	await assertBoardEnabled();
	const now = new Date();

	const [row] = await db
		.select({
			id: recruitmentPost.id,
			status: recruitmentPost.status,
			dedupeKey: recruitmentPost.dedupeKey,
			company: recruitmentPost.company,
			role: recruitmentPost.role,
			locations: recruitmentPost.locations,
			applyUrl: recruitmentPost.applyUrl,
			sourceUrl: recruitmentPost.sourceUrl,
			contactKind: recruitmentPost.contactKind,
			contactValue: recruitmentPost.contactValue,
		})
		.from(recruitmentPost)
		.where(eq(recruitmentPost.id, input.id))
		.limit(1);

	if (!row) throw postNotFound();

	if (input.action === "edit") {
		const merged = mergeForValidation(row, input);
		assertCrossFieldRules(merged);

		const dedupeKey = buildDedupeKey(merged);

		if (dedupeKey !== row.dedupeKey) {
			const clash = await findByDedupeKey(dedupeKey);
			if (clash && clash.id !== row.id) {
				throw new ORPCError("CONFLICT", {
					message: "A post for this company, role and city already exists.",
					data: {
						code: RECRUITMENT_ERROR_CODES.duplicate,
						existingPostId: clash.id,
						existingPostStatus: clash.status,
					},
				});
			}
		}

		// Fields only: an administrator editing a post must not silently change its moderation
		// state, so a published post stays published and a rejected one stays rejected.
		await db
			.update(recruitmentPost)
			.set({ ...editableValues(input), dedupeKey })
			.where(eq(recruitmentPost.id, input.id));

		return { id: input.id, status: row.status };
	}

	if (input.action === "approve") {
		await db
			.update(recruitmentPost)
			.set({
				status: "published",
				publishedAt: now,
				reviewedBy: actor.id,
				reviewedAt: now,
				// A previous rejection no longer describes this post.
				rejectionReason: null,
			})
			.where(eq(recruitmentPost.id, input.id));

		await recordAudit({
			actorId: actor.id,
			action: "recruitment.post.approve",
			targetType: "recruitment_post",
			targetId: input.id,
			metadata: { company: row.company, role: row.role, from: row.status },
		});

		return { id: input.id, status: "published" };
	}

	if (input.action === "reject") {
		await db
			.update(recruitmentPost)
			.set({
				status: "rejected",
				rejectionReason: input.rejectionReason,
				reviewedBy: actor.id,
				reviewedAt: now,
				// A rejected post has no publish time: `publishedAt` is the public list's sort
				// key, and leaving it set would keep a rejected post ranked as if it were live.
				publishedAt: null,
			})
			.where(eq(recruitmentPost.id, input.id));

		await recordAudit({
			actorId: actor.id,
			action: "recruitment.post.reject",
			targetType: "recruitment_post",
			targetId: input.id,
			metadata: { company: row.company, role: row.role, from: row.status, reason: input.rejectionReason },
		});

		return { id: input.id, status: "rejected" };
	}

	// `close`: take the post down without deleting it. `publishedAt` is kept on purpose
	// (§4.3.15) — it records when the post *was* on the board, which is what a reviewer
	// looking at it again wants to know.
	await db
		.update(recruitmentPost)
		.set({ status: "closed", reviewedBy: actor.id, reviewedAt: now })
		.where(eq(recruitmentPost.id, input.id));

	await recordAudit({
		actorId: actor.id,
		action: "recruitment.post.close",
		targetType: "recruitment_post",
		targetId: input.id,
		metadata: { company: row.company, role: row.role, from: row.status },
	});

	return { id: input.id, status: "closed" };
}

/** DELETE /admin/recruitment/posts/{id} — reports and bookmarks cascade; applications survive. */
async function remove(input: { id: string }, actor: { id: string }): Promise<void> {
	await assertBoardEnabled();

	const [row] = await db
		.select({ id: recruitmentPost.id, company: recruitmentPost.company, role: recruitmentPost.role })
		.from(recruitmentPost)
		.where(eq(recruitmentPost.id, input.id))
		.limit(1);

	if (!row) throw postNotFound();

	await db.delete(recruitmentPost).where(eq(recruitmentPost.id, input.id));

	await recordAudit({
		actorId: actor.id,
		action: "recruitment.post.delete",
		targetType: "recruitment_post",
		targetId: input.id,
		metadata: { company: row.company, role: row.role },
	});
}

export const adminRecruitmentRouter = {
	list: adminProcedure
		.route({
			method: "GET",
			path: "/admin/recruitment/posts",
			tags: ["Internal"],
			operationId: "adminListRecruitmentPosts",
			summary: "List campus recruitment posts for review",
			description:
				"Returns a page of campus recruitment posts in every moderation state, with the submitter, the last reviewer, the dedupe key and any other post sharing it. Filterable by search, status, report count, deadline and submitter; sortable by report count. Administrator access required.",
			successDescription: "The current page of posts and the total number of matching posts.",
		})
		.input(adminRecruitmentPostDto.list.input)
		.output(adminRecruitmentPostDto.list.output)
		.handler(async ({ input, context }) => list(input, { id: context.user.id })),

	update: adminProcedure
		.route({
			method: "PATCH",
			path: "/admin/recruitment/posts/{id}",
			tags: ["Internal"],
			operationId: "adminUpdateRecruitmentPost",
			summary: "Approve, reject, close or edit a campus recruitment post",
			description:
				"One endpoint, four actions. Approve publishes the post; reject takes it down and records a reason shown to the submitter; close takes it down without deleting it; edit changes fields without touching the moderation state. Approve, reject and close each write an audit log entry. Administrator access required.",
			successDescription: "The post id and its moderation state after the action.",
		})
		.input(adminRecruitmentPostDto.update.input)
		.output(adminRecruitmentPostDto.update.output)
		.handler(async ({ input, context }) => update(input, { id: context.user.id })),

	delete: adminProcedure
		.route({
			method: "DELETE",
			path: "/admin/recruitment/posts/{id}",
			tags: ["Internal"],
			operationId: "adminDeleteRecruitmentPost",
			summary: "Delete a campus recruitment post",
			description:
				"Permanently deletes a campus recruitment post; its reports and bookmarks are removed with it. Applications created from the post survive. Writes an audit log entry. Administrator access required.",
			successDescription: "The post was deleted.",
		})
		.input(adminRecruitmentPostDto.delete.input)
		.output(adminRecruitmentPostDto.delete.output)
		.handler(async ({ input, context }) => remove(input, { id: context.user.id })),
};

export { list, remove, update };
