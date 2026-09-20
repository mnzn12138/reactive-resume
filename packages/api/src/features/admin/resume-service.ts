import type { SQL } from "drizzle-orm";
import type { AuditAction } from "../../audit-actions";
import type { AdminResumeListInput } from "../../dto/admin";
import { ORPCError } from "@orpc/server";
import { and, asc, count, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import { resume, user } from "@reactive-resume/db/schema";
import { notifyResumeUpdated } from "../resume/events";
import { getStorageService } from "../storage";
import { recordAudit } from "./audit";
import { escapeLike } from "./sql";

/**
 * A resume joined with its owner, as selected by `list`.
 *
 * Note what is absent: the resume body (`data`) and the `password` hash. The
 * latter is never selected at all — `hasPassword` is derived inside the query —
 * so a credential column cannot leak through a future refactor of this shape.
 */
type ResumeRow = {
	id: string;
	name: string;
	slug: string;
	tags: string[];
	isPublic: boolean;
	isLocked: boolean;
	hasPassword: boolean;
	createdAt: Date;
	updatedAt: Date;
	ownerId: string;
	ownerName: string;
	ownerEmail: string;
	ownerUsername: string;
};

/**
 * Only the columns the console may return.
 *
 * `data` is left out on purpose: it is large, and the list view never renders
 * it. `password` follows the same rule as the user list — the column stays in
 * the database and only the derived boolean crosses the boundary.
 */
const listColumns = {
	id: resume.id,
	name: resume.name,
	slug: resume.slug,
	tags: resume.tags,
	isPublic: resume.isPublic,
	isLocked: resume.isLocked,
	hasPassword: sql<boolean>`${resume.password} is not null`,
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
	hasPassword: row.hasPassword,
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
	// so it stays out of the audit trail and publishes nothing.
	if (target.isLocked === input.locked) return toAdminResume(target);

	const [updated] = await db
		.update(resume)
		.set({ isLocked: input.locked })
		.where(eq(resume.id, input.id))
		.returning({ updatedAt: resume.updatedAt });

	// The owner may have the builder open right now; without this the lock only
	// becomes visible on their next fetch.
	await notifyResumeUpdated({
		type: "resume.updated",
		resumeId: input.id,
		userId: target.ownerId,
		updatedAt: (updated?.updatedAt ?? target.updatedAt).toISOString(),
		mutation: "lock",
	});

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
 * Best-effort removal of the files a single resume owns.
 *
 * Screenshots and generated PDFs are named after the resume, so nothing else
 * can reference them. Uploaded pictures are **not** touched: they live under
 * the owner's user-level folder and the owner's other resumes may point at the
 * same object, so only the account-deletion path clears those.
 *
 * Failures are logged rather than thrown: the row is already gone, and a
 * storage outage must not make the deletion look like it failed.
 */
async function deleteResumeFiles(ownerId: string, resumeId: string) {
	try {
		const storage = getStorageService();
		await Promise.allSettled([
			storage.delete(`uploads/${ownerId}/screenshots/${resumeId}`),
			storage.delete(`uploads/${ownerId}/pdfs/${resumeId}`),
		]);
	} catch (error) {
		console.error("[admin] failed to remove storage objects for deleted resume", { ownerId, resumeId, error });
	}
}

/**
 * Delete a resume.
 *
 * Deliberately bypasses the owner-facing `RESUME_LOCKED` guard in
 * `resumeService.delete` — an administrator is expected to be able to remove a
 * locked resume, which is often exactly why it is locked. Versions and
 * statistics go with the row via `on delete cascade`.
 */
async function remove(input: { id: string; actorId: string }) {
	const target = await requireResume(input.id);

	await db.delete(resume).where(eq(resume.id, input.id));

	await deleteResumeFiles(target.ownerId, input.id);

	// A resume vanishing from a dashboard that is already open is only visible
	// to the owner if the deletion is broadcast like any other mutation.
	await notifyResumeUpdated({
		type: "resume.updated",
		resumeId: input.id,
		userId: target.ownerId,
		updatedAt: new Date().toISOString(),
		mutation: "delete",
	});

	await recordAudit({
		actorId: input.actorId,
		action: "resume.delete" satisfies AuditAction,
		targetType: "resume",
		targetId: input.id,
		metadata: { name: target.name, slug: target.slug, ownerId: target.ownerId },
	});
}

export const adminResumeService = { list, setLock, remove };
