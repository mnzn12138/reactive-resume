/**
 * Server-side dedupe key for recruitment posts.
 *
 * Two humans typing the same opening must not produce two rows: the board would show the
 * same job twice and the review queue would duplicate work. `recruitment_post.dedupe_key`
 * is UNIQUE, so the database — not the application — is the final arbiter.
 *
 * The key is always recomputed server-side; a client-supplied value is never trusted.
 *
 * Shape (§3.7 of `plans/46-campus-board-design.md`):
 *
 * ```text
 * lower(trim(company)) + "|" + lower(trim(role)) + "|" + (sorted(locations)[0] ?? "")
 * ```
 */

/**
 * Company-name suffixes that carry no identifying information.
 *
 * "腾讯科技（深圳）有限公司" and "腾讯科技(深圳)" are the same employer; without stripping
 * these the unique constraint would be decorative. Ordered longest-first so that
 * 集团有限公司 is removed as a whole instead of losing its 有限公司 tail and leaving
 * 集团 dangling.
 */
const COMPANY_SUFFIXES = [
	"股份有限公司",
	"有限责任公司",
	"集团有限公司",
	"有限公司",
	"集团公司",
	"（中国）",
	"(中国)",
	"中国",
] as const;

/**
 * Fold the variants a human can type for the same word into one form.
 *
 * Steps, in order:
 * 1. NFKC — folds full-width Latin/punctuation (ＡＢＣ, （）) to half-width and turns the
 *    ideographic space U+3000 into a normal one.
 * 2. strip every whitespace run, including the ideographic one — "腾讯 科技" and "腾讯科技"
 *    are one company, and a collapse-to-single-space rule would still keep them apart.
 * 3. lowercase, which also covers the Latin-script case NFKC has already normalised.
 */
export function normalizeText(value: string): string {
	return value.normalize("NFKC").replace(/\s+/gu, "").trim().toLowerCase();
}

/**
 * Company name prepared for a dedupe key: normalised, then stripped of its legal suffixes.
 *
 * Stripping repeats until nothing more matches, so "…（中国）有限公司" loses both parts. It
 * only applies when something identifying is left over — a company literally named "公司"
 * keeps its name instead of collapsing to an empty string.
 */
export function normalizeCompanyName(value: string): string {
	const normalized = normalizeText(value);
	let current = normalized;

	for (let pass = 0; pass < COMPANY_SUFFIXES.length; pass += 1) {
		let stripped = false;

		for (const suffix of COMPANY_SUFFIXES) {
			const suffixNormalized = normalizeText(suffix);
			if (current.length > suffixNormalized.length && current.endsWith(suffixNormalized)) {
				current = current.slice(0, -suffixNormalized.length);
				stripped = true;
				break;
			}
		}

		if (!stripped) break;
	}

	return current || normalized;
}

/** One work city prepared for a dedupe key. */
export function normalizeLocation(value: string): string {
	return normalizeText(value);
}

export type DedupeKeyInput = {
	/** Company name as submitted. */
	company: string;
	/** Role / job title as submitted. */
	role: string;
	/** Work cities. The lexicographically first one takes part in the key. */
	locations?: readonly string[];
};

/**
 * Build the UNIQUE dedupe key for a recruitment post.
 *
 * `locations` is sorted before the first element is taken, so the same set of cities always
 * yields the same key regardless of the order the submitter typed them in. A post with no
 * city gets an empty third segment rather than `undefined`, which keeps the key printable.
 *
 * @example
 * buildDedupeKey({ company: "字节跳动有限公司", role: "后端工程师", locations: ["北京"] });
 * // => "字节跳动|后端工程师|北京"
 */
export function buildDedupeKey(input: DedupeKeyInput): string {
	const company = normalizeCompanyName(input.company);
	const role = normalizeText(input.role);

	const locations = (input.locations ?? []).map(normalizeLocation).sort();

	return `${company}|${role}|${locations[0] ?? ""}`;
}
