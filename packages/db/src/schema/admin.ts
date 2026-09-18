import * as pg from "drizzle-orm/pg-core";
import { generateId } from "@reactive-resume/utils/string";
import { user } from "./auth";

/**
 * Append-only trail of privileged actions performed in the admin console.
 *
 * Only **write** actions are recorded (role changes, bans, deletions, setting
 * overrides). Reads are deliberately excluded so the table stays small and the
 * log stays meaningful.
 *
 * `actorId` uses `set null` rather than `cascade`: deleting an admin must not
 * erase the history of what they did.
 */
export const adminAuditLog = pg.pgTable(
	"admin_audit_log",
	{
		id: pg
			.text("id")
			.notNull()
			.primaryKey()
			.$defaultFn(() => generateId()),
		actorId: pg.text("actor_id").references(() => user.id, { onDelete: "set null" }),
		// Dotted action name, e.g. "user.role.set" / "resume.delete". Text rather
		// than an enum so new actions can land without another migration.
		action: pg.text("action").notNull(),
		targetType: pg.text("target_type").notNull(),
		targetId: pg.text("target_id"),
		// Free-form context (old vs new value, ban reason, etc.). Shape varies per
		// action, so it is untyped jsonb.
		metadata: pg.jsonb("metadata"),
		createdAt: pg.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		pg.index().on(t.createdAt.desc()),
		pg.index().on(t.targetType, t.targetId),
		pg.index().on(t.actorId, t.createdAt.desc()),
	],
);

/**
 * Runtime overrides for instance-wide feature flags.
 *
 * Precedence is `DB row > environment variable > default`. A key that has never
 * been written here means "no override", so a self-hosted instance behaves
 * exactly as it does today until an admin explicitly changes something.
 */
export const instanceSetting = pg.pgTable(
	"instance_setting",
	{
		key: pg.text("key").notNull().primaryKey(),
		// Stored as jsonb so a flag can later become a number or list without a
		// schema change; boolean flags are read back through the service layer.
		value: pg.jsonb("value").notNull(),
		updatedBy: pg.text("updated_by").references(() => user.id, { onDelete: "set null" }),
		createdAt: pg.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: pg
			.timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date()),
	},
	(t) => [pg.index().on(t.updatedAt.desc())],
);
