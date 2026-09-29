import type { CustomFieldKey, ResumeData } from "@reactive-resume/schema/resume/data";
import { describe, expect, it } from "vitest";
import { sampleResumeData } from "@reactive-resume/schema/resume/sample";
import { getResumeExportData } from "./export-sections";
import { buildStructuredSections, buildStructuredText } from "./structured-text";

/**
 * Section titles are stored empty and resolved by the caller; mimic that with a title per section
 * id so tests can locate a section by its heading.
 */
const RESOLVED_TITLES: Record<string, string> = {
	summary: "Summary",
	experience: "Experience",
	education: "Education",
	projects: "Projects",
	skills: "Skills",
	languages: "Languages",
	interests: "Interests",
	awards: "Awards",
	certifications: "Certifications",
	publications: "Publications",
	volunteer: "Volunteer",
	references: "References",
	profiles: "Profiles",
	"019becaf-0b87-769d-98a6-46ccf558c0e8": "Custom Experience",
};

const resolveTitle = (sectionId: string) => RESOLVED_TITLES[sectionId];

const customField = (text: string, key?: CustomFieldKey) => ({
	id: `custom-${text}`,
	icon: "",
	key,
	text,
	link: "",
});

const withBasics = (overrides: Partial<ResumeData["basics"]>): ResumeData => {
	const data = structuredClone(sampleResumeData);
	Object.assign(data.basics, overrides);
	return data;
};

const labels = (data: ResumeData, title: string) =>
	buildStructuredSections(getResumeExportData(data), resolveTitle)
		.find((section) => section.title === title)
		?.fields.map((f) => f.label) ?? [];

describe("buildStructuredSections — 基本信息", () => {
	it("leads with the domestic fields in customFieldKeySchema enum order", () => {
		const data = withBasics({
			customFields: [
				customField("身高：180cm", undefined),
				customField("182cm", "height"),
				customField("男", "gender"),
				customField("1998年3月", "birthDate"),
			],
		});

		// Only fields carrying a semantic key are slotted; the bare "身高：180cm" one stays generic.
		expect(labels(data, "基本信息").slice(0, 4)).toEqual(["姓名", "性别", "出生年月", "身高"]);
	});

	it("reads the value from after the separator and uses the canonical label", () => {
		const data = withBasics({ customFields: [customField("政治面貌：中共党员", "politicalStatus")] });
		const fields = buildStructuredSections(getResumeExportData(data), resolveTitle)[0]?.fields ?? [];

		expect(fields).toContainEqual({ label: "政治面貌", value: "中共党员" });
	});

	it("still emits custom fields without a semantic key, after the domestic ones", () => {
		const data = withBasics({
			customFields: [
				customField("github.com/dkowalski-dev"),
				customField("中共党员", "politicalStatus"),
				customField("民族：汉族"),
			],
		});
		const fields = labels(data, "基本信息");

		expect(fields.indexOf("政治面貌")).toBeLessThan(fields.indexOf("民族"));
		expect(fields).toContain("其他"); // no colon → falls back to 其他
		expect(fields.indexOf("其他")).toBeLessThan(fields.indexOf("手机"));
	});

	it("emits the contact fields, then 求职意向 from the headline", () => {
		const data = withBasics({ customFields: [] });
		const fields = labels(data, "基本信息");

		expect(fields).toEqual(["姓名", "手机", "邮箱", "所在地", "网址"]);

		const intention = buildStructuredSections(getResumeExportData(data), resolveTitle).find(
			(section) => section.title === "求职意向",
		);
		expect(intention?.fields).toEqual([{ label: "求职意向", value: data.basics.headline }]);
	});
});

describe("buildStructuredSections — visibility", () => {
	it("excludes hidden sections", () => {
		const data = structuredClone(sampleResumeData);
		data.sections.education.hidden = true;
		const titles = buildStructuredSections(getResumeExportData(data), resolveTitle).map((s) => s.title);

		expect(titles).not.toContain("Education");
	});

	it("excludes hidden items but keeps the section", () => {
		const data = structuredClone(sampleResumeData);
		for (const item of data.sections.education.items) item.hidden = true;
		const education = buildStructuredSections(getResumeExportData(data), resolveTitle).find(
			(section) => section.title === "Education",
		);

		expect(education).toBeUndefined();
	});

	it("excludes a hidden summary", () => {
		const data = structuredClone(sampleResumeData);
		data.summary.hidden = true;
		const titles = buildStructuredSections(getResumeExportData(data), resolveTitle).map((s) => s.title);

		expect(titles).not.toContain("Summary");
	});
});

describe("buildStructuredText", () => {
	it("flattens rich text and never emits a bare 标签：", () => {
		const data = structuredClone(sampleResumeData);
		data.sections.projects.items = [
			{
				id: "p1",
				hidden: false,
				name: "Starbound Odyssey",
				period: "2020 - 2022",
				website: { url: "", label: "", inlineLink: false },
				description: "<p>Led <strong>teams</strong> of <em>engineers</em>.</p>",
			},
		];
		const text = buildStructuredText(getResumeExportData(data), resolveTitle);

		expect(text).toContain("描述：Led **teams** of _engineers_.");
		expect(text).not.toMatch(/<[a-z][^>]*>/i);
		expect(text.split("\n").filter((line) => line.endsWith("："))).toEqual([]);
	});

	it("omits fields whose value is empty", () => {
		const data = structuredClone(sampleResumeData);
		data.basics.phone = "";
		data.basics.email = "   ";
		const text = buildStructuredText(getResumeExportData(data), resolveTitle);

		expect(text).not.toContain("手机：");
		expect(text).not.toContain("邮箱：");
	});

	it("appends sections outside the fixed order last, in layout order", () => {
		const data = structuredClone(sampleResumeData);
		const titles = buildStructuredSections(getResumeExportData(data), resolveTitle).map((s) => s.title);

		// profiles is on page 1's sidebar; publications/volunteer are on page 3. None are in the
		// fixed recruitment-form order, so they trail every fixed-order section.
		const lastFixed = titles.indexOf("Summary");
		expect(titles.indexOf("Profiles")).toBeGreaterThan(lastFixed);
		expect(titles.indexOf("Publications")).toBeGreaterThan(titles.indexOf("Profiles"));
		expect(titles.indexOf("Volunteer")).toBeGreaterThan(titles.indexOf("Publications"));
	});

	it("uses the fullwidth colon and one trailing newline", () => {
		const text = buildStructuredText(getResumeExportData(sampleResumeData), resolveTitle);

		expect(text).toContain("姓名：David Kowalski");
		expect(text.endsWith("\n")).toBe(true);
		expect(text.endsWith("\n\n")).toBe(false);
		expect(text).not.toMatch(/\n{3,}/);
	});

	it("produces stable output over sampleResumeData", () => {
		const data = getResumeExportData(sampleResumeData);
		const first = buildStructuredText(data, resolveTitle);
		const second = buildStructuredText(getResumeExportData(sampleResumeData), resolveTitle);

		expect(first).toBe(second);
		expect(buildStructuredSections(data, resolveTitle).map((s) => s.title)).toMatchInlineSnapshot(`
			[
			  "基本信息",
			  "求职意向",
			  "Education",
			  "Experience",
			  "Projects",
			  "Skills",
			  "Certifications",
			  "Awards",
			  "Summary",
			  "Profiles",
			  "Custom Experience",
			  "Languages",
			  "Interests",
			  "References",
			  "Publications",
			  "Volunteer",
			]
		`);
	});
});
