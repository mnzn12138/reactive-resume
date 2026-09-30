import type { FeatureFlags } from "@reactive-resume/api/features/flags";

/**
 * The three board switches, read off the root router context.
 *
 * `context.flags` is the single source of truth for whether a piece of the board exists, and
 * it is already loaded by the root route — reading it costs no request and cannot disagree
 * with what the server will accept.
 *
 * ⚠️ One gap this file has to paper over, and it is worth knowing about before trusting the
 * second flag: the public `/flags` endpoint (T01) publishes `recruitmentBoardEnabled` only.
 * `recruitmentSubmissionEnabled` and `recruitmentRequireReview` are resolved server-side in
 * `packages/auth/src/instance-settings.ts` but are **not** on the wire, so the two optional
 * reads below are always `undefined` today. Rather than hide every submission entry behind a
 * value nobody can see, they fall back:
 *
 * - `submissionEnabled` falls back to the board flag. The server stays the arbiter — `create`
 *   answers 403 `RECRUITMENT_SUBMISSION_DISABLED`, which the form turns into copy and then
 *   hides itself with, so a closed instance still ends up with no visible entry point.
 * - `requireReview` falls back to `true`, which is the server's own default
 *   (`recruitmentRequireReview: true` in `packages/auth/src/instance-settings.ts`).
 *
 * Both fallbacks disappear the moment the endpoint publishes the switches; nothing else in
 * the app reads the flag object directly.
 */
export type RecruitmentFlags = {
	/** The board itself. Off means `/jobs` is a 404 and no entry point renders. */
	boardEnabled: boolean;
	/** Whether ordinary users may submit openings. */
	submissionEnabled: boolean;
	/** Whether a submission waits for an administrator before it is visible. */
	requireReview: boolean;
};

/** Reads a flag the endpoint may not publish yet without asserting that it exists. */
function readSwitch(flags: FeatureFlags | undefined, key: string): boolean | undefined {
	if (flags === undefined || flags === null) return undefined;

	const value = (flags as unknown as Record<string, unknown>)[key];
	return typeof value === "boolean" ? value : undefined;
}

export function readRecruitmentFlags(flags: FeatureFlags | undefined): RecruitmentFlags {
	const boardEnabled = flags?.recruitmentBoardEnabled === true;
	const submissionEnabled = readSwitch(flags, "recruitmentSubmissionEnabled") ?? boardEnabled;
	const requireReview = readSwitch(flags, "recruitmentRequireReview") ?? true;

	return { boardEnabled, submissionEnabled, requireReview };
}

/** Flags for a board that is switched off: every caller then hides what it gates. */
export const disabledRecruitmentFlags: RecruitmentFlags = {
	boardEnabled: false,
	submissionEnabled: false,
	requireReview: true,
};
