import type { RecruitmentSource } from "@reactive-resume/schema/recruitment/data";

/**
 * Post → application draft — §5.7 of `plans/46-campus-board-design.md`.
 *
 * This is the **only** copy of the mapping, and it is exported to the web app through
 * `packages/api/package.json` (`"./features/recruitment/convert"`) on purpose. Two paths need
 * it and they must not diverge:
 *
 * - the web detail page pre-fills the existing `application-form-sheet` with it (and waits for
 *   the user to confirm — a stray click must not create an application);
 * - `POST /recruitment/posts/{id}/to-application` (T03) creates the application server-side
 *   from the same draft.
 *
 * A second copy of this table in `apps/web` is how the two would start disagreeing about what
 * a converted post looks like.
 */

/** The fields of a post the mapping reads. Both a DB row and a public DTO satisfy it. */
export type RecruitmentDraftSource = {
	company: string;
	role: string;
	locations: readonly string[];
	salaryText: string | null;
	source: RecruitmentSource | null;
	applyUrl: string | null;
	sourceUrl: string | null;
	summary: string | null;
};

/**
 * The pre-filled application.
 *
 * Field-for-field the `applications.create` input, minus what a post cannot supply (notes,
 * contacts, follow-ups, tags). `status` is pinned to `saved`: converting a post records an
 * intention, not an application that was sent.
 */
export type RecruitmentApplicationDraft = {
	company: string;
	role: string;
	location: string | null;
	salary: string | null;
	source: string | null;
	sourceUrl: string | null;
	jobDescription: string | null;
	status: "saved";
};

/**
 * Turn a post into an application draft.
 *
 * `sourceUrl` prefers `applyUrl`: it is the page the user actually has to open to apply, while
 * `sourceUrl` is only where the announcement was found and exists for verification. An empty
 * `locations` becomes `null` rather than `""` so the created application does not carry an
 * empty location around.
 */
export function buildApplicationDraft(post: RecruitmentDraftSource): RecruitmentApplicationDraft {
	const location = post.locations.filter((city) => city.trim().length > 0).join(" / ");

	return {
		company: post.company,
		role: post.role,
		location: location.length > 0 ? location : null,
		salary: post.salaryText,
		source: post.source,
		sourceUrl: post.applyUrl ?? post.sourceUrl,
		jobDescription: post.summary,
		status: "saved",
	};
}
