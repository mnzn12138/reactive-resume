import type { CustomFieldKey, ResumeData } from "@reactive-resume/schema/resume/data";
import { describe, expect, it } from "vitest";
import { sampleResumeData } from "@reactive-resume/schema/resume/sample";
import { getResumeExportData } from "./export-sections";
import { RECRUITMENT_PLATFORMS } from "./platform-profiles";
import { buildPlatformBlocks, buildPlatformText } from "./platform-text";
import { buildStructuredSections, buildStructuredText } from "./structured-text";

/**
 * Section titles are stored empty and resolved by the caller; A7's tests do the same so a section
 * can be located by its heading. The platform layer keys off block ids instead, which is exactly
 * the difference this file guards.
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

const CUSTOM_SECTION_ID = "019becaf-0b87-769d-98a6-46ccf558c0e8";
const resolveTitle = (sectionId: string) => RESOLVED_TITLES[sectionId];

const customField = (text: string, key?: CustomFieldKey) => ({ id: `custom-${text}`, icon: "", key, text, link: "" });

const withCustomFields = (texts: string[]): ResumeData => {
	const data = structuredClone(sampleResumeData);
	data.basics.customFields = texts.map((text) => customField(text));
	return data;
};

const blocks = (data: ResumeData, platform: string) =>
	buildPlatformBlocks(getResumeExportData(data), { platform, resolveTitle });

const blockIds = (data: ResumeData, platform: string) => blocks(data, platform).map((block) => block.id);

const blockTitles = (data: ResumeData, platform: string) => blocks(data, platform).map((block) => block.title);

const findBlock = (data: ResumeData, platform: string, id: string) => {
	const block = blocks(data, platform).find((item) => item.id === id);
	if (!block) throw new Error(`no block ${id} for ${platform}`);
	return block;
};

const lineCountMatching = (text: string, needle: string) =>
	text.split("\n").filter((line) => line.startsWith(needle)).length;

describe("generic — the A7 baseline", () => {
	it("renders byte-for-byte what buildStructuredText renders", () => {
		const data = getResumeExportData(sampleResumeData);

		expect(buildPlatformText(data, { platform: "generic", resolveTitle })).toBe(
			buildStructuredText(data, resolveTitle),
		);
	});

	it("renders byte-for-byte even with recruitment-only custom fields filled in", () => {
		const data = getResumeExportData(
			withCustomFields(["期望薪资：20k-30k", "到岗时间：一个月内", "当前状态：在职，考虑机会"]),
		);

		expect(buildPlatformText(data, { platform: "generic", resolveTitle })).toBe(
			buildStructuredText(data, resolveTitle),
		);
	});

	it("keeps one block per section, in the A7 order", () => {
		const ids = blockIds(sampleResumeData, "generic");

		expect(ids).toEqual(buildStructuredSections(getResumeExportData(sampleResumeData), resolveTitle).map((s) => s.id));
		expect(ids.slice(0, 6)).toEqual(["basics", "headline", "education", "experience", "projects", "skills"]);
	});

	it("falls back to the generic profile for an unknown platform id", () => {
		const data = getResumeExportData(sampleResumeData);

		expect(buildPlatformText(data, { platform: "lagou", resolveTitle })).toBe(buildStructuredText(data, resolveTitle));
		expect(buildPlatformText(data, { platform: "", resolveTitle })).toBe(buildStructuredText(data, resolveTitle));
		expect(blockIds(sampleResumeData, "lagou")).toEqual(blockIds(sampleResumeData, "generic"));
	});
});

describe("section order per platform", () => {
	it("puts 工作经验 before 教育经历 for boss", () => {
		expect(blockIds(sampleResumeData, "boss")).toEqual([
			"basics+headline",
			"experience",
			"projects",
			"education",
			"skills",
			"summary",
			"certifications",
			"awards",
			"languages",
			"references",
			"profiles",
			"publications",
			"volunteer",
			"interests",
			CUSTOM_SECTION_ID,
		]);
	});

	it("puts 教育经历 before 工作经验 for zhilian and job51", () => {
		expect(blockIds(sampleResumeData, "zhilian").slice(0, 8)).toEqual([
			"basics+headline",
			"education",
			"experience",
			"projects",
			"skills",
			"languages",
			"certifications",
			"summary",
		]);

		expect(blockIds(sampleResumeData, "job51").slice(0, 8)).toEqual([
			"basics+headline",
			"education",
			"experience",
			"skills",
			"languages",
			"projects",
			"certifications",
			"awards",
		]);
	});

	it("puts credentials right after the career narrative for liepin", () => {
		expect(blockIds(sampleResumeData, "liepin").slice(0, 8)).toEqual([
			"basics",
			"headline",
			"experience",
			"education",
			"projects",
			"certifications",
			"awards",
			"skills",
		]);
	});

	it("gives every platform its own order, and every one of them differs from generic", () => {
		const orders = new Map(RECRUITMENT_PLATFORMS.map((id) => [id, blockIds(sampleResumeData, id).join("|")]));
		const unique = new Set(orders.values());

		expect(unique.size).toBe(RECRUITMENT_PLATFORMS.length);
		expect(orders.get("boss")).not.toBe(orders.get("generic"));
	});

	it("pushes custom sections past every block the profile orders", () => {
		// No profile lists the custom section's id, so it can only ever trail the ordered blocks.
		// A7's own order is different on purpose: generic does not order it either, and there it keeps
		// its layout position (after `profiles`, before `languages`) rather than moving to the end.
		for (const platform of RECRUITMENT_PLATFORMS.filter((id) => id !== "generic")) {
			const ids = blockIds(sampleResumeData, platform);
			expect(ids.at(-1)).toBe(CUSTOM_SECTION_ID);
			expect(ids.indexOf(CUSTOM_SECTION_ID)).toBeGreaterThan(ids.indexOf("interests"));
		}

		const generic = blockIds(sampleResumeData, "generic");
		expect(generic.indexOf(CUSTOM_SECTION_ID)).toBeGreaterThan(generic.indexOf("profiles"));
		expect(generic.indexOf(CUSTOM_SECTION_ID)).toBeLessThan(generic.indexOf("languages"));
	});
});

describe("headings and labels per platform", () => {
	it("renames headings to the platform's vocabulary", () => {
		const titles = blockTitles(sampleResumeData, "boss");

		expect(titles).toContain("工作经验");
		expect(titles).toContain("项目经验");
		expect(titles).toContain("教育经历");
		expect(titles).toContain("专业技能");
		expect(titles).toContain("自我评价");
		// The resolver's English heading is gone, along with every other renamed one.
		expect(titles).not.toContain("Experience");
	});

	it("renames labels globally", () => {
		const basics = findBlock(sampleResumeData, "boss", "basics+headline");

		expect(basics.text).toContain("手机号：");
		expect(basics.text).not.toContain("手机：");
		expect(basics.text).toContain("所在城市：");
		expect(findBlock(sampleResumeData, "boss", "experience").text).toContain("职位名称：");
	});

	it("renames the same label differently per section", () => {
		const boss = (id: string) => findBlock(sampleResumeData, "boss", id).text;

		// A7 emits 时间 everywhere; each form asks for it in its own words.
		expect(boss("experience")).toContain("在职时间：");
		expect(boss("projects")).toContain("起止时间：");
		expect(boss("education")).toContain("在校时间：");
		expect(boss("education")).not.toContain("在职时间：");
	});

	it("still writes each field with the fullwidth colon and never a bare label", () => {
		const text = buildPlatformText(getResumeExportData(sampleResumeData), { platform: "zhilian", resolveTitle });

		expect(text).toContain("姓名：David Kowalski");
		expect(text.split("\n").filter((line) => line.endsWith("："))).toEqual([]);
		expect(text.endsWith("\n")).toBe(true);
		expect(text.endsWith("\n\n")).toBe(false);
	});
});

describe("求职意向 fields come from custom fields", () => {
	it("lifts recognised fields out of 基本信息 and into 求职意向", () => {
		const data = withCustomFields(["期望薪资：20k-30k", "到岗时间：一个月内"]);

		expect(findBlock(data, "liepin", "headline").text).toContain("期望薪资：20k-30k");
		expect(findBlock(data, "liepin", "headline").text).toContain("到岗时间：一个月内");
		expect(findBlock(data, "liepin", "basics").text).not.toContain("期望薪资：");
	});

	it("leaves them in 基本信息 for the generic profile", () => {
		const data = withCustomFields(["期望薪资：20k-30k"]);

		expect(findBlock(data, "generic", "basics").text).toContain("期望薪资：20k-30k");
		expect(findBlock(data, "generic", "headline").text).not.toContain("期望薪资：");
	});

	it("emits nothing for fields the user never filled in", () => {
		const headline = findBlock(sampleResumeData, "liepin", "headline").text;

		expect(headline).not.toContain("期望薪资");
		expect(headline).not.toContain("到岗时间");
		expect(headline).toContain("期望职位：");
	});

	it("prefers an explicit 期望职位 over the headline without printing both", () => {
		const headline = findBlock(withCustomFields(["期望职位：技术负责人"]), "liepin", "headline").text;

		expect(lineCountMatching(headline, "期望职位：")).toBe(1);
		expect(headline).toContain("期望职位：技术负责人");
	});
});

describe("visibility and emptiness still hold", () => {
	it("drops hidden sections for every platform", () => {
		const data = structuredClone(sampleResumeData);
		data.sections.education.hidden = true;

		for (const platform of RECRUITMENT_PLATFORMS) {
			expect(blockIds(data, platform)).not.toContain("education");
		}
	});

	it("drops hidden items and empty values", () => {
		const data = structuredClone(sampleResumeData);
		data.basics.phone = "";
		for (const item of data.sections.projects.items) item.hidden = true;

		for (const platform of RECRUITMENT_PLATFORMS) {
			const text = buildPlatformText(getResumeExportData(data), { platform, resolveTitle });
			expect(text).not.toContain("projects");
			expect(blockIds(data, platform)).not.toContain("projects");
			expect(text).not.toMatch(/^[^\n]*：\s*$/m);
		}
	});

	it("returns an empty document when the resume holds nothing exportable", () => {
		const data = structuredClone(sampleResumeData);
		data.basics = {
			name: "",
			headline: "",
			email: "",
			phone: "",
			location: "",
			website: { url: "", label: "" },
			customFields: [],
		};
		data.summary.hidden = true;
		for (const key of Object.keys(data.sections) as (keyof typeof data.sections)[]) {
			(data.sections[key] as { hidden: boolean }).hidden = true;
		}
		for (const page of data.metadata.layout.pages) {
			page.main = [];
			page.sidebar = [];
		}

		expect(buildPlatformText(getResumeExportData(data), { platform: "boss", resolveTitle })).toBe("");
		expect(buildPlatformBlocks(getResumeExportData(data), { platform: "boss", resolveTitle })).toEqual([]);
	});
});

describe("copy-paste blocks", () => {
	it("keeps block ids unique and text non-empty", () => {
		for (const platform of RECRUITMENT_PLATFORMS) {
			const result = blocks(sampleResumeData, platform);
			expect(result.length).toBeGreaterThan(0);
			expect(new Set(result.map((block) => block.id)).size).toBe(result.length);
			for (const block of result) expect(block.text.trim().length).toBeGreaterThan(0);
		}
	});

	it("assembles the document from its blocks", () => {
		const result = blocks(sampleResumeData, "boss");
		const expected = `${result
			.map((block) => block.text)
			.join("\n\n")
			.replace(/\n{3,}/g, "\n\n")
			.trim()}\n`;

		expect(buildPlatformText(getResumeExportData(sampleResumeData), { platform: "boss", resolveTitle })).toBe(expected);
	});

	it("splits 基本信息 and 求职意向 into separate blocks unless the profile groups them", () => {
		expect(blockIds(sampleResumeData, "liepin").slice(0, 2)).toEqual(["basics", "headline"]);
		expect(blockIds(sampleResumeData, "boss").slice(0, 1)).toEqual(["basics+headline"]);
		expect(findBlock(sampleResumeData, "boss", "basics+headline").title).toBe("基本信息 · 求职意向");
	});
});
