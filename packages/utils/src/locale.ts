import z from "zod";

// This fork ships only the locales below. Keep this list, `apps/web/locales/*.po`,
// `apps/web/lingui.config.ts`, and `localeMap` (apps/web/src/libs/locale.ts) in sync —
// the app resolves a locale by looking for a matching catalog file.
export const localeSchema = z.enum(["en-US", "zh-CN", "zh-TW"]);

export type Locale = z.infer<typeof localeSchema>;

export const defaultLocale: Locale = "zh-CN";

export function isLocale(value: unknown): value is Locale {
	return localeSchema.safeParse(value).success;
}

// Accepts a plain BCP-47 tag rather than `Locale`: a saved resume can still carry a
// page locale from before the catalog trim, and the PDF keeps breaking those lines
// like CJK even though the app no longer offers them in the language picker.
export function isCJKLocale(locale: string): boolean {
	const language = locale.split("-")[0]?.toLowerCase() ?? "";
	return language === "zh" || language === "ja" || language === "ko";
}

// A writing system that needs a dedicated fallback font in the PDF renderer,
// because react-pdf (unlike a browser) has no automatic system-font fallback:
// a glyph only renders if a registered font contains it. We pick the matching
// Noto font per script so e.g. Hangul → Noto KR, Arabic → Noto Arabic, instead
// of falling back to a Latin/Han-only font and producing tofu. "emoji" is
// content-detected only (never locale-derived) and resolves to Noto Emoji so
// pictographs and regional indicators render instead of mojibake (#3321).
export type Script = "hangul" | "kana" | "han-traditional" | "han-simplified" | "arabic" | "hebrew" | "thai" | "emoji";

// The CJK subset of `Script`. CJK needs extra per-character line breaking that
// must NOT be applied to Arabic (cursive, joined letters) or Thai (combining
// marks), so callers gate line-breaking on this rather than on `Script`.
const cjkScripts: readonly Script[] = ["hangul", "kana", "han-traditional", "han-simplified"];

export function isCjkScript(script: Script): boolean {
	return cjkScripts.includes(script);
}

// The script a locale primarily uses, used to order the fallback stack so the
// dominant language renders with its native font. Persian (fa-IR) uses the
// Arabic script.
export function getLocaleScript(locale?: string): Script | null {
	switch (locale) {
		case "ko-KR":
			return "hangul";
		case "ja-JP":
			return "kana";
		case "zh-TW":
			return "han-traditional";
		case "zh-CN":
			return "han-simplified";
		case "ar-SA":
		case "fa-IR":
			return "arabic";
		case "he-IL":
			return "hebrew";
		case "th-TH":
			return "thai";
		default:
			return null;
	}
}

const RTL_LANGUAGES = new Set([
	"ar", // Arabic
	"ckb", // Kurdish (Sorani)
	"dv", // Dhivehi
	"fa", // Persian
	"he", // Hebrew
	"ps", // Pashto
	"sd", // Sindhi
	"ug", // Uyghur
	"ur", // Urdu
	"yi", // Yiddish
]);

export function isRTL(locale: string): boolean {
	const language = locale.split("-")[0]?.toLowerCase() ?? "";
	return RTL_LANGUAGES.has(language);
}
