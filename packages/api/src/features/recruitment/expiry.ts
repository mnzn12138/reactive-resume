import type { Availability } from "@reactive-resume/schema/recruitment/data";
import type { SQL, SQLWrapper } from "drizzle-orm";
import { and, eq, gt, gte, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import { recruitmentPost } from "@reactive-resume/db/schema";

/**
 * Freshness for the campus recruitment board — §3.6 of
 * `plans/46-campus-board-design.md`.
 *
 * Expiry is a **read-time condition, not a stored state**: this repo has no worker, cron or
 * queue, so a background job rewriting rows into `expired` would add infrastructure that can
 * silently fail and leave the board stale. `status = 'expired'` is therefore only ever
 * written by an administrator taking a post down on purpose; natural expiry is derived here,
 * on every read, from `rolling` and `deadline`.
 *
 * The 7-day `closingSoon` window is server-side by design and is deliberately not exposed as
 * a request parameter — otherwise the browser could disagree with the API about which posts
 * are about to close.
 */

/** How close a deadline has to be before a post counts as "closing soon". */
export const CLOSING_SOON_DAYS = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1_000;

/** The minimum shape a post has to expose for freshness to be derivable. */
export type RecruitmentExpiryFields = {
	rolling: boolean;
	deadline: Date | null;
};

/** AND of the given conditions; a `true` literal when there are none, which is the neutral element. */
function allOf(...conditions: (SQLWrapper | undefined)[]): SQL {
	return and(...conditions) ?? sql`true`;
}

/** OR of the given conditions; a `false` literal when there are none, which is the neutral element. */
function anyOf(...conditions: (SQLWrapper | undefined)[]): SQL {
	return or(...conditions) ?? sql`false`;
}

/** The instant a deadline has to stay beyond for a post to still be "open" rather than "closing soon". */
function closingSoonBoundary(now: Date): Date {
	return new Date(now.getTime() + CLOSING_SOON_DAYS * MS_PER_DAY);
}

const isRolling = () => eq(recruitmentPost.rolling, true);
const isNotRolling = () => eq(recruitmentPost.rolling, false);

/**
 * Whether applications are closed for this post: it is not rolling and its deadline has
 * passed. A post with no deadline never expires.
 */
export function isExpired(post: RecruitmentExpiryFields, now: Date = new Date()): boolean {
	if (post.rolling) return false;
	if (!post.deadline) return false;

	return post.deadline.getTime() <= now.getTime();
}

/**
 * Derived freshness, in the order the table in §3.6 lists it.
 *
 * `rolling` wins over everything: a post that accepts applications indefinitely is neither
 * "closing soon" nor expired, whatever its (optional) deadline says.
 */
export function availabilityOf(post: RecruitmentExpiryFields, now: Date = new Date()): Availability {
	if (post.rolling) return "rolling";

	const deadline = post.deadline;
	if (!deadline) return "open";

	if (deadline.getTime() <= now.getTime()) return "expired";
	if (deadline.getTime() < closingSoonBoundary(now).getTime()) return "closingSoon";

	return "open";
}

/**
 * Whole days left before the deadline, or `null` when the question has no answer — a rolling
 * post and a post without a deadline never count down.
 *
 * Ceiling, not floor: a deadline 23 hours away reads as "1 day left", which is what a
 * countdown is expected to say. Never negative, because "days left" is a countdown and not a
 * signed delta; an expired post therefore reports 0.
 */
export function daysUntilDeadlineOf(post: RecruitmentExpiryFields, now: Date = new Date()): number | null {
	if (post.rolling || !post.deadline) return null;

	return Math.max(0, Math.ceil((post.deadline.getTime() - now.getTime()) / MS_PER_DAY));
}

/**
 * The §3.6 "not expired" predicate as SQL, so the list query can push it down to the database
 * instead of filtering in memory: `rolling = true OR deadline IS NULL OR deadline > now()`.
 */
export function notExpiredCondition(now: Date = new Date()): SQL {
	return anyOf(isRolling(), isNull(recruitmentPost.deadline), gt(recruitmentPost.deadline, now));
}

/**
 * The `availability` filter as SQL.
 *
 * `expired` is intentionally outside the public filter whitelist (`open | closingSoon |
 * rolling`); expired posts are reached through `includeExpired` instead (§4.3.4). It is
 * handled here anyway so the admin queue can reuse this function later rather than growing a
 * second copy of the boundary arithmetic.
 */
export function availabilityCondition(availability: Availability, now: Date = new Date()): SQL {
	if (availability === "rolling") return allOf(isRolling());

	if (availability === "closingSoon") {
		return allOf(
			isNotRolling(),
			isNotNull(recruitmentPost.deadline),
			gt(recruitmentPost.deadline, now),
			lt(recruitmentPost.deadline, closingSoonBoundary(now)),
		);
	}

	if (availability === "expired") {
		return allOf(isNotRolling(), isNotNull(recruitmentPost.deadline), lte(recruitmentPost.deadline, now));
	}

	// `open`: not rolling, and either undated or far enough out that it is not closing soon.
	// `>=` the boundary (rather than `>`) mirrors `availabilityOf`, which calls a deadline
	// exactly 7 days out "open".
	return allOf(
		isNotRolling(),
		anyOf(isNull(recruitmentPost.deadline), gte(recruitmentPost.deadline, closingSoonBoundary(now))),
	);
}
