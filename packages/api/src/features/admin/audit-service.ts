import type { SQL } from "drizzle-orm";
import type { AdminAuditListInput } from "../../dto/admin";
import { and, count, desc, eq, ilike, or } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import { adminAuditLog, user } from "@reactive-resume/db/schema";
import { escapeLike } from "./sql";

/**
 * A log entry joined with whoever performed it.
 *
 * `actorId` is `on delete set null`, so the join is a **left** join and the
 * actor fields come back nullable: deleting an administrator must erase neither
 * the history nor the admin's ability to read it.
 */
type AuditRow = {
	id: string;
	action: string;
	targetType: string;
	targetId: string | null;
	metadata: unknown;
	createdAt: Date;
	actorId: string | null;
	actorName: string | null;
	actorEmail: string | null;
};

const listColumns = {
	id: adminAuditLog.id,
	action: adminAuditLog.action,
	targetType: adminAuditLog.targetType,
	targetId: adminAuditLog.targetId,
	metadata: adminAuditLog.metadata,
	createdAt: adminAuditLog.createdAt,
	actorId: user.id,
	actorName: user.name,
	actorEmail: user.email,
};

/** jsonb is untyped; anything that is not a plain object is reported as "no details". */
const toMetadata = (value: unknown): Record<string, unknown> | null =>
	value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const toAdminAuditEntry = (row: AuditRow) => ({
	id: row.id,
	action: row.action,
	targetType: row.targetType,
	targetId: row.targetId,
	metadata: toMetadata(row.metadata),
	createdAt: row.createdAt,
	actor:
		row.actorId && row.actorName !== null && row.actorEmail !== null
			? { id: row.actorId, name: row.actorName, email: row.actorEmail }
			: null,
});

/** Entries are always read newest first: the auditor's question is "what just happened". */
async function list(input: AdminAuditListInput) {
	const filters: SQL[] = [];

	if (input.action) filters.push(eq(adminAuditLog.action, input.action));
	if (input.targetType) filters.push(eq(adminAuditLog.targetType, input.targetType));
	if (input.search) {
		const term = `%${escapeLike(input.search)}%`;
		const searchFilter = or(ilike(user.name, term), ilike(user.email, term), ilike(adminAuditLog.targetId, term));
		if (searchFilter) filters.push(searchFilter);
	}

	const where = filters.length ? and(...filters) : undefined;

	const [items, totals] = await Promise.all([
		db
			.select(listColumns)
			.from(adminAuditLog)
			.leftJoin(user, eq(adminAuditLog.actorId, user.id))
			.where(where)
			.orderBy(desc(adminAuditLog.createdAt))
			.limit(input.limit)
			.offset(input.offset),
		db.select({ value: count() }).from(adminAuditLog).leftJoin(user, eq(adminAuditLog.actorId, user.id)).where(where),
	]);

	return {
		items: items.map(toAdminAuditEntry),
		total: Number(totals?.at(0)?.value ?? 0),
	};
}

export const adminAuditService = { list };
