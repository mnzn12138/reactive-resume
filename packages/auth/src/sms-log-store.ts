import type { SmsSendLogEntry, SmsSendLogStore, SmsSendLogWriter } from "@reactive-resume/sms/rate-limit";
import type { SQL } from "drizzle-orm";
import { and, count, desc, eq, gte, isNotNull } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import * as schema from "@reactive-resume/db/schema";

/**
 * The Postgres-backed `sms_send_log` that drives the SMS rate limits.
 *
 * `@reactive-resume/sms/rate-limit` only states the rules (60s per number, 10 per
 * number per day, 20 per IP per hour); this module is the read and write side
 * that runs them against the table created by migration `20260929010817_spotty_swarm`.
 * The same package ships an in-memory implementation so the rules stay unit
 * testable without a database — the two are expected to agree on the semantics
 * spelled out below.
 *
 * Every read here is allowed to throw, and that is deliberate rather than the
 * usual fail-open: `sendOTP` turns a failed count into "the code could not be
 * sent". Counting attempts is the only thing standing between a public,
 * unauthenticated endpoint and a paid SMS vendor, so when the count cannot be
 * established the safe answer is "do not send".
 */

/**
 * Counts rows newer than `since`. When both hashes are given they are combined
 * with AND, so a caller can ask "this number, from this network".
 */
const countSince: SmsSendLogStore["countSince"] = async (filter, since) => {
	const filters: SQL[] = [gte(schema.smsSendLog.createdAt, since)];

	if (filter.phoneHash !== undefined) {
		filters.push(eq(schema.smsSendLog.phoneHash, filter.phoneHash));
	}

	if (filter.ipHash !== undefined) {
		// `ip_hash` is nullable: a request behind a proxy that supplied no usable
		// header stores NULL, and `NULL = 'x'` is never true in SQL, so those rows
		// would already drop out. `isNotNull` is written out anyway because the
		// exclusion is the load-bearing part of the per-IP rule — leaving it to an
		// accident of three-valued logic is exactly how this query would get
		// "simplified" into a bug later.
		filters.push(isNotNull(schema.smsSendLog.ipHash), eq(schema.smsSendLog.ipHash, filter.ipHash));
	}

	const [row] = await db
		.select({ total: count() })
		.from(schema.smsSendLog)
		.where(and(...filters));

	return Number(row?.total ?? 0);
};

/** Newest attempt for a number. Drives the 60s cooldown. */
const lastSentAt: SmsSendLogStore["lastSentAt"] = async (phoneHash) => {
	const [row] = await db
		.select({ createdAt: schema.smsSendLog.createdAt })
		.from(schema.smsSendLog)
		.where(eq(schema.smsSendLog.phoneHash, phoneHash))
		.orderBy(desc(schema.smsSendLog.createdAt))
		.limit(1);

	return row?.createdAt;
};

/**
 * Appends one attempt. Called for failures as well as successes — a failed send
 * still cost a slot, and skipping the row would make the daily and hourly limits
 * trivially bypassable by aiming at numbers the vendor rejects.
 */
const record: SmsSendLogWriter["record"] = async (entry: SmsSendLogEntry) => {
	await db.insert(schema.smsSendLog).values({
		phoneHash: entry.phoneHash,
		ipHash: entry.ipHash ?? null,
		// The column is `notNull`, but an attempt that never reached a vendor has
		// no vendor — "none" keeps those rows countable without inventing one.
		vendor: entry.vendor ?? "none",
		resultCode: entry.resultCode,
		vendorCode: entry.vendorCode ?? null,
		createdAt: entry.createdAt,
	});
};

export const smsSendLogStore: SmsSendLogStore & SmsSendLogWriter = { countSince, lastSentAt, record };
