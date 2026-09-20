import { count, eq, gte, sql } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import { resume, user } from "@reactive-resume/db/schema";
import { getStorageService } from "../storage";

/** Window covered by the signup trend. */
const TREND_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** UTC day key, matching the `date_trunc` expression below. */
const dayKey = (date: Date) => date.toISOString().slice(0, 10);

const startOfUtcDay = (date: Date) => new Date(`${dayKey(date)}T00:00:00.000Z`);

/** Oldest first, ending today, so the chart never has to reorder anything. */
const trendDayKeys = (days: number) =>
	Array.from({ length: days }, (_, index) => dayKey(new Date(Date.now() - (days - 1 - index) * DAY_MS)));

/**
 * Counts come back as rows rather than a plain number under the current
 * dependency tree, so every figure is unwrapped and coerced in one place.
 */
const toCount = (rows: { value: unknown }[] | undefined) => Number(rows?.at(0)?.value ?? 0);

async function readStorageUsage() {
	try {
		return await getStorageService().usage("uploads/");
	} catch (error) {
		// A storage outage must not take the whole overview down, but reporting
		// zero would be a lie — the DTO carries null for "not available".
		console.error("[admin] failed to read storage usage", error);
		return null;
	}
}

async function get() {
	const trendStart = startOfUtcDay(new Date(Date.now() - (TREND_DAYS - 1) * DAY_MS));

	const [userRows, resumeRows, publicRows, signupRows, storage] = await Promise.all([
		db.select({ value: count() }).from(user),
		db.select({ value: count() }).from(resume),
		db.select({ value: count() }).from(resume).where(eq(resume.isPublic, true)),
		db
			.select({
				// Pinned to UTC so the buckets line up with the JS day keys below even
				// when the database session runs in another timezone.
				date: sql<string>`to_char(date_trunc('day', ${user.createdAt} at time zone 'UTC'), 'YYYY-MM-DD')`,
				value: count(),
			})
			.from(user)
			.where(gte(user.createdAt, trendStart))
			.groupBy(sql`1`),
		readStorageUsage(),
	]);

	const signupsByDay = new Map(signupRows.map((row) => [row.date, Number(row.value ?? 0)]));

	return {
		totals: {
			users: toCount(userRows),
			resumes: toCount(resumeRows),
			publicResumes: toCount(publicRows),
		},
		// Days with no signups are absent from the group-by result, so they are
		// filled in here rather than making every consumer handle the gaps.
		signups: trendDayKeys(TREND_DAYS).map((date) => ({ date, count: signupsByDay.get(date) ?? 0 })),
		storage,
	};
}

export const adminOverviewService = { get };
