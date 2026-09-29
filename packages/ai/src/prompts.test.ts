import type { PromptLocale } from "./prompts";
import { describe, expect, it } from "vitest";
import { defaultPromptLocale, loadPrompts, promptLocales, resolvePromptLocale } from "./prompts";

const promptNames = [
	"atsReviewSystemPrompt",
	"atsReviewUserPromptTemplate",
	"chatSystemPromptTemplate",
	"docxParserSystemPrompt",
	"docxParserUserPrompt",
	"pdfParserSystemPrompt",
	"pdfParserUserPrompt",
] as const;

const hasCJK = (value: string) => /[一-鿿]/.test(value);

describe("loadPrompts", () => {
	it("returns a non-empty string for every prompt in every locale", () => {
		for (const locale of promptLocales) {
			const prompts = loadPrompts(locale);

			for (const name of promptNames) {
				expect(prompts[name], `${locale}/${name}`).toBeTypeOf("string");
				expect(prompts[name].trim().length, `${locale}/${name}`).toBeGreaterThan(0);
			}
		}
	});

	it("resolves every parser variable, so no placeholder reaches the model", () => {
		for (const locale of promptLocales) {
			const prompts = loadPrompts(locale);

			expect(prompts.pdfParserSystemPrompt).not.toContain("{{");
			expect(prompts.docxParserSystemPrompt).not.toContain("{{");
			expect(prompts.pdfParserSystemPrompt).toContain("JSON");
			expect(prompts.docxParserSystemPrompt).toContain("JSON");
		}
	});

	it("keeps the ATS review placeholders and the score ban in both locales", () => {
		for (const locale of promptLocales) {
			const prompts = loadPrompts(locale);

			expect(prompts.atsReviewUserPromptTemplate).toContain("{{EXTRACTED_TEXT}}");
			expect(prompts.atsReviewUserPromptTemplate).toContain("{{FINDINGS}}");
			expect(prompts.atsReviewUserPromptTemplate).toContain("{{JOB_DESCRIPTION_SECTION}}");
			expect(prompts.atsReviewUserPromptTemplate).toContain("<<<RESUME_TEXT_START>>>");
			expect(prompts.atsReviewUserPromptTemplate).toContain("<<<RESUME_TEXT_END>>>");
			expect(prompts.chatSystemPromptTemplate).toContain("{{RESUME_DATA}}");
		}

		expect(loadPrompts("en-US").atsReviewSystemPrompt).toContain("Never output a score");
		// The Chinese wording has to carry the same ban, not a softened paraphrase.
		expect(loadPrompts("zh-CN").atsReviewSystemPrompt).toContain("绝不输出任何分数");
	});

	it("defaults to the Chinese set, and differs from English for every prompt", () => {
		expect(defaultPromptLocale).toBe("zh-CN");
		expect(loadPrompts()).toEqual(loadPrompts("zh-CN"));

		const en = loadPrompts("en-US");
		const zh = loadPrompts("zh-CN");

		for (const name of promptNames) {
			expect(zh[name], name).not.toBe(en[name]);
		}

		// A translation that silently fell back to English would still pass the inequality
		// check above for the short prompts, so assert the language outright.
		for (const name of promptNames) {
			expect(hasCJK(zh[name]), `zh-CN/${name} has no CJK`).toBe(true);
		}
	});

	it("tells the model not to guess domestic-only fields it did not read", () => {
		expect(loadPrompts("zh-CN").pdfParserSystemPrompt).toContain("政治面貌");
		expect(loadPrompts("zh-CN").docxParserSystemPrompt).toContain("出生年月");
	});
});

describe("resolvePromptLocale", () => {
	it("maps every app locale onto a prompt variant", () => {
		expect(resolvePromptLocale("en-US")).toBe<PromptLocale>("en-US");
		expect(resolvePromptLocale("zh-CN")).toBe<PromptLocale>("zh-CN");
		// Traditional Chinese reuses the Simplified prompts: the two catalogs differ in UI
		// wording only, and a second near-identical prompt set would drift.
		expect(resolvePromptLocale("zh-TW")).toBe<PromptLocale>("zh-CN");
	});

	it("falls back to the default for missing or unknown values", () => {
		expect(resolvePromptLocale()).toBe<PromptLocale>("zh-CN");
		expect(resolvePromptLocale(null)).toBe<PromptLocale>("zh-CN");
		expect(resolvePromptLocale("")).toBe<PromptLocale>("zh-CN");
		expect(resolvePromptLocale("de-DE")).toBe<PromptLocale>("zh-CN");
	});
});
