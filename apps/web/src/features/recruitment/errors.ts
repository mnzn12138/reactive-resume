import { t } from "@lingui/core/macro";
import { ORPCError } from "@orpc/client";

/**
 * The campus board's error vocabulary, translated into sentences a reader can act on.
 *
 * The codes themselves are declared by the server in
 * `packages/api/src/dto/recruitment.ts` (`RECRUITMENT_ERROR_CODES`). They travel on an
 * `ORPCError`'s `data.code`, not in a response body, so the client has to read them off the
 * thrown error — which is what this file exists to do in one place.
 *
 * They are mirrored here rather than imported because `@reactive-resume/api`'s export map
 * publishes only `features/recruitment/{convert,options}`; reaching into the package's `src`
 * is forbidden by the workspace boundary rule. The mirror is deliberately a `const` object
 * with the same keys, so a future export-map entry can replace the whole block.
 *
 * Why translate them at all: two of them are **conflicts that must not be confused**. A
 * duplicate submission and a repeated report are both HTTP 409, and the server refuses to
 * silently swallow either. Showing "unknown error" for a 409 would tell the reader their
 * report vanished; showing "conflict" would tell them nothing.
 */
export const RECRUITMENT_ERROR_CODES = {
	/** `applyUrl` and `sourceUrl` are both missing. */
	sourceRequired: "RECRUITMENT_SOURCE_REQUIRED",
	/** The scheme whitelist rejected a URL. Also raised by the zod layer as a 400. */
	invalidUrlScheme: "RECRUITMENT_INVALID_URL_SCHEME",
	/** `deadline` is in the past. Also raised by the zod layer on create. */
	deadlineInPast: "RECRUITMENT_DEADLINE_IN_PAST",
	/** Reporting a post you submitted yourself. */
	selfReport: "RECRUITMENT_SELF_REPORT",
	/** `contactKind` and `contactValue` were not supplied as a pair. */
	contactIncomplete: "RECRUITMENT_CONTACT_INCOMPLETE",
	/** Submission is switched off and the caller is not an administrator. */
	submissionDisabled: "RECRUITMENT_SUBMISSION_DISABLED",
	/** Editing, deleting or withdrawing a post you do not own — answered as 404, not 403. */
	notOwner: "RECRUITMENT_NOT_OWNER",
	/** The board itself is switched off. */
	boardDisabled: "RECRUITMENT_BOARD_DISABLED",
	/** The post does not exist, or is not visible to the caller. */
	postNotFound: "RECRUITMENT_POST_NOT_FOUND",
	/** Editing or re-submitting a post an administrator has taken down. */
	postClosed: "RECRUITMENT_POST_CLOSED",
	/** The dedupe key is already held by a live post. */
	duplicate: "RECRUITMENT_DUPLICATE",
	/** The same person reported the same post twice. */
	alreadyReported: "RECRUITMENT_ALREADY_REPORTED",
} as const;

export type RecruitmentErrorCode = (typeof RECRUITMENT_ERROR_CODES)[keyof typeof RECRUITMENT_ERROR_CODES];

/** What a caller needs in order to react to a failed recruitment request. */
export type RecruitmentFailure = {
	/** Human-readable copy, already resolved through the active catalogue. */
	message: string;
	/** Set only on a duplicate conflict: the post that already holds the dedupe key. */
	existingPostId: string | null;
	/** The caller had already reported this post — the report did land the first time. */
	alreadyReported: boolean;
	/** Submission is switched off instance-wide; the entry point should disappear. */
	submissionDisabled: boolean;
	/** The board itself is switched off; nothing on it is reachable any more. */
	boardDisabled: boolean;
};

/** `ORPCError` puts the code on `data.code`; anything else is unattributable. */
function readCode(error: unknown): string | null {
	if (!(error instanceof ORPCError)) return null;

	const data: unknown = error.data;
	if (typeof data !== "object" || data === null || !("code" in data)) return null;

	const { code } = data as { code?: unknown };
	return typeof code === "string" ? code : null;
}

/** The 409 conflict payload carries the id of the post that already exists. */
function readExistingPostId(error: unknown): string | null {
	if (!(error instanceof ORPCError)) return null;

	const data: unknown = error.data;
	if (typeof data !== "object" || data === null || !("existingPostId" in data)) return null;

	const { existingPostId } = data as { existingPostId?: unknown };
	return typeof existingPostId === "string" && existingPostId.length > 0 ? existingPostId : null;
}

/**
 * Copy for one code.
 *
 * Every branch says what to do next rather than what went wrong at the wire level: a reader
 * who hit "the deadline has to be in the future" can fix it, a reader who hit "conflict"
 * cannot.
 */
function messageForCode(code: string): string {
	switch (code) {
		case RECRUITMENT_ERROR_CODES.duplicate:
			return t`A post for this company, role and city already exists.`;
		case RECRUITMENT_ERROR_CODES.alreadyReported:
			return t`You have already reported this post. An administrator will look at it.`;
		case RECRUITMENT_ERROR_CODES.selfReport:
			return t`You cannot report a post you submitted yourself.`;
		case RECRUITMENT_ERROR_CODES.submissionDisabled:
			return t`Submitting campus job posts is turned off on this instance.`;
		case RECRUITMENT_ERROR_CODES.boardDisabled:
			return t`The campus job board is turned off on this instance.`;
		case RECRUITMENT_ERROR_CODES.postClosed:
			return t`An administrator took this post down, so it cannot be edited. Submit it again instead.`;
		case RECRUITMENT_ERROR_CODES.sourceRequired:
			return t`Add either an application link or a link to the original announcement.`;
		case RECRUITMENT_ERROR_CODES.invalidUrlScheme:
			return t`Links have to start with http:// or https://.`;
		case RECRUITMENT_ERROR_CODES.deadlineInPast:
			return t`The deadline has to be in the future.`;
		case RECRUITMENT_ERROR_CODES.contactIncomplete:
			return t`Pick a contact channel and fill in its value — the two go together.`;
		case RECRUITMENT_ERROR_CODES.postNotFound:
		case RECRUITMENT_ERROR_CODES.notOwner:
			return t`This post is no longer available.`;
		default:
			return t`Something went wrong. Please try again.`;
	}
}

/**
 * Turn any thrown value into copy plus the flags a caller needs to react.
 *
 * Unknown errors fall back to the generic sentence rather than to `error.message`, which on
 * this stack is often an English server string that would bypass the catalogue entirely.
 */
export function toRecruitmentFailure(error: unknown): RecruitmentFailure {
	const code = readCode(error);

	if (code === null) {
		return {
			message: t`Something went wrong. Please try again.`,
			existingPostId: null,
			alreadyReported: false,
			submissionDisabled: false,
			boardDisabled: false,
		};
	}

	return {
		message: messageForCode(code),
		existingPostId: readExistingPostId(error),
		alreadyReported: code === RECRUITMENT_ERROR_CODES.alreadyReported,
		submissionDisabled: code === RECRUITMENT_ERROR_CODES.submissionDisabled,
		boardDisabled: code === RECRUITMENT_ERROR_CODES.boardDisabled,
	};
}

/** The copy alone, for call sites that only need to show a toast. */
export function recruitmentErrorMessage(error: unknown): string {
	return toRecruitmentFailure(error).message;
}
