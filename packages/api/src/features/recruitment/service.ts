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
import type { SQL } from "drizzle-orm";
import type { RecruitmentPostListInput } from "../../dto/recruitment";
import { ORPCError } from "@orpc/client";
import { and, arrayOverlaps, asc, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import { recruitmentPost, recruitmentPostBookmark } from "@reactive-resume/db/schema";
import { escapeLike } from "../admin/sql";
import { availabilityCondition, availabilityOf, daysUntilDeadlineOf, isExpired, notExpiredCondition } from "./expiry";

/**
 * Public reads for the campus recruitment board — endpoints 1 and 2 of §4.3
 * (`plans/46-campus-board-design.md`). T03 adds the write endpoints to this file's siblings.
 *
 * Two rules from §4.4 are enforced here rather than left to the DTO:
 *
 * 1. **Field trimming is explicit.** `publicColumns` names every column the public schema may
 *    see, so `contactValue` / `referralCode` / `reportCount` never even leave the database —
 *    relying on zod to drop them at serialisation time would make a future schema edit a
 *    data leak instead of a type error.
 * 2. **`contact` is cut as a whole object**, not field by field. An anonymous caller gets
 *    `contact: null`, which is what keeps the field *names* out of the response body;
 *    `contact: { value: null }` would put them back in.
 */

/** Who is asking. `null` userId means anonymous; `isAdmin` widens both visibility and fields. */
export type RecruitmentViewer = {
	userId?: string | null;
	isAdmin?: boolean;
};

type PublicPostRow = {
	id: string;
	company: string;
	role: string;
	companyLogoUrl: string | null;
	batch: Batch;
	employmentType: EmploymentType[];
	workMode: WorkMode[];
	workIntensity: WorkIntensity[];
	locations: string[];
	educationRequired: EducationRequired[];
	benefits: Benefit[];
	tags: string[];
	salaryText: string | null;
	deadline: Date | null;
	rolling: boolean;
	applyUrl: string | null;
	source: RecruitmentSource | null;
	sourceUrl: string | null;
	summary: string | null;
	status: PostStatus;
	publishedAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
};

/** The detail read additionally needs ownership and the two private blocks it trims away. */
type DetailPostRow = PublicPostRow & {
	createdBy: string | null;
	contactKind: ContactKind | null;
	contactValue: string | null;
	referralCode: string | null;
	rejectionReason: string | null;
};

/**
 * The allow-list behind rule 1 above: everything `recruitmentPostPublicSchema` declares and
 * nothing else. Adding a column here is a deliberate, reviewable act.
 */
const publicColumns = {
	id: recruitmentPost.id,
	company: recruitmentPost.company,
	role: recruitmentPost.role,
	companyLogoUrl: recruitmentPost.companyLogoUrl,
	batch: recruitmentPost.batch,
	employmentType: recruitmentPost.employmentType,
	workMode: recruitmentPost.workMode,
	workIntensity: recruitmentPost.workIntensity,
	locations: recruitmentPost.locations,
	educationRequired: recruitmentPost.educationRequired,
	benefits: recruitmentPost.benefits,
	tags: recruitmentPost.tags,
	salaryText: recruitmentPost.salaryText,
	deadline: recruitmentPost.deadline,
	rolling: recruitmentPost.rolling,
	applyUrl: recruitmentPost.applyUrl,
	source: recruitmentPost.source,
	sourceUrl: recruitmentPost.sourceUrl,
	summary: recruitmentPost.summary,
	status: recruitmentPost.status,
	publishedAt: recruitmentPost.publishedAt,
	createdAt: recruitmentPost.createdAt,
	updatedAt: recruitmentPost.updatedAt,
} as const;

const detailColumns = {
	...publicColumns,
	createdBy: recruitmentPost.createdBy,
	contactKind: recruitmentPost.contactKind,
	contactValue: recruitmentPost.contactValue,
	referralCode: recruitmentPost.referralCode,
	rejectionReason: recruitmentPost.rejectionReason,
} as const;

/** Map a post row onto the public schema, deriving freshness server-side (§3.6). */
function toPublicPost(row: PublicPostRow, bookmarked: boolean, now: Date) {
	const availability = availabilityOf(row, now);

	return {
		id: row.id,
		company: row.company,
		role: row.role,
		companyLogoUrl: row.companyLogoUrl,
		batch: row.batch,
		employmentType: row.employmentType,
		workMode: row.workMode,
		workIntensity: row.workIntensity,
		locations: row.locations,
		educationRequired: row.educationRequired,
		benefits: row.benefits,
		tags: row.tags,
		salaryText: row.salaryText,
		deadline: row.deadline,
		rolling: row.rolling,
		availability,
		daysUntilDeadline: daysUntilDeadlineOf(row, now),
		applyUrl: row.applyUrl,
		source: row.source,
		sourceUrl: row.sourceUrl,
		summary: row.summary,
		status: row.status,
		publishedAt: row.publishedAt,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		bookmarked,
		// §3.8: `application.recruitment_post_id` is P1, so there is nothing to look up yet.
		// Reserved in the contract, always null here.
		myApplicationId: null,
	};
}

/** Contact is trimmed as one object; the rejection reason only reaches the owner or an admin. */
function toPublicDetail(row: DetailPostRow, viewer: RecruitmentViewer, bookmarked: boolean, now: Date) {
	const isOwner = Boolean(viewer.userId && row.createdBy === viewer.userId);
	const isPrivileged = viewer.isAdmin === true || isOwner;
	// A contact channel is only meaningful as a pair; a half-written row must not be published
	// as a contact with a missing value.
	const hasContact = Boolean(viewer.userId) && row.contactKind !== null && row.contactValue !== null;

	return {
		...toPublicPost(row, bookmarked, now),
		contact: hasContact
			? { kind: row.contactKind as ContactKind, value: row.contactValue as string, referralCode: row.referralCode }
			: null,
		rejectionReason: isPrivileged ? row.rejectionReason : null,
	};
}

/**
 * Which posts on the current page the viewer has bookmarked.
 *
 * One extra query per page rather than a join: the bookmark table is keyed by (user, post) and
 * joining it would have to happen before `limit`, which is where pagination would start
 * lying. Anonymous callers get an empty set — `bookmarked` is always false for them.
 */
async function bookmarkedPostIds(postIds: string[], userId?: string | null): Promise<Set<string>> {
	if (!userId || postIds.length === 0) return new Set<string>();

	const rows = await db
		.select({ postId: recruitmentPostBookmark.postId })
		.from(recruitmentPostBookmark)
		.where(and(eq(recruitmentPostBookmark.userId, userId), inArray(recruitmentPostBookmark.postId, postIds)));

	return new Set(rows.map((row) => row.postId));
}

/**
 * Free-text search. `tags` is an array column, so it is flattened to a string for `ilike`
 * rather than compared element-wise — `array_to_string` keeps the match case-insensitive and
 * cheap enough for a board measured in thousands of rows.
 */
function searchCondition(search: string): SQL | undefined {
	const term = `%${escapeLike(search)}%`;

	return or(
		ilike(recruitmentPost.company, term),
		ilike(recruitmentPost.role, term),
		ilike(recruitmentPost.summary, term),
		sql`array_to_string(${recruitmentPost.tags}, ' ') ilike ${term}`,
	);
}

function buildListFilters(input: RecruitmentPostListInput, now: Date): SQL[] {
	// The public list only ever answers with approved posts; everything else is the review
	// queue's business (§4.3.4).
	const filters: SQL[] = [eq(recruitmentPost.status, "published")];

	if (input.includeExpired !== true) filters.push(notExpiredCondition(now));

	if (input.search) {
		const condition = searchCondition(input.search);
		if (condition) filters.push(condition);
	}

	if (input.role) filters.push(ilike(recruitmentPost.role, `%${escapeLike(input.role)}%`));
	if (input.company) filters.push(ilike(recruitmentPost.company, `%${escapeLike(input.company)}%`));
	if (input.batch) filters.push(eq(recruitmentPost.batch, input.batch));

	// OR within one field, AND across fields (§4.2): `&&` is "shares any element", where
	// `arrayContains` would have meant "has all of these".
	if (input.employmentType?.length)
		filters.push(arrayOverlaps(recruitmentPost.employmentType, [...input.employmentType]));
	if (input.workMode?.length) filters.push(arrayOverlaps(recruitmentPost.workMode, [...input.workMode]));
	if (input.workIntensity?.length) filters.push(arrayOverlaps(recruitmentPost.workIntensity, [...input.workIntensity]));
	if (input.educationRequired?.length) {
		filters.push(arrayOverlaps(recruitmentPost.educationRequired, [...input.educationRequired]));
	}
	if (input.benefits?.length) filters.push(arrayOverlaps(recruitmentPost.benefits, [...input.benefits]));
	if (input.locations?.length) filters.push(arrayOverlaps(recruitmentPost.locations, [...input.locations]));
	if (input.tags?.length) filters.push(arrayOverlaps(recruitmentPost.tags, [...input.tags]));
	if (input.availability) filters.push(availabilityCondition(input.availability, now));

	return filters;
}

/**
 * Ordering. `deadline` gets an explicit `nulls last` because Postgres defaults to NULLS FIRST
 * on `desc`, which would float every rolling post to the top of a "closing soonest" sort. `id`
 * is the tiebreaker so paging through equal keys cannot show the same row twice.
 */
function buildListOrderBy(input: RecruitmentPostListInput): SQL[] {
	const direction = input.sortOrder === "asc" ? "asc" : "desc";

	if (input.sortBy === "deadline") {
		return [sql`${recruitmentPost.deadline} ${sql.raw(direction)} nulls last`, asc(recruitmentPost.id)];
	}

	const column = input.sortBy === "createdAt" ? recruitmentPost.createdAt : recruitmentPost.publishedAt;

	return [direction === "asc" ? asc(column) : desc(column), asc(recruitmentPost.id)];
}

/**
 * Whether the caller may see this row at all — §4.3.5.
 *
 * An administrator sees everything; a submitter sees their own post in any state (a superset of
 * the table's second row, so an author can still open a post they submitted that has since
 * expired). Everyone else sees a post only while it is published and not yet expired; a
 * pending, rejected, closed or expired post is answered with 404 rather than 403, so the
 * endpoint never confirms that a hidden post exists.
 */
function canViewPost(row: DetailPostRow, viewer: RecruitmentViewer, now: Date): boolean {
	if (viewer.isAdmin === true) return true;
	if (viewer.userId && row.createdBy === viewer.userId) return true;

	return row.status === "published" && !isExpired(row, now);
}

async function list(input: RecruitmentPostListInput & { viewer?: RecruitmentViewer }) {
	const now = new Date();
	const where = and(...buildListFilters(input, now));

	// Two SELECTs sharing one WHERE (appendix B.1): `total` is the size of the *filtered* set,
	// not of this page — the fix for the paginator that always showed one page.
	//
	// The row type is whatever drizzle infers from `publicColumns`; it is passed to
	// `toPublicPost`, which wants a `PublicPostRow`. That assignment only compiles because the
	// array columns are declared `.$type<X>()` (element type) in
	// `packages/db/src/schema/recruitment.ts` — with `.$type<X[]>()` drizzle adds a second
	// dimension and the row stops matching. Keep it as an assignment, not a cast, so the schema
	// and this type cannot drift apart silently.
	const [rows, totals] = await Promise.all([
		db
			.select(publicColumns)
			.from(recruitmentPost)
			.where(where)
			.orderBy(...buildListOrderBy(input))
			.limit(input.limit)
			.offset(input.offset),
		db.select({ value: count() }).from(recruitmentPost).where(where),
	]);

	const bookmarked = await bookmarkedPostIds(
		rows.map((row) => row.id),
		input.viewer?.userId,
	);

	return {
		items: rows.map((row) => toPublicPost(row, bookmarked.has(row.id), now)),
		total: Number(totals?.at(0)?.value ?? 0),
	};
}

async function getById(input: { id: string; viewer?: RecruitmentViewer }) {
	const now = new Date();
	const viewer: RecruitmentViewer = input.viewer ?? {};

	// Same deliberate non-cast as in `list`; see the note there.
	const [row] = await db.select(detailColumns).from(recruitmentPost).where(eq(recruitmentPost.id, input.id)).limit(1);

	if (!row) throw new ORPCError("NOT_FOUND", { message: "Recruitment post not found." });
	if (!canViewPost(row, viewer, now)) throw new ORPCError("NOT_FOUND", { message: "Recruitment post not found." });

	const bookmarked = await bookmarkedPostIds([row.id], viewer.userId);

	return toPublicDetail(row, viewer, bookmarked.has(row.id), now);
}

export const recruitmentService = {
	list,
	getById,
};

export type RecruitmentPostPublicView = ReturnType<typeof toPublicPost>;
export type RecruitmentPostDetailView = ReturnType<typeof toPublicDetail>;
