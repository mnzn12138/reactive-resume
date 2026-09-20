import type { AuditAction, AuditTargetType } from "../../audit-actions";
import { db } from "@reactive-resume/db/client";
import { adminAuditLog } from "@reactive-resume/db/schema";

export type AuditEntry = {
	actorId: string;
	action: AuditAction;
	targetType: AuditTargetType;
	targetId: string;
	metadata?: Record<string, unknown> | undefined;
};

/**
 * Append one entry to the admin audit trail.
 *
 * Only write actions are recorded. The insert is **best effort**: a failure is
 * logged but never thrown, because losing an audit line must not make an
 * admin's ban or deletion fail. The error is still surfaced via `console.error`
 * so it stays observable rather than being silently swallowed.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
	try {
		await db.insert(adminAuditLog).values({
			actorId: entry.actorId,
			action: entry.action,
			targetType: entry.targetType,
			targetId: entry.targetId,
			...(entry.metadata ? { metadata: entry.metadata } : {}),
		});
	} catch (error) {
		console.error("[admin] failed to write audit log", {
			action: entry.action,
			targetType: entry.targetType,
			targetId: entry.targetId,
			error,
		});
	}
}
