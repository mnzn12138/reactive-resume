import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { describe, expect, it } from "vitest";
import { sectionTypeSchema } from "@reactive-resume/schema/resume/data";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { sectionPresets } from "@reactive-resume/schema/resume/section-presets";
import { applySectionPreset, findMatchingSectionPreset } from "./section-presets";

const resume = (): ResumeData => structuredClone(defaultResumeData) as ResumeData;

const isHidden = (data: ResumeData, type: string): boolean =>
	type === "summary" ? data.summary.hidden : Boolean(data.sections[type as "profiles"]?.hidden);

describe("applySectionPreset", () => {
	it("rewrites the first page to the preset columns", () => {
		const data = resume();
		applySectionPreset(data, "cnCampus");

		expect(data.metadata.layout.pages[0]?.main).toEqual([...sectionPresets.cnCampus.main]);
		expect(data.metadata.layout.pages[0]?.sidebar).toEqual([...sectionPresets.cnCampus.sidebar]);
	});

	it("shows exactly the sections the preset does not hide", () => {
		const data = resume();
		applySectionPreset(data, "cnExperienced");

		for (const type of sectionTypeSchema.options) {
			expect(isHidden(data, type), type).toBe(sectionPresets.cnExperienced.hidden.includes(type));
		}
	});

	it("keeps custom sections instead of dropping them", () => {
		const data = resume();
		const page = data.metadata.layout.pages[0];
		if (!page) throw new Error("expected a page");
		page.main = [...page.main, "custom-019bef5a"];

		applySectionPreset(data, "cnPublicSector");

		expect(data.metadata.layout.pages[0]?.main).toContain("custom-019bef5a");
		expect(data.metadata.layout.pages[0]?.main.at(-1)).toBe("custom-019bef5a");
	});

	it("does nothing when the resume has no pages", () => {
		const data = resume();
		data.metadata.layout.pages = [];

		expect(() => applySectionPreset(data, "cnCampus")).not.toThrow();
		expect(data.metadata.layout.pages).toEqual([]);
	});

	it("is idempotent", () => {
		const data = resume();
		applySectionPreset(data, "cnCampus");
		const first = JSON.stringify(data.metadata.layout.pages[0]);

		applySectionPreset(data, "cnCampus");

		expect(JSON.stringify(data.metadata.layout.pages[0])).toBe(first);
	});
});

describe("findMatchingSectionPreset", () => {
	it("recognises the shipped default layout as the standard preset", () => {
		expect(findMatchingSectionPreset(resume())).toBe("standard");
	});

	it("recognises a layout produced by applySectionPreset", () => {
		const data = resume();
		applySectionPreset(data, "cnCampus");
		expect(findMatchingSectionPreset(data)).toBe("cnCampus");
	});

	it("returns undefined for a hand-tweaked layout", () => {
		const data = resume();
		const page = data.metadata.layout.pages[0];
		if (!page) throw new Error("expected a page");
		page.main = ["experience", "education"];

		expect(findMatchingSectionPreset(data)).toBeUndefined();
	});
});
