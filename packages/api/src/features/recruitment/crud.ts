import type {
	Batch,
	Benefit,
	ContactKind,
	EducationRequired,
	EmploymentType,
	PostStatus,
	RecruitmentSource,
	WorkIntensity,
	WorkMode,
} from "@reactive-resume/schema/recruitment/data";
import type {
	RecruitmentPostCreateInput,
	RecruitmentPostEditableInput,
	RecruitmentPostUpdateInput,
} from "../../dto/recruitment";
import { ORPCError } from "@orpc/client";
import { and, count, desc, eq } from "drizzle-orm";
import { isRecruitmentReviewRequired, isRecruitmentSubmissionEnabled } from "@reactive-resume/auth/instance-settings";
import { db } from "@reactive-resume/db/client";
import { recruitmentPost, recruitmentPostBookmark } from "@reactive-resume/db/schema";
import { buildDedupeKey } from "@reactive-resume/schema/recruitment/dedupe";
import { generateId } from "@reactive-resume/utils/string";
import { protectedProcedure, publicProcedure } from "../../context";
import { RECRUITMENT_ERROR_CODES, recruitmentPostDto } from "../../dto/recruitment";
import { recruitmentReadRateLimit, recruitmentSubmissionRateLimit } from "../../middleware/rate-limit";
import { isAdminRole } from "../../roles";
import { applicationService } from "../applications/service";
import { buildApplicationDraft } from "./convert";
import {
	assertBoardEnabled,
	bookmarkedPostIds,
	loadVisiblePost,
	ownerColumns,
	publicColumns,
	recruitmentService,
	toOwnerPost,
	toPublicPost,
	toViewer,
} from "./service";

/**
 * Public and owner-scoped handlers for the campus recruitment board — endpoints 1, 2 and
 * 3–7 / 11 of §4.3 (`plans/46-campus-board-design.md`).
 *
 * The bookkeeping rules that every write endpoint shares live here and are exported, because
 * the admin `edit` action (endpoint 13, in `./review`) has to apply exactly the same ones:
 *
 * - **A post the caller may not act on is a 404, never a 403** (§4.5). A 403 would confirm
 *   that the post exists, which is how the review queue would start leaking: "does user X
 *   have a pending post about company Y" is answerable with a 403 and not with a 404.
 *   (§4.3.7 and §4.8 list 403 `RECRUITMENT_NOT_OWNER` for this case; the task's rule and
 *   §4.5's own note both say 404, and 404 is the safer of the two, so 404 wins here.)
 * - **The dedupe key is always recomputed server-side** — never taken from the request.
 * - **The two cross-field rules of `create` are re-run against the merged row** on a partial
 *   update, because the other half of a pair is usually only in the database.
 */

/** The actor behind a protected request. `role` is opaque here; `./roles` interprets it. */
export type RecruitmentActor = { id: string; role?: unknown };

/**
 * The editable columns as row values, every one optional.
 *
 * Deliberately *not* `typeof recruitmentPost.$inferInsert`: that type makes `company`, `role`
 * and `dedupeKey` required (they are NOT NULL without a default), which is wrong for a partial
 * update and would make the caller's dedupe key look like it came from the request. Every
 * property carries an explicit `| undefined` because `exactOptionalPropertyTypes` is on in
 * this repo, and the whole point of this type is to hold "the caller omitted this".
 */
type EditableRowValues = {
	company?: string | undefined;
	role?: string | undefined;
	companyLogoUrl?: string | null | undefined;
	batch?: Batch | undefined;
	employmentType?: EmploymentType[] | undefined;
	workMode?: WorkMode[] | undefined;
	workIntensity?: WorkIntensity[] | undefined;
	locations?: string[] | undefined;
	educationRequired?: EducationRequired[] | undefined;
	benefits?: Benefit[] | undefined;
	tags?: string[] | undefined;
	salaryText?: string | null | undefined;
	deadline?: Date | null | undefined;
	rolling?: boolean | undefined;
	applyUrl?: string | null | undefined;
	contactKind?: ContactKind | null | undefined;
	contactValue?: string | null | undefined;
	referralCode?: string | null | undefined;
	summary?: string | null | undefined;
	source?: RecruitmentSource | null | undefined;
	sourceUrl?: string | null | undefined;
};

const nowISO = () => new Date();

/**
 * Error factory for "this post does not exist, or you may not act on it".
 *
 * The two are deliberately indistinguishable in the response: §4.5.
 */
export function postNotFound() {
	return new ORPCError("NOT_FOUND", {
		message: "Recruitment post not found.",
		data: { code: RECRUITMENT_ERROR_CODES.postNotFound },
	});
}

/**
 * The stored row merged with a partial edit, narrowed to what the two cross-field rules and
 * the dedupe key actually read.
 *
 * Narrowed on purpose rather than spreading the whole row: `undefined` from the patch means
 * "leave it alone", while `null` from the database means "absent", and the rules below have
 * to tell those two apart. A blanket `{ ...row, ...values }` would blur them.
 */
export function mergeForValidation(
	row: {
		company: string;
		role: string;
		locations: string[];
		applyUrl: string | null;
		sourceUrl: string | null;
		contactKind: string | null;
		contactValue: string | null;
	},
	patch: RecruitmentPostEditableInput,
) {
	return {
		company: patch.company ?? row.company,
		role: patch.role ?? row.role,
		locations: patch.locations ?? row.locations,
		applyUrl: patch.applyUrl !== undefined ? patch.applyUrl : row.applyUrl,
		sourceUrl: patch.sourceUrl !== undefined ? patch.sourceUrl : row.sourceUrl,
		contactKind: (patch.contactKind !== undefined ? patch.contactKind : row.contactKind) ?? null,
		contactValue: (patch.contactValue !== undefined ? patch.contactValue : row.contactValue) ?? null,
	};
}

/** Postgres unique-violation, i.e. the database caught a race the handler's SELECT missed. */
function isUniqueViolation(error: unknown): boolean {
	return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "23505";
}

/**
 * Map an editable input onto row values, one conditional spread per field.
 *
 * Written out rather than passed through as a whole object for two reasons: drizzle's typed
 * insert/update then catches a wrong field name, and `exactOptionalPropertyTypes` (on in this
 * repo) rejects an explicit `undefined` on a column that has a database default — which is
 * exactly what a `Partial` built from the DTO would carry for every field the caller omitted.
 */
export function editableValues(input: RecruitmentPostEditableInput): EditableRowValues {
	return {
		...(input.company !== undefined ? { company: input.company } : {}),
		...(input.role !== undefined ? { role: input.role } : {}),
		...(input.companyLogoUrl !== undefined ? { companyLogoUrl: input.companyLogoUrl } : {}),
		...(input.batch !== undefined ? { batch: input.batch } : {}),
		...(input.employmentType !== undefined ? { employmentType: [...input.employmentType] } : {}),
		...(input.workMode !== undefined ? { workMode: [...input.workMode] } : {}),
		...(input.workIntensity !== undefined ? { workIntensity: [...input.workIntensity] } : {}),
		...(input.locations !== undefined ? { locations: [...input.locations] } : {}),
		...(input.educationRequired !== undefined ? { educationRequired: [...input.educationRequired] } : {}),
		...(input.benefits !== undefined ? { benefits: [...input.benefits] } : {}),
		...(input.tags !== undefined ? { tags: [...input.tags] } : {}),
		...(input.salaryText !== undefined ? { salaryText: input.salaryText } : {}),
		...(input.deadline !== undefined ? { deadline: input.deadline } : {}),
		...(input.rolling !== undefined ? { rolling: input.rolling } : {}),
		...(input.applyUrl !== undefined ? { applyUrl: input.applyUrl } : {}),
		...(input.contactKind !== undefined ? { contactKind: input.contactKind } : {}),
		...(input.contactValue !== undefined ? { contactValue: input.contactValue } : {}),
		...(input.referralCode !== undefined ? { referralCode: input.referralCode } : {}),
		...(input.summary !== undefined ? { summary: input.summary } : {}),
		...(input.source !== undefined ? { source: input.source } : {}),
		...(input.sourceUrl !== undefined ? { sourceUrl: input.sourceUrl } : {}),
	};
}

/**
 * The two cross-field rules of §4.3.6, re-run against what will actually be stored.
 *
 * On a partial update the other half of either pair may live only in the database — a caller
 * fixing a dead link sends `applyUrl` alone and the stored `sourceUrl` is what makes the post
 * legal. The DTO cannot see the row, so it cannot check this; the service must.
 *
 * An empty string counts as absent for both links: `applyUrl: ""` is a validation failure at
 * the zod layer already, but a stored empty string from older data must not pass here either.
 */
export function assertCrossFieldRules(post: {
	applyUrl: string | null;
	sourceUrl: string | null;
	contactKind: string | null;
	contactValue: string | null;
}): void {
	const applyUrl = post.applyUrl && post.applyUrl.length > 0 ? post.applyUrl : null;
	const sourceUrl = post.sourceUrl && post.sourceUrl.length > 0 ? post.sourceUrl : null;

	if (!applyUrl && !sourceUrl) {
		throw new ORPCError("BAD_REQUEST", {
			message: "Either `applyUrl` or `sourceUrl` is required — a post needs at least one link behind it.",
			data: { code: RECRUITMENT_ERROR_CODES.sourceRequired },
		});
	}

	if ((post.contactKind === null) !== (post.contactValue === null)) {
		throw new ORPCError("BAD_REQUEST", {
			message: "`contactKind` and `contactValue` must be provided together.",
			data: { code: RECRUITMENT_ERROR_CODES.contactIncomplete },
		});
	}
}

/**
 * The moderation state a freshly submitted or re-submitted post lands in.
 *
 * `recruitmentRequireReview` decides it (§4.5): with review on, a submission is `pending`
 * until an administrator approves it; with review off it is visible immediately. A
 * re-submission after a rejection takes the same path, so a rejected post can never reappear
 * on the board without going through the queue again.
 */
async function initialStatus(): Promise<{ status: PostStatus; publishedAt: Date | null }> {
	if (await isRecruitmentReviewRequired()) return { status: "pending", publishedAt: null };

	return { status: "published", publishedAt: nowISO() };
}

/** The dedupe-key holder, when there is one. */
async function findByDedupeKey(dedupeKey: string) {
	const [row] = await db
		.select({ id: recruitmentPost.id, status: recruitmentPost.status, createdBy: recruitmentPost.createdBy })
		.from(recruitmentPost)
		.where(eq(recruitmentPost.dedupeKey, dedupeKey))
		.limit(1);

	return row ?? null;
}

/** A duplicate is a conflict in every state except the ones a caller may take over. */
function duplicateError(existing: { id: string; status: PostStatus }) {
	return new ORPCError("CONFLICT", {
		message: "A post for this company, role and city already exists.",
		data: {
			code: RECRUITMENT_ERROR_CODES.duplicate,
			existingPostId: existing.id,
			existingPostStatus: existing.status,
		},
	});
}

/**
 * Whether a caller may take an existing, non-live row over instead of being refused.
 *
 * `recruitment_post.dedupe_key` is UNIQUE, so a second row for the same opening is impossible
 * — the database, not the handler, is the final arbiter. The only way to let a submitter
 * re-submit a rejected (or closed, or expired, or never-finished) post is therefore to reuse
 * the row: put it back into `pending` with the new values. That is allowed for the row's
 * author and for an administrator, and only then.
 */
function mayTakeOver(existing: { createdBy: string | null }, actor: RecruitmentActor): boolean {
	return isAdminRole(actor.role) || existing.createdBy === actor.id;
}

async function create(input: RecruitmentPostCreateInput, actor: RecruitmentActor) {
	await assertBoardEnabled();

	if (!isAdminRole(actor.role) && !(await isRecruitmentSubmissionEnabled())) {
		throw new ORPCError("FORBIDDEN", {
			message: "Submitting campus recruitment posts is disabled on this instance.",
			data: { code: RECRUITMENT_ERROR_CODES.submissionDisabled },
		});
	}

	// Server-side, always: a client-supplied dedupe key is never trusted (§3.7).
	const dedupeKey = buildDedupeKey({
		company: input.company,
		role: input.role,
		locations: input.locations ?? [],
	});
	const existing = await findByDedupeKey(dedupeKey);

	if (existing) {
		// A live post is a flat refusal: the submitter can see it and should bookmark it.
		if (existing.status === "published" || existing.status === "pending") throw duplicateError(existing);

		if (!mayTakeOver(existing, actor)) throw duplicateError(existing);

		const { status, publishedAt } = await initialStatus();

		await db
			.update(recruitmentPost)
			.set({
				...editableValues(input),
				dedupeKey,
				status,
				publishedAt,
				// The previous verdict no longer describes this submission.
				rejectionReason: null,
				reviewedBy: null,
				reviewedAt: null,
			})
			.where(eq(recruitmentPost.id, existing.id));

		return { id: existing.id };
	}

	const id = generateId();
	const { status, publishedAt } = await initialStatus();

	await db.insert(recruitmentPost).values({
		...editableValues(input),
		// Spread first, then pinned: `company` / `role` are NOT NULL without a default, so the
		// insert type demands them, and the create input is the only path that always has them.
		company: input.company,
		role: input.role,
		id,
		createdBy: actor.id,
		dedupeKey,
		status,
		publishedAt,
	});

	return { id };
}

/**
 * Editing a post the caller already had published puts it back in the queue (§4.3.7).
 *
 * Without this a submitter could publish an approved post and then quietly rewrite its
 * company, contact or apply link without another look from a reviewer — an approval would
 * become a permanent bypass.
 */
function statusAfterEdit(current: PostStatus): PostStatus {
	if (current === "published") return "pending";
	// Fixing a rejected post and re-sending it is the point of showing the reason at all.
	if (current === "rejected") return "pending";

	return current;
}

async function update(input: RecruitmentPostUpdateInput, actor: RecruitmentActor) {
	await assertBoardEnabled();

	const { id, ...patch } = input;
	const [row] = await db
		.select({
			id: recruitmentPost.id,
			createdBy: recruitmentPost.createdBy,
			status: recruitmentPost.status,
			dedupeKey: recruitmentPost.dedupeKey,
			applyUrl: recruitmentPost.applyUrl,
			sourceUrl: recruitmentPost.sourceUrl,
			contactKind: recruitmentPost.contactKind,
			contactValue: recruitmentPost.contactValue,
			company: recruitmentPost.company,
			role: recruitmentPost.role,
			locations: recruitmentPost.locations,
		})
		.from(recruitmentPost)
		.where(eq(recruitmentPost.id, id))
		.limit(1);

	// Not yours, or not there: the same answer either way (§4.5).
	if (!row || row.createdBy !== actor.id) throw postNotFound();

	if (row.status === "closed" || row.status === "expired") {
		// An administrator took this one down on purpose; editing it back into the queue from
		// the owner side would quietly undo that decision. Withdraw it and submit again.
		throw new ORPCError("CONFLICT", {
			message: "This post has been taken down and cannot be edited. Submit it again instead.",
			data: { code: RECRUITMENT_ERROR_CODES.postClosed },
		});
	}

	const merged = mergeForValidation(row, patch);
	assertCrossFieldRules(merged);

	const dedupeKey = buildDedupeKey(merged);

	if (dedupeKey !== row.dedupeKey) {
		const clash = await findByDedupeKey(dedupeKey);
		if (clash && clash.id !== row.id) throw duplicateError(clash);
	}

	const nextStatus = statusAfterEdit(row.status);

	await db
		.update(recruitmentPost)
		.set({
			...editableValues(patch),
			dedupeKey,
			status: nextStatus,
			// A re-queued post is not published any more, so it must not keep a publish time:
			// `publishedAt` is the public list's sort key and would otherwise float a post that
			// is in review back to the top of the board.
			...(nextStatus === "pending" && row.status !== "pending" ? { publishedAt: null } : {}),
			// Same reasoning for the rejection reason: it describes a submission that has since
			// been changed, so showing it to the author would be misleading.
			...(row.status === "rejected" ? { rejectionReason: null } : {}),
		})
		.where(eq(recruitmentPost.id, id));

	return { id };
}

async function remove(input: { id: string }, actor: RecruitmentActor): Promise<void> {
	await assertBoardEnabled();

	const [row] = await db
		.select({ id: recruitmentPost.id, createdBy: recruitmentPost.createdBy })
		.from(recruitmentPost)
		.where(eq(recruitmentPost.id, input.id))
		.limit(1);

	if (!row || row.createdBy !== actor.id) throw postNotFound();

	// Reports and bookmarks follow by cascade; applications outlive the post by design (§4.3.16).
	await db.delete(recruitmentPost).where(eq(recruitmentPost.id, input.id));
}

/** GET /recruitment/mine — the caller's own posts in every state, newest first. */
async function mine(
	input: { status?: PostStatus | undefined; limit: number; offset: number },
	actor: RecruitmentActor,
) {
	await assertBoardEnabled();
	const now = nowISO();

	const where = and(
		eq(recruitmentPost.createdBy, actor.id),
		input.status ? eq(recruitmentPost.status, input.status) : undefined,
	);

	const [rows, totals] = await Promise.all([
		db
			.select(ownerColumns)
			.from(recruitmentPost)
			.where(where)
			.orderBy(desc(recruitmentPost.createdAt))
			.limit(input.limit)
			.offset(input.offset),
		db.select({ value: count() }).from(recruitmentPost).where(where),
	]);

	const bookmarked = await bookmarkedPostIds(
		rows.map((row) => row.id),
		actor.id,
	);

	return {
		items: rows.map((row) => toOwnerPost(row, bookmarked.has(row.id), now)),
		total: Number(totals?.at(0)?.value ?? 0),
	};
}

/**
 * GET /recruitment/bookmarks — the caller's saved posts, newest bookmark first.
 *
 * Unlike the public list this one keeps expired and taken-down posts: a bookmark is the
 * caller's private list, and silently dropping rows from it would look like data loss. The
 * `availability` field still reports `expired` honestly (§4.3.10).
 */
async function bookmarks(input: { limit: number; offset: number }, actor: RecruitmentActor) {
	await assertBoardEnabled();
	const now = nowISO();

	const where = eq(recruitmentPostBookmark.userId, actor.id);

	const [rows, totals] = await Promise.all([
		db
			.select(publicColumns)
			.from(recruitmentPostBookmark)
			.innerJoin(recruitmentPost, eq(recruitmentPost.id, recruitmentPostBookmark.postId))
			.where(where)
			.orderBy(desc(recruitmentPostBookmark.createdAt))
			.limit(input.limit)
			.offset(input.offset),
		db.select({ value: count() }).from(recruitmentPostBookmark).where(where),
	]);

	// Every row came from the caller's own bookmark table, so `bookmarked` is true by
	// construction — no second query needed.
	return {
		items: rows.map((row) => toPublicPost(row, true, now)),
		total: Number(totals?.at(0)?.value ?? 0),
	};
}

/**
 * POST /recruitment/posts/{id}/to-application — the MCP / quick-add path of §5.7.
 *
 * The mapping is `buildApplicationDraft` from `./convert`, the same function the web app
 * imports to pre-fill its form sheet — so the two paths cannot drift about what a converted
 * post looks like. Nothing is written here beyond handing the draft to
 * `applicationService.create`, which owns the timeline entry and the resume ownership check.
 */
async function convertToApplication(input: { id: string; resumeId?: string | undefined }, actor: RecruitmentActor) {
	await assertBoardEnabled();

	// The post has to be reachable by this caller under the ordinary visibility rule: a
	// stranger must not be able to pull a pending post into their own pipeline.
	const post = await loadVisiblePost(input.id, toViewer({ user: actor }));
	const draft = buildApplicationDraft(post);

	const applicationId = await applicationService.create({
		userId: actor.id,
		...draft,
		...(input.resumeId !== undefined ? { resumeId: input.resumeId } : {}),
	});

	return { applicationId };
}

export const crudRouter = {
	list: publicProcedure
		.route({
			method: "GET",
			path: "/recruitment/posts",
			tags: ["Recruitment"],
			operationId: "listRecruitmentPosts",
			summary: "List campus recruitment posts",
			description:
				"Returns a page of published campus job openings together with the total number of posts matching the filters. Filters combine as OR within one field and AND across fields. Expired posts are excluded unless includeExpired is set, and contact details are omitted for anonymous callers.",
			successDescription: "The current page of posts and the total number of matching posts.",
		})
		.input(recruitmentPostDto.list.input)
		.use(recruitmentReadRateLimit)
		.output(recruitmentPostDto.list.output)
		.handler(async ({ input, context }) => {
			await assertBoardEnabled();

			return recruitmentService.list({ ...input, viewer: toViewer(context) });
		}),

	getById: publicProcedure
		.route({
			method: "GET",
			path: "/recruitment/posts/{id}",
			tags: ["Recruitment"],
			operationId: "getRecruitmentPost",
			summary: "Get a campus recruitment post",
			description:
				"Returns a single published campus job opening. Anonymous callers receive no contact details; a signed-in caller receives the full contact block. Posts that are not published, or whose deadline has passed, are answered with 404.",
			successDescription: "The campus recruitment post.",
		})
		.input(recruitmentPostDto.getById.input)
		.use(recruitmentReadRateLimit)
		.output(recruitmentPostDto.getById.output)
		.handler(async ({ input, context }) => {
			await assertBoardEnabled();

			return recruitmentService.getById({ id: input.id, viewer: toViewer(context) });
		}),

	create: protectedProcedure
		.route({
			method: "POST",
			path: "/recruitment/posts",
			tags: ["Recruitment"],
			operationId: "createRecruitmentPost",
			summary: "Submit a campus recruitment post",
			description:
				"Submits a campus job opening. At least one of applyUrl and sourceUrl is required, and both must use http or https. The dedupe key is derived server-side from company, role and city: an existing published or pending post for the same opening is answered with 409 and its id, while a rejected one may be submitted again. Lands in pending when review is required. Requires authentication.",
			successDescription: "The id of the created post.",
		})
		.input(recruitmentPostDto.create.input)
		.use(recruitmentSubmissionRateLimit)
		.output(recruitmentPostDto.create.output)
		.handler(async ({ input, context }) => create(input, { id: context.user.id, role: context.user.role })),

	update: protectedProcedure
		.route({
			method: "PATCH",
			path: "/recruitment/posts/{id}",
			tags: ["Recruitment"],
			operationId: "updateRecruitmentPost",
			summary: "Edit one of your campus recruitment posts",
			description:
				"Applies a partial update to a post you submitted. Editing an already published post puts it back into the review queue, so an approval can never be used to publish later edits unchecked. Posts taken down by an administrator cannot be edited. Requires authentication.",
			successDescription: "The id of the updated post.",
		})
		.input(recruitmentPostDto.update.input)
		.output(recruitmentPostDto.update.output)
		.handler(async ({ input, context }) => update(input, { id: context.user.id, role: context.user.role })),

	delete: protectedProcedure
		.route({
			method: "DELETE",
			path: "/recruitment/posts/{id}",
			tags: ["Recruitment"],
			operationId: "deleteRecruitmentPost",
			summary: "Withdraw one of your campus recruitment posts",
			description:
				"Deletes a post you submitted, together with its reports and bookmarks. Applications created from the post survive. A post you do not own is answered with 404. Requires authentication.",
			successDescription: "The post was withdrawn.",
		})
		.input(recruitmentPostDto.delete.input)
		.output(recruitmentPostDto.delete.output)
		.handler(async ({ input, context }) => remove(input, { id: context.user.id, role: context.user.role })),

	mine: protectedProcedure
		.route({
			method: "GET",
			path: "/recruitment/mine",
			tags: ["Recruitment"],
			operationId: "listMyRecruitmentPosts",
			summary: "List your campus recruitment posts",
			description:
				"Returns the caller's own submissions in every moderation state, newest first, including pending and rejected ones together with the rejection reason and the post's report count. Requires authentication.",
			successDescription: "The current page of your posts and the total number of matching posts.",
		})
		.input(recruitmentPostDto.mine.input)
		.output(recruitmentPostDto.mine.output)
		.handler(async ({ input, context }) => mine(input, { id: context.user.id, role: context.user.role })),

	bookmarks: protectedProcedure
		.route({
			method: "GET",
			path: "/recruitment/bookmarks",
			tags: ["Recruitment"],
			operationId: "listMyRecruitmentBookmarks",
			summary: "List your saved campus recruitment posts",
			description:
				"Returns the caller's bookmarked posts, most recently saved first. Expired and taken-down posts are kept on the list and report their real availability. Requires authentication.",
			successDescription: "The current page of bookmarked posts and the total number of bookmarks.",
		})
		.input(recruitmentPostDto.bookmarks.input)
		.output(recruitmentPostDto.bookmarks.output)
		.handler(async ({ input, context }) => bookmarks(input, { id: context.user.id, role: context.user.role })),

	convertToApplication: protectedProcedure
		.route({
			method: "POST",
			path: "/recruitment/posts/{id}/to-application",
			tags: ["Recruitment"],
			operationId: "convertRecruitmentPostToApplication",
			summary: "Track a campus recruitment post as a job application",
			description:
				"Creates a job application in the caller's pipeline from a campus recruitment post, pre-filled with the company, role, city, salary, source and description, in the saved stage. Optionally attaches one of the caller's resumes. The mapping is shared with the web app's pre-filled form. Requires authentication.",
			successDescription: "The id of the created application.",
		})
		.input(recruitmentPostDto.convertToApplication.input)
		.use(recruitmentSubmissionRateLimit)
		.output(recruitmentPostDto.convertToApplication.output)
		.handler(async ({ input, context }) =>
			convertToApplication(input, { id: context.user.id, role: context.user.role }),
		),
};

export { bookmarks, convertToApplication, create, findByDedupeKey, isUniqueViolation, mine, remove, update };
