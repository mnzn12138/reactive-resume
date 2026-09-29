import * as pg from "drizzle-orm/pg-core";
import { generateId } from "@reactive-resume/utils/string";

/**
 * Append-only trail of every outbound verification SMS.
 *
 * It serves two purposes at once. Operationally it backs the rate limits the
 * `phoneNumber` plugin does not cover (60s cooldown per number, 10 per number
 * per day, 20 per IP per hour) by counting rows in a window. For compliance it
 * is the audit record of what was sent to whom and with which outcome, which is
 * why it stores **hashes** of the phone number and the client IP rather than the
 * values themselves: the counts and the evidence survive, the personal data does
 * not have to.
 *
 * Rows are never updated — a retry is a new row — and `vendor_code` is kept
 * verbatim so an operator can look a failure up in the vendor's console.
 */
export const smsSendLog = pg.pgTable(
	"sms_send_log",
	{
		id: pg
			.text("id")
			.notNull()
			.primaryKey()
			.$defaultFn(() => generateId()),
		// SHA-256 (hex) of the normalised E.164 number. Deterministic so the same
		// number maps to the same hash and the per-number windows are countable.
		phoneHash: pg.text("phone_hash").notNull(),
		// SHA-256 (hex) of the client IP, when one could be resolved. Null for a
		// request behind a proxy that supplied no usable header.
		ipHash: pg.text("ip_hash"),
		// Which driver sent it, e.g. "aliyun" / "tencent".
		vendor: pg.text("vendor").notNull(),
		// Our normalised outcome, e.g. "ok" / "invalid_template" / "throttled".
		resultCode: pg.text("result_code").notNull(),
		// The vendor's own code (`InvalidAccessKeyId.NotFound`,
		// `isv.SMS_TEMPLATE_ILLEGAL`, ...). Null when the request never reached
		// the vendor, e.g. a local misconfiguration or a network error.
		vendorCode: pg.text("vendor_code"),
		createdAt: pg.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		// The three rate-limit windows, newest first so a `LIMIT 1` answers
		// "when was the last attempt".
		pg.index().on(t.phoneHash, t.createdAt.desc()),
		pg.index().on(t.ipHash, t.createdAt.desc()),
		// Retention sweep and the admin console's "recent failures" list.
		pg.index().on(t.createdAt.desc()),
	],
);
