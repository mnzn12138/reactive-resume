import type {
	Batch,
	Benefit,
	ContactKind,
	EducationRequired,
	EmploymentType,
	PostStatus,
	RecruitmentSource,
	ReportReason,
	WorkIntensity,
	WorkMode,
} from "@reactive-resume/schema/recruitment/data";
import * as pg from "drizzle-orm/pg-core";
import { generateId } from "@reactive-resume/utils/string";
import { user } from "./auth";

/**
 * The campus recruitment board (`/jobs`): three tables, mirroring
 * `plans/46-campus-board-design.md` §3.2~§3.5.
 *
 * The board is off by default (`recruitmentBoardEnabled`), so these tables stay empty on an
 * instance that never turns it on — they cost nothing until then.
 *
 * Enum-typed columns stay `text` (the repo convention, see `application.status`): a new
 * value then lands without a migration, and the zod schema in `packages/schema` is the only
 * place that has to know about it.
 */

/** One job opening, submitted by a user or entered by an administrator. */
export const recruitmentPost = pg.pgTable(
	"recruitment_post",
	{
		id: pg
			.text("id")
			.notNull()
			.$defaultFn(() => generateId()),
		// set null, not cascade: deleting an account must not delete the openings it posted.
		createdBy: pg.text("created_by").references(() => user.id, { onDelete: "set null" }),
		company: pg.text("company").notNull(),
		role: pg.text("role").notNull(),
		// Never rendered as a raw third-party <img> — a remote logo leaks every visitor's IP
		// to that third party. The web app falls back to a monogram.
		companyLogoUrl: pg.text("company_logo_url"),
		batch: pg.text("batch").$type<Batch>().notNull().default("regular"),
		// `.$type<X>()`, not `.$type<X[]>()`: drizzle 1.0.0-rc.4 applies the `$type` *after*
		// `.array()` has added its own dimension, so `.$type<X[]>()` resolves the column to
		// `X[][]` — one level too deep, which makes every `arrayOverlaps()` overload unusable
		// and poisons the row type of any `db.select()` that names the column. Declaring the
		// *element* type is what the builder expects: it re-adds the array dimension itself.
		// Verified: the inferred type of these columns is `X[]` and both `db.select()` row
		// types and `arrayOverlaps()` resolve correctly (see the T03 report).
		employmentType: pg.text("employment_type").array().$type<EmploymentType>().notNull().default([]),
		workMode: pg.text("work_mode").array().$type<WorkMode>().notNull().default([]),
		workIntensity: pg.text("work_intensity").array().$type<WorkIntensity>().notNull().default([]),
		locations: pg.text("locations").array().notNull().default([]),
		educationRequired: pg.text("education_required").array().$type<EducationRequired>().notNull().default([]),
		benefits: pg.text("benefits").array().$type<Benefit>().notNull().default([]),
		tags: pg.text("tags").array().notNull().default([]),
		// Campus salaries are ranges or 面议; structuring them would lose more than it gains.
		salaryText: pg.text("salary_text"),
		deadline: pg.timestamp("deadline", { withTimezone: true }),
		rolling: pg.boolean("rolling").notNull().default(false),
		applyUrl: pg.text("apply_url"),
		contactKind: pg.text("contact_kind").$type<ContactKind>(),
		// Never part of a public response: the public schema has no such field at all.
		contactValue: pg.text("contact_value"),
		referralCode: pg.text("referral_code"),
		summary: pg.text("summary"),
		source: pg.text("source").$type<RecruitmentSource>(),
		sourceUrl: pg.text("source_url"),
		// Server-generated (see `packages/schema/src/recruitment/dedupe.ts`); UNIQUE below is
		// what actually prevents a duplicate opening.
		dedupeKey: pg.text("dedupe_key").notNull(),
		status: pg.text("status").$type<PostStatus>().notNull().default("pending"),
		rejectionReason: pg.text("rejection_reason"),
		reviewedBy: pg.text("reviewed_by").references(() => user.id, { onDelete: "set null" }),
		reviewedAt: pg.timestamp("reviewed_at", { withTimezone: true }),
		// Sort key for the public list; null while a post is still in review.
		publishedAt: pg.timestamp("published_at", { withTimezone: true }),
		// Admin-only: showing it publicly would turn reports into a weapon.
		reportCount: pg.integer("report_count").notNull().default(0),
		createdAt: pg.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: pg
			.timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => /* @__PURE__ */ new Date()),
	},
	(t) => [
		// Explicit constraint names (rather than drizzle's defaults) so the Alembic path and
		// this one produce identically named *primary keys, unique constraints and indexes*
		// — see §6.4 / §6.7 of the design.
		//
		// Foreign keys are the exception, and deliberately so: §6.4 asks the Alembic side to
		// follow its own `NAMING_CONVENTION` (`fk_<table>_<column>_<reftable>`) instead of
		// copying what Drizzle emits below (`recruitment_post_created_by_user_id_fkey`),
		// because reconciling the two styles makes autogenerate flag a diff on every run.
		// The two paths therefore disagree on FK names while agreeing on every column, index
		// and (non-FK) constraint. Nothing here depends on an FK name at runtime, but a
		// future `op.drop_constraint(...)` has to pick the name belonging to the path that
		// created the database it is running against.
		pg.primaryKey({ columns: [t.id], name: "pk_recruitment_post" }),
		pg.uniqueIndex("uq_recruitment_post_dedupe_key").on(t.dedupeKey),
		// The main read path: "published, newest first".
		pg.index("ix_recruitment_post_status_published_at").on(t.status, t.publishedAt.desc()),
		// Freshness filtering and `deadline asc` sorting.
		pg.index("ix_recruitment_post_deadline").on(t.deadline),
		// GIN, not B-tree: an array equality/overlap predicate cannot use a B-tree index.
		pg.index("ix_recruitment_post_tags").using("gin", t.tags),
		pg.index("ix_recruitment_post_locations").using("gin", t.locations),
		// "My submissions".
		pg.index("ix_recruitment_post_created_by").on(t.createdBy),
		// Review queue sorted by how contested a post is.
		pg.index("ix_recruitment_post_status_report_count").on(t.status, t.reportCount.desc()),
	],
);

/**
 * One report about one post.
 *
 * A separate table rather than a counter because "who flagged what, when and why" is not
 * expressible as a number, and the admin queue needs all four.
 */
export const recruitmentPostReport = pg.pgTable(
	"recruitment_post_report",
	{
		id: pg
			.text("id")
			.notNull()
			.$defaultFn(() => generateId()),
		// cascade: a deleted post takes its reports with it.
		postId: pg
			.text("post_id")
			.notNull()
			.references(() => recruitmentPost.id, { onDelete: "cascade" }),
		reporterId: pg
			.text("reporter_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		reason: pg.text("reason").$type<ReportReason>().notNull(),
		detail: pg.text("detail"),
		handled: pg.boolean("handled").notNull().default(false),
		// set null + a nullable timestamp: without a handler, `handled = true` is unattributable.
		handledBy: pg.text("handled_by").references(() => user.id, { onDelete: "set null" }),
		handledAt: pg.timestamp("handled_at", { withTimezone: true }),
		createdAt: pg.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		pg.primaryKey({ columns: [t.id], name: "pk_recruitment_post_report" }),
		// One person may flag a given post once — enforced by the database, not by the handler.
		pg.uniqueIndex("uq_recruitment_post_report_post_id_reporter_id").on(t.postId, t.reporterId),
		pg.index("ix_recruitment_post_report_post_id").on(t.postId),
		// The report queue: unhandled first, newest first.
		pg.index("ix_recruitment_post_report_handled_created_at").on(t.handled, t.createdAt.desc()),
	],
);

/**
 * One user's saved post.
 *
 * Composite primary key, which makes "bookmark" idempotent: a repeated PUT is a no-op
 * instead of a duplicate row or an error.
 */
export const recruitmentPostBookmark = pg.pgTable(
	"recruitment_post_bookmark",
	{
		userId: pg
			.text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		postId: pg
			.text("post_id")
			.notNull()
			.references(() => recruitmentPost.id, { onDelete: "cascade" }),
		createdAt: pg.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		pg.primaryKey({ columns: [t.userId, t.postId], name: "pk_recruitment_post_bookmark" }),
		// Cascading deletes and "how many people saved this".
		pg.index("ix_recruitment_post_bookmark_post_id").on(t.postId),
	],
);
