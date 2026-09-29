import type { Script } from "@reactive-resume/utils/locale";
import { getLocaleScript, isCjkScript } from "@reactive-resume/utils/locale";

// ponytail: inlined from @reactive-resume/utils/field (sole consumer)
const unique = <T>(items: T[]): T[] => [...new Set(items)];

import type { FontSourceDescriptor, FontSourceReport } from "./self-hosted";
import type { FontCategory, FontFileWeight, FontRecord, FontWeight, StandardFont, WebFont } from "./types";
import { getSelfHostedFontBaseUrl, getSelfHostedOverrides, resolveSelfHostedFontFiles } from "./self-hosted";
import webFontListJSON from "./webfontlist.json";

export type { FallbackFontVariant, FallbackFontVariantOptions } from "./cjk-fallback";
export type { FontSourceDescriptor, FontSourceReport, SelfHostedFontOverride } from "./self-hosted";
export type { FontFileWeight, FontWeight, WebFont } from "./types";
export {
	cjkFallbackFontWeightPriority,
	cjkFontFamilyList,
	defaultCjkFallbackFontWeightCount,
	getCjkFallbackFontWeights,
	getFallbackFontVariants,
	isCjkFontFamily,
	latinFallbackFontWeightPriority,
} from "./cjk-fallback";
export {
	clearSelfHostedFontOverrides,
	getSelfHostedFontBaseUrl,
	getSelfHostedFontFamilies,
	getSelfHostedOverrides,
	registerSelfHostedFontOverride,
	selfHostBaseUrlEnvKey,
	selfHostedFontOverrides,
} from "./self-hosted";

const preferredChineseFontFamilies = [
	"Noto Sans SC",
	"Noto Serif SC",
	"PingFang SC",
	"Microsoft YaHei",
	"Source Han Sans SC",
	"Source Han Serif SC",
	"Songti SC",
	"SimSun",
	"SimHei",
	"KaiTi",
	"FangSong",
	"ZCOOL QingKe HuangYou",
] as const;

const standardPdfFontList = [
	{ type: "standard", category: "sans-serif", family: "Helvetica", weights: ["400", "700"] },
	{ type: "standard", category: "monospace", family: "Courier", weights: ["400", "700"] },
	{ type: "standard", category: "serif", family: "Times-Roman", weights: ["400", "700"] },
] satisfies StandardFont[];

const fontDisplayNames: Partial<Record<string, string>> = {
	FangSong: "仿宋",
	"Hiragino Sans GB": "冬青黑体简体中文",
	KaiTi: "楷体",
	"Microsoft YaHei": "微软雅黑",
	"Noto Sans SC": "思源黑体",
	"Noto Sans TC": "思源黑体（繁中）",
	"Noto Serif SC": "思源宋体",
	"Noto Serif TC": "思源宋体（繁中）",
	"PingFang SC": "苹方",
	SimHei: "黑体",
	SimSun: "宋体",
	"Songti SC": "华文宋体",
	"Source Han Sans SC": "思源黑体（本地）",
	"Source Han Serif SC": "思源宋体（本地）",
	"ZCOOL QingKe HuangYou": "站酷庆科黄油体",
};

// Per-script Noto web font, split by serif/sans category. These match the
// actual writing system: Hangul lives only in the KR fonts, Kana only in JP,
// Arabic glyphs only in the Arabic fonts, etc. — so a Latin or Simplified-
// Chinese font cannot render them and produces tofu. Where Noto ships no serif
// variant for a script (Hebrew, Thai), the serif slot reuses the sans font so
// serif resumes still render real glyphs instead of nothing. All entries are
// present in webfontlist.json.
const scriptFonts: Record<Script, { serif: string; sansSerif: string }> = {
	hangul: { serif: "Noto Serif KR", sansSerif: "Noto Sans KR" },
	kana: { serif: "Noto Serif JP", sansSerif: "Noto Sans JP" },
	"han-traditional": { serif: "Noto Serif TC", sansSerif: "Noto Sans TC" },
	"han-simplified": { serif: "Noto Serif SC", sansSerif: "Noto Sans SC" },
	arabic: { serif: "Noto Naskh Arabic", sansSerif: "Noto Sans Arabic" },
	hebrew: { serif: "Noto Sans Hebrew", sansSerif: "Noto Sans Hebrew" },
	thai: { serif: "Noto Sans Thai", sansSerif: "Noto Sans Thai" },
	// Monochrome outlines (TrueType glyf, not CBDT bitmaps) so react-pdf can
	// embed them; the serif/sans distinction is meaningless for emoji (#3321).
	emoji: { serif: "Noto Emoji", sansSerif: "Noto Emoji" },
};

// Covers General Punctuation (U+2000–U+206F) and other symbols missing from
// many Latin body fonts (e.g. U+2022 BULLET in IBM Plex Serif). react-pdf has
// no browser-style system fallback, so we register Noto as a last-resort
// glyph source in the PDF font stack (#3190).
const punctuationFallbackFonts = {
	serif: "Noto Serif",
	sansSerif: "Noto Sans",
} as const;

/**
 * Overlays the self-hosted override table onto the generated webfont list.
 *
 * `webfontlist.json` is a build artifact of `tooling/fonts/generate.ts`: any
 * hand-edit there is wiped on the next regeneration, so deployments point
 * their own (usually subsetted) font files at their own host through
 * `selfHostedFontOverrides` and the merge happens here, at runtime.
 *
 * Same-family entries overwrite in place (no duplicate family in the list, no
 * duplicate map key); a family that is not in the generated list is appended
 * once. Weights are only replaced when the override declares some, and
 * `preview` follows the overridden Regular face when there is one.
 */
function mergeSelfHostedOverrides(fonts: WebFont[]): WebFont[] {
	const overrides = getSelfHostedOverrides();
	if (overrides.length === 0) return fonts;

	const baseUrl = getSelfHostedFontBaseUrl();
	const merged = [...fonts];
	const indexByFamily = new Map<string, number>(merged.map((font, index) => [font.family, index]));

	for (const override of overrides) {
		const family = override.family?.trim();
		if (!family) continue;

		const files = resolveSelfHostedFontFiles(override.files, baseUrl);
		if (Object.keys(files).length === 0) continue;

		const weights = override.weights.length > 0 ? sortFontWeights(override.weights) : null;
		const existingIndex = indexByFamily.get(family);
		const existing = existingIndex === undefined ? undefined : merged[existingIndex];

		if (existingIndex === undefined || !existing) {
			merged.push({
				type: "web",
				category: "sans-serif",
				family,
				weights: weights ?? ["400"],
				preview: files["400"] ?? Object.values(files)[0] ?? "",
				files,
			});
			indexByFamily.set(family, merged.length - 1);
			continue;
		}

		merged[existingIndex] = {
			...existing,
			weights: weights ?? existing.weights,
			files: { ...existing.files, ...files },
			preview: files["400"] ?? existing.preview,
		};
	}

	return merged;
}

const generatedWebFontList = webFontListJSON as WebFont[];

export const webFontList: WebFont[] = [];
export const webFontMap = new Map<string, WebFont>();

/**
 * (Re-)applies the self-hosted override table and rebuilds `webFontList` /
 * `webFontMap` in place.
 *
 * Runs once at module load, so a deployment that simply edits
 * `selfHostedFontOverrides` needs no wiring. Deployments that register
 * overrides at runtime (from a config file, a CMS, …) call this once after
 * registering them; `webFontList` keeps its identity, so already-captured
 * references keep working.
 */
export function applySelfHostedOverrides(): void {
	const merged = mergeSelfHostedOverrides(generatedWebFontList);

	webFontList.length = 0;
	webFontList.push(...merged);

	webFontMap.clear();
	for (const font of merged) {
		webFontMap.set(font.family, font);
	}
}

applySelfHostedOverrides();

export const standardFontList = standardPdfFontList.filter((font) => !webFontMap.has(font.family));

/**
 * Diagnostic view of where every web font is actually fetched from: which
 * families are served by this deployment and which still go to
 * `fonts.gstatic.com` (i.e. still break in an offline / intranet install).
 *
 * A partially overridden family appears in **both** lists — that is the point:
 * it tells the operator exactly which weights are still remote.
 */
export function describeFontSources(): FontSourceReport {
	const baseUrl = getSelfHostedFontBaseUrl();
	const selfHostedUrlsByFamily = new Map<string, Set<string>>();

	for (const override of getSelfHostedOverrides()) {
		if (Object.keys(override.files).length === 0) continue;
		selfHostedUrlsByFamily.set(override.family, new Set(Object.values(override.files)));
	}

	const selfHosted: FontSourceDescriptor[] = [];
	const remote: FontSourceDescriptor[] = [];
	const remoteHosts = new Set<string>();

	for (const font of webFontList) {
		const ownUrls = selfHostedUrlsByFamily.get(font.family);
		const selfHostedFiles: Partial<Record<FontFileWeight, string>> = {};
		const remoteFiles: Partial<Record<FontFileWeight, string>> = {};

		for (const [weight, url] of Object.entries(font.files)) {
			if (typeof url !== "string") continue;
			if (ownUrls?.has(url)) selfHostedFiles[weight as FontFileWeight] = url;
			else remoteFiles[weight as FontFileWeight] = url;
		}

		if (Object.keys(selfHostedFiles).length > 0) {
			selfHosted.push({
				family: font.family,
				selfHosted: true,
				weights: [...font.weights],
				files: selfHostedFiles,
			});
		}

		if (Object.keys(remoteFiles).length > 0) {
			remote.push({ family: font.family, selfHosted: false, weights: [...font.weights], files: remoteFiles });

			for (const url of Object.values(remoteFiles)) {
				const host = getUrlHost(url);
				if (host) remoteHosts.add(host);
			}
		}
	}

	return { baseUrl, selfHosted, remote, remoteHosts: [...remoteHosts].sort() };
}

function getUrlHost(url: string): string | null {
	try {
		return new URL(url).host;
	} catch {
		return null;
	}
}

const fontMap = new Map<string, FontRecord>();
const chinesePrioritySet = new Set<string>(preferredChineseFontFamilies);

export const fontList = [...standardFontList, ...webFontList].sort((a, b) =>
	a.family.localeCompare(b.family, undefined, { sensitivity: "base" }),
);

for (const font of fontList) {
	fontMap.set(font.family, font);
}

// Compatibility aliases for fonts that v5.0.x resolved via the browser
// (Arial, Times New Roman, ...) but that aren't registered with
// @react-pdf/renderer in v5.1+. Targets are metric-compatible web fonts
// already shipped in webfontlist (#2989).
const legacyFontAliases: Record<string, string> = {
	Arial: "Arimo",
	Cambria: "Tinos",
	Calibri: "Carlito",
	Garamond: "EB Garamond",
	"Times New Roman": "Times-Roman",
};

export function resolveLegacyFontAlias(family: string): string | null {
	return legacyFontAliases[family] ?? null;
}

export function getFont(family: string) {
	const direct = fontMap.get(family);
	if (direct) return direct;

	const alias = legacyFontAliases[family];
	return alias ? fontMap.get(alias) : undefined;
}

export function getFontDisplayName(family: string) {
	return fontDisplayNames[family] ?? family;
}

export function getFontSearchKeywords(family: string) {
	return unique(
		[family, fontDisplayNames[family], chinesePrioritySet.has(family) ? "中文" : undefined].filter(
			(keyword): keyword is string => Boolean(keyword),
		),
	);
}

function getScriptFont(script: Script, category: FontCategory | null) {
	const variants = scriptFonts[script];
	return category === "serif" ? variants.serif : variants.sansSerif;
}

function getPunctuationFallbackFont(category: FontCategory | null) {
	const family = category === "serif" ? punctuationFallbackFonts.serif : punctuationFallbackFonts.sansSerif;
	return getWebFont(family) ? family : null;
}

export function isStandardPdfFontFamily(family: string) {
	return standardFontList.some((font) => font.family === family);
}

export function getWebFont(family: string) {
	return webFontMap.get(family);
}

export function getWebFontSource(family: string, weight: FontWeight = "400", italic = false) {
	const webFont = getWebFont(family);
	if (!webFont) return null;

	const key = `${weight}${italic ? "italic" : ""}` as FontFileWeight;
	return webFont.files[key] ?? (italic ? webFont.files[weight] : undefined) ?? webFont.preview;
}

export function sortFontWeights<T extends string>(fontWeights: T[]): T[] {
	return [...fontWeights].sort((a, b) => Number(a) - Number(b));
}

/**
 * Resolves the font weight used for bold text (`<strong>`, rich-text bold
 * and the template `bold` styles).
 *
 * The last stored body weight is ambiguous: families are commonly stored as
 * `["400", "600"]` (the default pairing from the typography picker), which
 * renders `<strong>` at SemiBold — nearly indistinguishable from Regular for
 * faces like Open Sans (#3310). Bold text should use the family's true Bold
 * face when one exists.
 *
 * Resolution order:
 * 1. A stored weight at or above Bold (700) that the family actually has —
 *    that is a deliberate bold-class choice by the user, so keep it.
 * 2. The family's true Bold face ("700").
 * 3. The heaviest available face at or above SemiBold (600).
 * 4. `null` — the family has no bold-class face; callers keep their existing
 *    `fontWeights.at(-1)` fallback.
 *
 * `family` may be a PDF fallback stack (`string[]`, see #2986); the primary
 * (first) family decides because `fontWeight` applies across the stack.
 */
export function resolveBoldFontWeight(family: string | string[], storedWeights: readonly string[]): FontWeight | null {
	const familyName = Array.isArray(family) ? family[0] : family;
	if (!familyName) return null;

	const weights = getFont(familyName)?.weights;
	if (!weights || weights.length === 0) return null;

	const available = new Set<FontWeight>(weights);

	const deliberateBoldClass = sortFontWeights(
		storedWeights.filter(
			(weight): weight is FontWeight => available.has(weight as FontWeight) && Number(weight) >= 700,
		),
	);
	const heaviestDeliberate = deliberateBoldClass[deliberateBoldClass.length - 1];
	if (heaviestDeliberate) return heaviestDeliberate;

	if (available.has("700")) return "700";

	const boldClass = sortFontWeights(weights.filter((weight) => Number(weight) >= 600));
	return boldClass[boldClass.length - 1] ?? null;
}

/**
 * Returns an ordered stack of Noto web fonts to register as glyph-level
 * fallbacks for PDF rendering. react-pdf resolves the font per-codepoint
 * left-to-right across the stack, so listing one font per writing system lets
 * a single resume mix Latin with Hangul, Kana, Han, Arabic, Hebrew or Thai.
 *
 * Ordering: the locale's primary script first (the dominant language), then
 * any other scripts actually detected in the content. When the stack contains
 * a CJK script, a Simplified Chinese entry is appended as a safety net for
 * stray CJK-Unified ideographs (preserving prior behavior); non-CJK scripts
 * get no such net. The result is deduped, has the primary family removed, and
 * only keeps fonts that exist in the webfontlist.
 */
export function getPdfFallbackFontFamilies(
	family: string,
	options: { locale?: string; scripts?: Iterable<Script> } = {},
): string[] {
	const category = getFont(family)?.category ?? null;

	const ordered: Script[] = [];
	const localeScript = getLocaleScript(options.locale);
	if (localeScript) ordered.push(localeScript);
	if (options.scripts) ordered.push(...options.scripts);
	if (ordered.some(isCjkScript)) ordered.push("han-simplified");

	const fallbacks = unique(ordered.map((script) => getScriptFont(script, category)))
		.filter((candidate) => candidate !== family)
		.filter((candidate) => Boolean(getWebFont(candidate)));

	const punctuationFallback = getPunctuationFallbackFont(category);
	if (punctuationFallback && punctuationFallback !== family && !fallbacks.includes(punctuationFallback)) {
		fallbacks.push(punctuationFallback);
	}

	return fallbacks;
}
