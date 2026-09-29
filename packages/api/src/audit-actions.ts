/**
 * Action names and target types recorded in `admin_audit_log`.
 *
 * Kept as plain string unions rather than a DB enum so a new action can land
 * without another migration. The `dotted.verb` naming keeps the log greppable.
 */
export const AUDIT_ACTIONS = [
	"user.role.set",
	"user.ban.set",
	"user.ban.lift",
	"user.delete",
	"resume.lock.set",
	"resume.delete",
	"instance.setting.set",
	"recruitment.post.approve",
	"recruitment.post.reject",
	"recruitment.post.close",
	"recruitment.post.delete",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_TARGET_TYPES = ["user", "resume", "instance", "recruitment_post"] as const;

export type AuditTargetType = (typeof AUDIT_TARGET_TYPES)[number];
