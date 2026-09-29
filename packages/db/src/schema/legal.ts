import type { LegalDocument } from "@reactive-resume/schema/legal";
import * as pg from "drizzle-orm/pg-core";
import { generateId } from "@reactive-resume/utils/string";
import { user } from "./auth";

/**
 * Append-only ledger of which legal texts a user accepted, and when.
 *
 * One row per `(userId, document, version)`. Accepting a **new** version appends
 * a row rather than mutating the old one, so the history of what a user agreed
 * to — and under which wording — stays auditable. There is deliberately no
 * `updatedAt` (same as `adminAuditLog`): a consent record is a fact, not a
 * mutable field.
 *
 * This is the per-user counterpart to `adminAuditLog`. That table trails
 * privileged *admin* actions and is not a consent ledger, so consent does not
 * belong there.
 */
export const userConsent = pg.pgTable(
	"user_consent",
	{
		id: pg
			.text("id")
			.notNull()
			.primaryKey()
			.$defaultFn(() => generateId()),
		// `cascade` where `adminAuditLog` uses `set null`, on purpose: consent is the
		// user's own personal data, so it has to die with the account. Erasing the
		// account is what actually satisfies a deletion request — keeping an
		// orphaned row would leave the instance holding personal data it can no
		// longer attribute to a data subject.
		userId: pg
			.text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		// Which document was accepted ("privacy" / "terms"). Text rather than a pg
		// enum so a new document ships without another migration — see
		// `application.status` for the same convention.
		document: pg.text("document").notNull().$type<LegalDocument>(),
		// Version of the document at the time of acceptance, from
		// `legalDocumentVersion` in `@reactive-resume/schema/legal`.
		version: pg.text("version").notNull(),
		// How the acceptance was collected, e.g. "signup-email" / "manual". Free text
		// so a new surface can be added without another migration. Nullable because
		// an account created by a path we cannot gate (a social redirect) has no row
		// to attribute and must not get one.
		source: pg.text("source"),
		// Proof-of-consent context. Both fields are optional: a request without a
		// resolvable client IP still records the acceptance itself.
		metadata: pg.jsonb("metadata").$type<{ ip?: string; userAgent?: string }>(),
		createdAt: pg.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		// Makes re-accepting the *same* version idempotent while a version bump
		// appends a new row, which is exactly the append-only behaviour above.
		pg.uniqueIndex().on(t.userId, t.document, t.version),
		// Answers "what has this user accepted, newest first" — the query a deletion
		// or compliance export runs.
		pg.index().on(t.userId, t.createdAt.desc()),
	],
);
