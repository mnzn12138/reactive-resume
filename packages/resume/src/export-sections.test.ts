import { describe, expect, it } from "vitest";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { sampleResumeData } from "@reactive-resume/schema/resume/sample";
import { getResumeExportData } from "./export-sections";

const withPages = (pages: typeof defaultResumeData.metadata.layout.pages) => ({
	...defaultResumeData,
	metadata: {
		...defaultResumeData.metadata,
		layout: { ...defaultResumeData.metadata.layout, pages },
	},
});

describe("getResumeExportData", () => {
	it("keeps a layout whose pages all list at least one section", () => {
		const data = getResumeExportData(sampleResumeData);

		expect(data.metadata.layout.pages).toEqual(sampleResumeData.metadata.layout.pages);
	});

	it("drops pages that no longer list any section", () => {
		const populated = sampleResumeData.metadata.layout.pages[0];
		if (!populated) throw new Error("sample resume data must define at least one layout page");
		const data = getResumeExportData(withPages([populated, { fullWidth: true, main: [], sidebar: [] }]));

		expect(data.metadata.layout.pages).toEqual([populated]);
	});

	it("falls back to a single empty page when every page is empty", () => {
		const data = getResumeExportData(withPages([]));

		expect(data.metadata.layout.pages).toEqual([{ fullWidth: true, main: [], sidebar: [] }]);
	});
});
