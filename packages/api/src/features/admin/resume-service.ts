import type { SQL } from "drizzle-orm";
import type { AdminResumeListInput } from "../../dto/admin";
import type { AuditAction } from "./actions";
import { ORPCError } from "@orpc/server";
import { and, asc, count, desc, eq, ilike, or } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import { resume, user } from "@reactive-resume/db/schema";
import { recordAudit } from "./audit";
import { escapeLike } from "./sql";

/**
 * A resume joined with its owner, as selected by `list`.
 *
 * `password` is read only to derive `hasPassword`; `toAdminResume` drops it so
 * the stored hash never reaches an API response.
 */
type ResumeRow = {
	id: string;
	name: string;
	slug: string;
	tags: string[];
	isPublic: boolean;
	isLocked: boolean;
	password: string | null;
	createdAt: Date;
	updatedAt: Date;
	ownerId: string;
	ownerName: string;
	ownerEmail: string;
	ownerUsername: string;
};

/**
 * Only the columns the console may return. The resume body (`data`) is left out
 * on purpose: it is large, and the list view never renders it.
 */
const listColumns = {
	id: resume.id,
	name: resume.name,
	slug: resume.slug,
	tags: resume.tags,
	isPublic: resume.isPublic,
	isLocked: resume.isLocked,
	password: resume.password,
	createdAt: resume.createdAt,
	updatedAt: resume.updatedAt,
	ownerId: user.id,
	ownerName: user.name,
	ownerEmail: user.email,
	ownerUsername: user.username,
};

/** Collapse the joined row into the nested shape the DTO promises. */
const toAdminResume = (row: ResumeRow) => ({
	id: row.id,
	name: row.name,
	slug: row.slug,
	tags: row.tags,
	isPublic: row.isPublic,
	isLocked: row.isLocked,
	hasPassword: row.password !== null,
	owner: { id: row.ownerId, name: row.ownerName, email: row.ownerEmail, username: row.ownerUsername },
	createdAt: row.createdAt,
	updatedAt: row.updatedAt,
});

const sortColumnByField = {
	createdAt: resume.createdAt,
	updatedAt: resume.updatedAt,
	name: resume.name,
} as const;

/**
 * Look a resume up together with its owner.
 *
 * The list columns are reused here rather than selected twice so that every
 * endpoint returns the same shape, and the join is an inner one: a resume
 * cannot outlive its owner (`user_id` is `on delete cascade`).
 */
async function findResume(id: string): Promise<ResumeRow | undefined> {
	const [row] = await db
		.select(listColumns)
		.from(resume)
		.innerJoin(user, eq(resume.userId, user.id))
		.where(eq(resume.id, id));

	return row;
}

async function requireResume(id: string) {
	const row = await findResume(id);
	if (!row) throw new ORPCError("NOT_FOUND", { message: "Resume not found." });
	return row;
}

async function list(input: AdminResumeListInput) {
	const filters: SQL[] = [];

	if (input.search) {
		const term = `%${escapeLike(input.search)}%`;
		const searchFilter = or(
			ilike(resume.name, term),
			ilike(resume.slug, term),
			ilike(user.name, term),
			ilike(user.email, term),
			ilike(user.username, term),
		);
		if (searchFilter) filters.push(searchFilter);
	}
	if (input.isPublic !== undefined) filters.push(eq(resume.isPublic, input.isPublic));
	if (input.isLocked !== undefined) filters.push(eq(resume.isLocked, input.isLocked));

	const where = filters.length ? and(...filters) : undefined;

	const sortColumn = sortColumnByField[input.sortBy];
	const orderBy = input.sortOrder === "asc" ? asc(sortColumn) : desc(sortColumn);

	const [items, totals] = await Promise.all([
		db
			.select(listColumns)
			.from(resume)
			.innerJoin(user, eq(resume.userId, user.id))
			.where(where)
			.orderBy(orderBy)
			.limit(input.limit)
			.offset(input.offset),
		db.select({ value: count() }).from(resume).innerJoin(user, eq(resume.userId, user.id)).where(where),
	]);

	return {
		items: items.map(toAdminResume),
		// The count query returns rows rather than a number under the current
		// dependency tree, so it is unwrapped and coerced here.
		total: Number(totals?.at(0)?.value ?? 0),
	};
}

async function setLock(input: { id: string; locked: boolean; actorId: string }) {
	const target = await requireResume(input.id);

	// Locking an already-locked resume (or unlocking an unlocked one) is a no-op,
	// so it stays out of the audit trail.
	if (target.isLocked === input.locked) return toAdminResume(target);

	await db.update(resume).set({ isLocked: input.locked }).where(eq(resume.id, input.id));

	await recordAudit({
		actorId: input.actorId,
		action: "resume.lock.set" satisfies AuditAction,
		targetType: "resume",
		targetId: input.id,
		metadata: { from: target.isLocked, to: input.locked, name: target.name, ownerId: target.ownerId },
	});

	return toAdminResume({ ...target, isLocked: input.locked });
}

/**
 * Delete a resume.
 *
 * Uploaded images are **not** touched: they live under `uploads/<userId>/` and
 * the owner's other resumes may reference the same object, so only the account
 * deletion path clears storage. Versions and statistics go with the row via
 * `on delete cascade`.
 */
async function remove(input: { id: string; actorId: string }) {
	const target = await requireResume(input.id);

	await db.delete(resume).where(eq(resume.id, input.id));

	await recordAudit({
		actorId: input.actorId,
		action: "resume.delete" satisfies AuditAction,
		targetType: "resume",
		targetId: input.id,
		metadata: { name: target.name, slug: target.slug, ownerId: target.ownerId },
	});
}

export const adminResumeService = { list, setLock, remove };
