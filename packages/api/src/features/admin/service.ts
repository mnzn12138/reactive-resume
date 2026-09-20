import type { SQL } from "drizzle-orm";
import type { AuditAction } from "../../audit-actions";
import type { AdminUserListInput } from "../../dto/admin";
import { ORPCError } from "@orpc/server";
import { and, asc, count, desc, eq, ilike, or } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import { application, resume, session, user } from "@reactive-resume/db/schema";
import { assertUserRole, parseUserRole } from "../../roles";
import { getStorageService } from "../storage";
import { recordAudit } from "./audit";
import { escapeLike } from "./sql";

// Only columns the console is allowed to return — never credentials.
const listColumns = {
	id: user.id,
	name: user.name,
	email: user.email,
	username: user.username,
	image: user.image,
	role: user.role,
	emailVerified: user.emailVerified,
	twoFactorEnabled: user.twoFactorEnabled,
	banned: user.banned,
	banReason: user.banReason,
	banExpires: user.banExpires,
	lastActiveAt: user.lastActiveAt,
	createdAt: user.createdAt,
	updatedAt: user.updatedAt,
};

/** `role` is unconstrained text; anything unrecognised is presented as a plain user. */
const normaliseRole = (value: string | null) => parseUserRole(value) ?? "user";

/**
 * Shape a raw `user` row for the console.
 *
 * `banned` only ever has a default, not a NOT NULL constraint, so the driver
 * hands back `boolean | null`; the column is treated as false when unset so the
 * API contract stays a plain boolean.
 */
const toAdminUser = <TRow extends { role: string | null; banned: boolean | null }>(row: TRow) => ({
	...row,
	role: normaliseRole(row.role),
	banned: row.banned ?? false,
});

const sortColumnByField = {
	createdAt: user.createdAt,
	lastActiveAt: user.lastActiveAt,
	email: user.email,
	name: user.name,
} as const;

async function requireUser(id: string) {
	const [row] = await db.select().from(user).where(eq(user.id, id));
	if (!row) throw new ORPCError("NOT_FOUND", { message: "User not found." });
	return row;
}

/** Count rows in `table` owned by `targetId`. The count query returns rows, so the first one is unwrapped here. */
async function countOwnedRows(
	table: typeof resume | typeof application,
	ownerColumn: typeof resume.userId | typeof application.userId,
	targetId: string,
): Promise<number> {
	const [row] = await db.select({ value: count() }).from(table).where(eq(ownerColumn, targetId));
	return Number(row?.value ?? 0);
}

async function countOwned(targetId: string) {
	const [resumes, applications] = await Promise.all([
		countOwnedRows(resume, resume.userId, targetId),
		countOwnedRows(application, application.userId, targetId),
	]);

	return { resumes, applications };
}

async function list(input: AdminUserListInput) {
	const filters: SQL[] = [];

	if (input.search) {
		const term = `%${escapeLike(input.search)}%`;
		const searchFilter = or(ilike(user.email, term), ilike(user.name, term), ilike(user.username, term));
		if (searchFilter) filters.push(searchFilter);
	}
	if (input.role) filters.push(eq(user.role, input.role));
	if (input.banned !== undefined) filters.push(eq(user.banned, input.banned));

	const where = filters.length ? and(...filters) : undefined;

	const sortColumn = sortColumnByField[input.sortBy];
	const orderBy = input.sortOrder === "asc" ? asc(sortColumn) : desc(sortColumn);

	const [items, totals] = await Promise.all([
		db.select(listColumns).from(user).where(where).orderBy(orderBy).limit(input.limit).offset(input.offset),
		db.select({ value: count() }).from(user).where(where),
	]);

	return {
		items: items.map(toAdminUser),
		total: Number(totals?.at(0)?.value ?? 0),
	};
}

async function getById(input: { id: string }) {
	const row = await requireUser(input.id);

	// The `user` table holds no credentials (passwords live in `account`), so
	// the row is safe to return as-is once the role is normalised.
	return {
		...toAdminUser(row),
		stats: await countOwned(input.id),
	};
}

async function setRole(input: { id: string; role: string; actorId: string }) {
	let role: "user" | "admin";
	try {
		role = assertUserRole(input.role);
	} catch (error) {
		throw new ORPCError("BAD_REQUEST", { message: (error as Error).message });
	}

	if (input.id === input.actorId && role !== "admin") {
		// Otherwise an admin can lock themselves out of the console entirely.
		throw new ORPCError("FORBIDDEN", { message: "You cannot remove your own administrator role." });
	}

	const target = await requireUser(input.id);
	const previous = normaliseRole(target.role);
	if (previous === role) return toAdminUser(target);

	const [updated] = await db.update(user).set({ role }).where(eq(user.id, input.id)).returning();
	if (!updated) throw new ORPCError("NOT_FOUND", { message: "User not found." });

	await recordAudit({
		actorId: input.actorId,
		action: "user.role.set" satisfies AuditAction,
		targetType: "user",
		targetId: input.id,
		metadata: { from: previous, to: role },
	});

	return toAdminUser(updated);
}

async function setBan(input: {
	id: string;
	banned: boolean;
	reason?: string | undefined;
	expiresAt?: Date | undefined;
	actorId: string;
}) {
	if (input.id === input.actorId) {
		throw new ORPCError("FORBIDDEN", { message: "You cannot ban yourself." });
	}

	// Still fetched so a ban against a missing account 404s instead of silently
	// writing an audit entry for nobody.
	await requireUser(input.id);

	const [updated] = await db
		.update(user)
		.set(
			input.banned
				? { banned: true, banReason: input.reason ?? null, banExpires: input.expiresAt ?? null }
				: { banned: false, banReason: null, banExpires: null },
		)
		.where(eq(user.id, input.id))
		.returning();
	if (!updated) throw new ORPCError("NOT_FOUND", { message: "User not found." });

	if (input.banned) {
		// A ban that only takes effect when the session expires is no ban at all,
		// so every existing session is dropped here.
		await db.delete(session).where(eq(session.userId, input.id));
	}

	await recordAudit({
		actorId: input.actorId,
		action: (input.banned ? "user.ban.set" : "user.ban.lift") satisfies AuditAction,
		targetType: "user",
		targetId: input.id,
		metadata: {
			...(input.reason ? { reason: input.reason } : {}),
			...(input.expiresAt ? { expiresAt: input.expiresAt.toISOString() } : {}),
		},
	});

	return toAdminUser(updated);
}

/**
 * Best-effort removal of everything the user uploaded.
 *
 * Objects live outside the database under `uploads/<userId>/`, so deleting the
 * row would otherwise orphan them. Failures are logged, not thrown: a storage
 * outage should not leave a half-deleted account.
 */
async function deleteStorageObjects(targetId: string) {
	try {
		const keys = await getStorageService().list(`uploads/${targetId}/`);
		await Promise.all(keys.map((key) => getStorageService().delete(key)));
	} catch (error) {
		console.error("[admin] failed to remove storage objects for deleted user", { targetId, error });
	}
}

async function remove(input: { id: string; actorId: string }) {
	if (input.id === input.actorId) {
		throw new ORPCError("FORBIDDEN", { message: "You cannot delete your own account." });
	}

	const target = await requireUser(input.id);

	// Losing the last administrator would strand the console with no way back in.
	if (normaliseRole(target.role) === "admin") {
		const [admins] = await db.select({ value: count() }).from(user).where(eq(user.role, "admin"));
		if (Number(admins?.value ?? 0) <= 1) {
			throw new ORPCError("FORBIDDEN", { message: "This is the last administrator and cannot be deleted." });
		}
	}

	await deleteStorageObjects(input.id);

	// Every table referencing `user.id` is `on delete cascade`, so this also
	// clears sessions, resumes, applications and OAuth grants.
	await db.delete(user).where(eq(user.id, input.id));

	await recordAudit({
		actorId: input.actorId,
		action: "user.delete" satisfies AuditAction,
		targetType: "user",
		targetId: input.id,
		metadata: { email: target.email, username: target.username },
	});
}

export const adminUserService = { list, getById, setRole, setBan, remove };
