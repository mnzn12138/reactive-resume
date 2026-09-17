import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { getResumeSectionTitle } from "./section-title";
import { createResumePdfFile } from "./server";

function fixture(locale: string) {
	const data = structuredClone(defaultResumeData);
	data.metadata.page.locale = locale;
	data.metadata.typography.body.fontFamily = "Helvetica";
	data.metadata.typography.heading.fontFamily = "Helvetica";
	data.metadata.layout.pages = [{ fullWidth: true, main: ["summary"], sidebar: [] }];
	data.picture.hidden = true;
	data.summary.content = "<p>Localized document content.</p>";
	return data;
}

describe("default PDF section title locale", () => {
	it("localizes default headings without an injected browser translator", () => {
		const data = fixture("zh-CN");
		expect(getResumeSectionTitle(data, "summary", "")).toBe("总结");
		expect(getResumeSectionTitle(data, "experience", "")).toBe("工作经历");
		expect(getResumeSectionTitle(data, "education", "")).toBe("教育经历");
	});
	it("preserves explicit titles and caller-provided translators", () => {
		const data = fixture("zh-CN");
		data.summary.title = "My custom title";
		expect(getResumeSectionTitle(data, "summary", "")).toBe("My custom title");
		expect(getResumeSectionTitle({ ...data, resolveSectionTitle: () => "Custom translation" }, "experience", "")).toBe(
			"Custom translation",
		);
	});
	it("resolves custom sections by their type and preserves unknown-section fallbacks", () => {
		const data = fixture("zh-CN");
		data.customSections = [{ ...data.sections.experience, id: "custom-experience", type: "experience" }];
		expect(getResumeSectionTitle(data, "custom-experience", "")).toBe("工作经历");
		data.customSections = [{ ...data.sections.experience, id: "custom-summary", type: "summary", items: [] }];
		expect(getResumeSectionTitle(data, "custom-summary", "")).toBe("总结");
		expect(getResumeSectionTitle(data, "unknown", "Legacy label")).toBe("Legacy label");
	});
	it.each([
		["en-US", "Summary"],
		["zh-TW", "摘要"],
		["unknown-locale", "Summary"],
	])("includes localized default headings in the actual server PDF: %s", async (locale, heading) => {
		const data = fixture(locale);
		const file = await createResumePdfFile({ data, filename: "resume.pdf" });
		const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
		try {
			const pdf = await task.promise;
			const text = (await (await pdf.getPage(1)).getTextContent()).items
				.map((item) => ("str" in item ? item.str : ""))
				.join(" ");
			expect(text).toContain(heading);
			expect(text).toContain("Localized document content.");
		} finally {
			await task.destroy();
		}
	});
});
