import type { FontWeight } from "./types";

const fontWeightValues: readonly FontWeight[] = ["100", "200", "300", "400", "500", "600", "700", "800", "900"];

/**
 * Font families written in a CJK script (Han / Hangul / Kana).
 *
 * These get a much smaller PDF registration budget than Latin families: a
 * single CJK face is 10-14 MiB, so every registered weight is a whole font
 * download, and unlike Latin they ship no intermediate weights anyone could
 * tell apart at resume sizes.
 *
 * They also have no true italic face — what renders for `<em>` is always a
 * synthesised slant. That does NOT mean the italic variant can be dropped:
 * @react-pdf/font resolves a source by exact `fontStyle` and throws when none
 * matches, so an italic source must exist whenever italic CJK text is
 * rendered. It costs nothing to register (fonts load lazily) and resolves to
 * the same upright file.
 *
 * Deliberately a curated list and NOT a suffix rule: `webfontlist.json`
 * contains Latin families that end in "SC" (Amatic SC, Alegreya Sans SC,
 * Bona Nova SC, Bowlby One SC, Playfair Display SC) where "SC" means
 * Small-Caps. Those have real italics and must keep their current behaviour.
 * Deployment-added families can be recognised by adding them here.
 */
export const cjkFontFamilyList: readonly string[] = [
	// Noto CJK (the per-script PDF fallback fonts, see `scriptFonts`)
	"Noto Sans SC",
	"Noto Serif SC",
	"Noto Sans TC",
	"Noto Serif TC",
	"Noto Sans JP",
	"Noto Serif JP",
	"Noto Sans KR",
	"Noto Serif KR",
	"Noto Sans HK",
	// Other CJK families present in webfontlist.json
	"IBM Plex Sans JP",
	"LINE Seed JP",
	"Black Han Sans",
	"ZCOOL QingKe HuangYou",
	// System / locally installed faces users may pick by name
	"PingFang SC",
	"PingFang TC",
	"Hiragino Sans GB",
	"Microsoft YaHei",
	"SimSun",
	"SimHei",
	"KaiTi",
	"FangSong",
	"Songti SC",
	"Source Han Sans SC",
	"Source Han Serif SC",
];

const cjkFontFamilySet: ReadonlySet<string> = new Set(cjkFontFamilyList);

/** Weight budgets: CJK keeps body + emphasis only, Latin keeps the historic order. */
export const cjkFallbackFontWeightPriority: readonly FontWeight[] = ["400", "700", "500", "600"];
export const latinFallbackFontWeightPriority: readonly FontWeight[] = ["400", "700", "600", "500"];

/** Default number of faces registered per CJK fallback family. */
export const defaultCjkFallbackFontWeightCount = 2;

/** A single `Font.register` call: one family at one weight in one style. */
export type FallbackFontVariant = {
	weight: FontWeight;
	italic: boolean;
};

export type FallbackFontVariantOptions = {
	/** `true` for Han / Hangul / Kana families: no italic, tiny weight budget. */
	cjk?: boolean;
	/** Weights the caller would otherwise register (e.g. the body/heading range plus the resolved bold). */
	requestedWeights?: readonly FontWeight[];
	/** Hard cap on the number of faces registered for a CJK family. */
	maxWeights?: number;
};

const isFontWeight = (value: string): value is FontWeight => (fontWeightValues as readonly string[]).includes(value);

const sortFontWeightsAscending = (fontWeights: readonly FontWeight[]): FontWeight[] =>
	[...fontWeights].sort((a, b) => Number(a) - Number(b));

const unique = <T>(items: readonly T[]): T[] => [...new Set(items)];

/** `true` when `family` is written in a CJK script and therefore has no real italic face. */
export function isCjkFontFamily(family: string | null | undefined): boolean {
	return typeof family === "string" && cjkFontFamilySet.has(family);
}

/**
 * Picks the weights to register for a **CJK** PDF fallback family.
 *
 * Pure: same inputs always produce the same output, no I/O, no globals — safe
 * to unit test directly with a list of available weights.
 *
 * CJK fallback only ever needs two tiers: the body face and the emphasis face.
 * Everything in between (500 / 600) is visually indistinguishable in Han
 * glyphs at resume sizes but costs another full font download, so the budget
 * defaults to two faces and prefers Regular + Bold.
 *
 * Falls back to whatever the family actually ships when it has neither 400 nor
 * 700 (e.g. a display family with only 300/500), so a family is never left
 * unregistered.
 *
 * @param availableWeights weights the family actually has.
 * @param options.requestedWeights candidate weights the caller would otherwise
 *   register; they are honoured only after the preferred pair and only while
 *   the budget allows.
 * @param options.maxWeights face budget, defaults to 2.
 */
export function getCjkFallbackFontWeights(
	availableWeights: readonly FontWeight[],
	options: FallbackFontVariantOptions = {},
): FontWeight[] {
	const maxWeights = Math.max(1, options.maxWeights ?? defaultCjkFallbackFontWeightCount);
	const available = new Set<FontWeight>(availableWeights.filter(isFontWeight));

	const requested = sortFontWeightsAscending((options.requestedWeights ?? []).filter(isFontWeight)).filter((weight) =>
		available.has(weight),
	);

	// Preferred Regular + Bold first, then whatever the caller asked for, then
	// the rest of the family — that last group only matters for families that
	// ship neither 400 nor 700, and keeps them from being left with one face.
	const candidates: FontWeight[] = [
		...cjkFallbackFontWeightPriority.filter((weight) => available.has(weight)),
		...requested,
		...sortFontWeightsAscending(availableWeights.filter(isFontWeight)),
	];

	const chosen: FontWeight[] = [];
	for (const weight of candidates) {
		if (chosen.length >= maxWeights) break;
		if (!chosen.includes(weight)) chosen.push(weight);
	}

	return sortFontWeightsAscending(chosen);
}

/**
 * Decides the full set of `Font.register` variants for one PDF fallback family.
 *
 * - CJK (`cjk: true`) → at most `maxWeights` weights (default 2), both styles.
 *   The weight budget is what saves the bytes: 4 CJK weights means 4 distinct
 *   10-14 MiB files, 2 means 2.
 * - Everything else → **every** requested weight in **both** styles, which is
 *   the historical behaviour for Latin, Arabic, Hebrew, Thai and emoji. Those
 *   scripts ship real italic faces, so their behaviour must not change.
 *
 * Both scripts keep the italic variant: react-pdf matches a registered source
 * by exact `fontStyle` and throws when none is found, so dropping it breaks
 * any run that is styled italic.
 */
export function getFallbackFontVariants(
	availableWeights: readonly FontWeight[],
	options: FallbackFontVariantOptions = {},
): FallbackFontVariant[] {
	if (options.cjk === true) {
		return getCjkFallbackFontWeights(availableWeights, options).flatMap((weight): FallbackFontVariant[] => [
			{ weight, italic: false },
			{ weight, italic: true },
		]);
	}

	return sortFontWeightsAscending(unique((options.requestedWeights ?? []).filter(isFontWeight))).flatMap(
		(weight): FallbackFontVariant[] => [
			{ weight, italic: false },
			{ weight, italic: true },
		],
	);
}
