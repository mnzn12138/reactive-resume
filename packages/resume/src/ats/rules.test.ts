import type { ExperienceItem, ResumeData, SkillItem } from "@reactive-resume/schema/resume/data";
import { describe, expect, it } from "vitest";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { sampleResumeData } from "@reactive-resume/schema/resume/sample";
import { lintResumeForAts } from "./index";

const NOW = new Date("2024-06-15T00:00:00Z");

const experienceItem = (overrides: Partial<ExperienceItem> = {}): ExperienceItem => ({
	id: "exp-1",
	hidden: false,
	company: "Analytical Engines",
	position: "Engineer",
	location: "London",
	period: "Jan 2020 - Present",
	website: { url: "", label: "", inlineLink: false },
	description: "<p>Designed and shipped the difference engine.</p>",
	roles: [],
	...overrides,
});

function makeResume(mutate: (data: ResumeData) => void = () => undefined): ResumeData {
	const data = structuredClone(defaultResumeData);

	data.basics.name = "Ada Lovelace";
	data.basics.email = "ada@example.com";
	data.basics.phone = "+44 20 7946 0100";
	data.basics.location = "London, UK";
	data.sections.experience.items = [experienceItem()];
	data.metadata.layout.pages = [{ fullWidth: false, main: ["experience"], sidebar: [] }];

	mutate(data);
	return data;
}

const lint = (data: ResumeData) => lintResumeForAts(data, { now: NOW });
const codesOf = (data: ResumeData) => lint(data).findings.map((item) => item.code);

describe("lintResumeForAts", () => {
	it("reports nothing on a well-formed resume", () => {
		expect(lint(makeResume()).findings).toEqual([]);
	});

	it("counts every rule as passed when nothing fires", () => {
		const report = lint(makeResume());
		expect(report.passedRules).toBe(report.totalRules);
		expect(report.counts).toEqual({ error: 0, warning: 0, info: 0 });
	});

	it("flags the gaps in a blank resume", () => {
		const codes = codesOf(defaultResumeData);
		expect(codes).toContain("MISSING_NAME");
		expect(codes).toContain("MISSING_EMAIL");
		expect(codes).toContain("MISSING_PHONE");
		expect(codes).toContain("NO_VISIBLE_EXPERIENCE");
	});

	it("sorts findings by severity", () => {
		const report = lint(defaultResumeData);
		const severities = report.findings.map((item) => item.severity);
		expect(severities).toEqual([...severities].sort((a, b) => (a === b ? 0 : a === "error" ? -1 : 1)));
	});
});

describe("contact rules", () => {
	it("flags a malformed email instead of a missing one", () => {
		const codes = codesOf(makeResume((data) => (data.basics.email = "ada at example dot com")));
		expect(codes).toContain("MALFORMED_EMAIL");
		expect(codes).not.toContain("MISSING_EMAIL");
	});

	it("flags a link with no protocol", () => {
		const report = lint(makeResume((data) => (data.basics.website.url = "example.com/ada")));
		expect(report.findings).toContainEqual({
			code: "MALFORMED_URL",
			severity: "warning",
			pointer: "/basics/website/url",
			params: { value: "example.com/ada" },
		});
	});

	it("accepts mailto and tel links in custom fields", () => {
		const data = makeResume((resume) => {
			resume.basics.customFields = [
				{ id: "a", icon: "", text: "Mail", link: "mailto:ada@example.com" },
				{ id: "b", icon: "", text: "Phone", link: "tel:+442079460100" },
			];
		});
		expect(codesOf(data)).not.toContain("MALFORMED_URL");
	});

	it("notes a visible picture", () => {
		expect(codesOf(makeResume((data) => (data.picture.url = "/uploads/ada.png")))).toContain("PICTURE_PRESENT");
	});

	it("ignores a hidden picture", () => {
		const data = makeResume((resume) => {
			resume.picture.url = "/uploads/ada.png";
			resume.picture.hidden = true;
		});
		expect(codesOf(data)).not.toContain("PICTURE_PRESENT");
	});
});

describe("date rules", () => {
	it("flags an unreadable period at the offending item", () => {
		const data = makeResume((resume) => {
			resume.sections.experience.items = [experienceItem({ period: "a while back" })];
		});

		expect(lint(data).findings).toContainEqual({
			code: "UNPARSEABLE_PERIOD",
			severity: "error",
			pointer: "/sections/experience/items/0/period",
			params: { value: "a while back" },
		});
	});

	it("requires a period on experience", () => {
		const data = makeResume((resume) => {
			resume.sections.experience.items = [experienceItem({ period: "" })];
		});
		expect(codesOf(data)).toContain("EMPTY_PERIOD");
	});

	it("does not require a period on projects", () => {
		const data = makeResume((resume) => {
			resume.sections.projects.items = [
				{
					id: "p1",
					hidden: false,
					name: "Difference Engine",
					period: "",
					website: { url: "", label: "", inlineLink: false },
					description: "<p>A machine.</p>",
				},
			];
			resume.metadata.layout.pages = [{ fullWidth: false, main: ["experience", "projects"], sidebar: [] }];
		});

		expect(codesOf(data)).not.toContain("EMPTY_PERIOD");
	});

	it("flags an open-ended period with no start date", () => {
		const data = makeResume((resume) => {
			resume.sections.experience.items = [experienceItem({ period: "Present" })];
		});
		expect(codesOf(data)).toContain("UNPARSEABLE_PERIOD");
	});

	it("accepts a localized open-ended period", () => {
		const data = makeResume((resume) => {
			resume.metadata.page.locale = "de-DE";
			resume.sections.experience.items = [experienceItem({ period: "Jan 2020 - heute" })];
		});
		expect(codesOf(data)).not.toContain("UNPARSEABLE_PERIOD");
	});

	it("flags a period that runs backwards", () => {
		const data = makeResume((resume) => {
			resume.sections.experience.items = [experienceItem({ period: "Mar 2022 - Jan 2020" })];
		});
		expect(codesOf(data)).toContain("REVERSED_PERIOD");
	});

	it("flags a period starting in the future", () => {
		const data = makeResume((resume) => {
			resume.sections.experience.items = [experienceItem({ period: "Jan 2030 - Present" })];
		});
		expect(codesOf(data)).toContain("FUTURE_DATED_PERIOD");
	});

	it("checks periods on nested roles", () => {
		const data = makeResume((resume) => {
			resume.sections.experience.items = [
				experienceItem({
					roles: [{ id: "r1", position: "Junior Engineer", period: "whenever", description: "<p>Work.</p>" }],
				}),
			];
		});

		expect(lint(data).findings.map((item) => item.pointer)).toContain("/sections/experience/items/0/roles/0/period");
	});

	it("flags an unreadable single date", () => {
		const data = makeResume((resume) => {
			resume.sections.awards.items = [
				{
					id: "a1",
					hidden: false,
					title: "Turing Award",
					awarder: "ACM",
					date: "some time ago",
					website: { url: "", label: "", inlineLink: false },
					description: "",
				},
			];
			resume.metadata.layout.pages = [{ fullWidth: false, main: ["experience", "awards"], sidebar: [] }];
		});

		expect(codesOf(data)).toContain("UNPARSEABLE_DATE");
	});

	it("ignores hidden items", () => {
		const data = makeResume((resume) => {
			resume.sections.experience.items = [
				experienceItem(),
				experienceItem({ id: "exp-2", period: "???", hidden: true }),
			];
		});
		expect(codesOf(data)).not.toContain("UNPARSEABLE_PERIOD");
	});
});

describe("structure rules", () => {
	it("flags content that is never placed on a page", () => {
		const data = makeResume((resume) => {
			resume.sections.education.items = [
				{
					id: "e1",
					hidden: false,
					school: "University of London",
					degree: "BSc",
					area: "Mathematics",
					grade: "",
					location: "London",
					period: "2016 - 2019",
					website: { url: "", label: "", inlineLink: false },
					description: "",
				},
			];
		});

		expect(lint(data).findings).toContainEqual({
			code: "SECTION_MISSING_FROM_LAYOUT",
			severity: "error",
			pointer: "/sections/education",
			params: { section: "education" },
		});
	});

	it("stays quiet about a placed section with no items", () => {
		// Templates skip an empty section entirely — heading included — so there is nothing to fix.
		const data = makeResume((resume) => {
			resume.metadata.layout.pages = [{ fullWidth: false, main: ["experience", "skills"], sidebar: [] }];
		});
		expect(codesOf(data)).toEqual([]);
	});

	it("flags an experience entry with no narrative", () => {
		const data = makeResume((resume) => {
			resume.sections.experience.items = [experienceItem({ description: "<p></p>" })];
		});
		expect(codesOf(data)).toContain("MISSING_EXPERIENCE_DESCRIPTION");
	});

	it("accepts an experience entry whose narrative lives on its roles", () => {
		const data = makeResume((resume) => {
			resume.sections.experience.items = [
				experienceItem({
					description: "",
					roles: [{ id: "r1", position: "Engineer", period: "2020 - 2022", description: "<p>Shipped it.</p>" }],
				}),
			];
		});
		expect(codesOf(data)).not.toContain("MISSING_EXPERIENCE_DESCRIPTION");
	});

	it("counts a custom section of type experience as experience", () => {
		const data = makeResume((resume) => {
			resume.sections.experience.items = [];
			resume.customSections = [
				{
					id: "custom-exp",
					type: "experience",
					title: "Work Experience",
					icon: "briefcase",
					columns: 1,
					hidden: false,
					keepTogether: false,
					startOnNewPage: false,
					items: [experienceItem()],
				},
			];
			resume.metadata.layout.pages = [{ fullWidth: false, main: ["custom-exp"], sidebar: [] }];
		});

		expect(codesOf(data)).not.toContain("NO_VISIBLE_EXPERIENCE");
	});
});

describe("layout rules", () => {
	it("flags a prose section split into columns", () => {
		const data = makeResume((resume) => (resume.sections.experience.columns = 2));
		expect(codesOf(data)).toContain("MULTI_COLUMN_PROSE_SECTION");
	});

	it("flags a prose section parked in the sidebar", () => {
		const data = makeResume((resume) => {
			resume.metadata.layout.pages = [{ fullWidth: false, main: [], sidebar: ["experience"] }];
		});
		expect(codesOf(data)).toContain("PROSE_SECTION_IN_SIDEBAR");
	});

	it("treats a full-width page's sidebar as the main column", () => {
		const data = makeResume((resume) => {
			resume.metadata.layout.pages = [{ fullWidth: true, main: [], sidebar: ["experience"] }];
		});
		expect(codesOf(data)).not.toContain("PROSE_SECTION_IN_SIDEBAR");
	});

	it("leaves short-list sections in the sidebar alone", () => {
		const data = makeResume((resume) => {
			resume.sections.skills.items = [
				{
					id: "s1",
					hidden: false,
					icon: "",
					iconColor: "",
					name: "Mathematics",
					proficiency: "",
					level: 0,
					keywords: [],
				},
			];
			resume.metadata.layout.pages = [{ fullWidth: false, main: ["experience"], sidebar: ["skills"] }];
		});

		expect(codesOf(data)).not.toContain("PROSE_SECTION_IN_SIDEBAR");
	});
});

describe("title rules", () => {
	// `titleRules` only inspects English resumes, and `defaultResumeData` ships
	// with a zh-CN locale, so the locale has to be set explicitly here.
	const makeEnglishResume = (mutate: (data: ResumeData) => void = () => undefined) =>
		makeResume((resume) => {
			resume.metadata.page.locale = "en-US";
			mutate(resume);
		});

	it("flags an unconventional heading", () => {
		const data = makeEnglishResume((resume) => (resume.sections.experience.title = "Where I've Been"));
		expect(codesOf(data)).toContain("NON_STANDARD_SECTION_TITLE");
	});

	it("accepts a conventional heading regardless of case", () => {
		const data = makeEnglishResume((resume) => (resume.sections.experience.title = "Work Experience"));
		expect(codesOf(data)).not.toContain("NON_STANDARD_SECTION_TITLE");
	});

	it("stays quiet on a localized resume", () => {
		const data = makeResume((resume) => {
			resume.sections.experience.title = "工作经历";
			resume.metadata.page.locale = "zh-CN";
		});
		expect(codesOf(data)).not.toContain("NON_STANDARD_SECTION_TITLE");
	});
});

describe("typography rules", () => {
	it("flags a small body font", () => {
		expect(codesOf(makeResume((data) => (data.metadata.typography.body.fontSize = 8)))).toContain("SMALL_BODY_FONT");
	});

	it("flags a tight line height", () => {
		expect(codesOf(makeResume((data) => (data.metadata.typography.body.lineHeight = 1)))).toContain(
			"TIGHT_LINE_HEIGHT",
		);
	});

	it("flags each tight margin axis", () => {
		const data = makeResume((resume) => {
			resume.metadata.page.marginX = 4;
			resume.metadata.page.marginY = 4;
		});

		expect(
			lint(data)
				.findings.filter((item) => item.code === "TIGHT_PAGE_MARGINS")
				.map((item) => item.pointer),
		).toEqual(["/metadata/page/marginX", "/metadata/page/marginY"]);
	});
});

const PRIVATE_USE_SAMPLE = "";

const skillsItem = (overrides: Partial<SkillItem> = {}): SkillItem => ({
	id: "s1",
	hidden: false,
	icon: "",
	iconColor: "",
	name: "Mathematics",
	proficiency: "",
	level: 0,
	keywords: [],
	...overrides,
});

describe("domestic parser rules: two-column layout", () => {
	it("flags a page that carries content in both columns", () => {
		const data = makeResume((resume) => {
			resume.sections.skills.items = [skillsItem()];
			resume.metadata.layout.pages = [{ fullWidth: false, main: ["experience"], sidebar: ["skills"] }];
		});

		expect(lint(data).findings).toContainEqual({
			code: "TWO_COLUMN_PAGE_LAYOUT",
			severity: "warning",
			pointer: "/metadata/layout/pages/0",
			params: { page: 0 },
		});
	});

	it("stays quiet when the page has no side column", () => {
		expect(codesOf(makeResume())).not.toContain("TWO_COLUMN_PAGE_LAYOUT");
	});

	it("stays quiet on a full-width page", () => {
		const data = makeResume((resume) => {
			resume.sections.skills.items = [skillsItem()];
			resume.metadata.layout.pages = [{ fullWidth: true, main: ["experience"], sidebar: ["skills"] }];
		});

		expect(codesOf(data)).not.toContain("TWO_COLUMN_PAGE_LAYOUT");
	});

	it("stays quiet when only one of the two columns carries anything", () => {
		const data = makeResume((resume) => {
			resume.metadata.layout.pages = [{ fullWidth: false, main: ["experience"], sidebar: ["skills"] }];
		});

		expect(codesOf(data)).not.toContain("TWO_COLUMN_PAGE_LAYOUT");
	});
});

describe("domestic parser rules: tables", () => {
	it("flags an experience entry written inside a table", () => {
		const data = makeResume((resume) => {
			resume.sections.experience.items = [
				experienceItem({ description: "<table><tbody><tr><td>Shipped the engine.</td></tr></tbody></table>" }),
			];
		});

		expect(lint(data).findings).toContainEqual({
			code: "ENTRY_CONTENT_IN_TABLE",
			severity: "warning",
			pointer: "/sections/experience/items/0/description",
		});
	});

	it("stays quiet about an ordinary bullet list", () => {
		const data = makeResume((resume) => {
			resume.sections.experience.items = [experienceItem({ description: "<ul><li>Shipped it.</li></ul>" })];
		});

		expect(codesOf(data)).not.toContain("ENTRY_CONTENT_IN_TABLE");
	});
});

describe("domestic parser rules: images and icons", () => {
	it("flags an entry that renders an image and no text", () => {
		const data = makeResume((resume) => {
			resume.sections.experience.items = [experienceItem({ description: '<p><img src="/uploads/chart.png" /></p>' })];
		});

		expect(lint(data).findings).toContainEqual({
			code: "ENTRY_CONTENT_IMAGE_ONLY",
			severity: "warning",
			pointer: "/sections/experience/items/0/description",
		});
	});

	it("stays quiet when the image has text beside it", () => {
		const data = makeResume((resume) => {
			resume.sections.experience.items = [
				experienceItem({ description: '<p><img src="/uploads/chart.png" /> Revenue doubled.</p>' }),
			];
		});

		expect(codesOf(data)).not.toContain("ENTRY_CONTENT_IMAGE_ONLY");
	});

	it("flags a contact field that is nothing but an icon", () => {
		const data = makeResume((resume) => {
			resume.basics.customFields = [{ id: "a", icon: "phone", text: "", link: "" }];
		});

		expect(lint(data).findings).toContainEqual({
			code: "ICON_ONLY_CUSTOM_FIELD",
			severity: "info",
			pointer: "/basics/customFields/0/icon",
		});
	});

	it("stays quiet about a contact field that carries text", () => {
		const data = makeResume((resume) => {
			resume.basics.customFields = [{ id: "a", icon: "phone", text: "政治面貌：中共党员", link: "" }];
		});

		expect(codesOf(data)).not.toContain("ICON_ONLY_CUSTOM_FIELD");
	});
});

describe("domestic parser rules: timeline", () => {
	it("flags a period that starts but never ends", () => {
		const data = makeResume((resume) => {
			resume.sections.experience.items = [experienceItem({ period: "2020.03" })];
		});

		expect(lint(data).findings).toContainEqual({
			code: "INCOMPLETE_PERIOD",
			severity: "warning",
			pointer: "/sections/experience/items/0/period",
			params: { value: "2020.03" },
		});
	});

	it("stays quiet about a period that ends in an ongoing marker", () => {
		const data = makeResume((resume) => {
			resume.sections.experience.items = [experienceItem({ period: "2020.03 - 至今" })];
		});

		expect(codesOf(data)).not.toContain("INCOMPLETE_PERIOD");
	});

	it("reads the domestic year-month spelling rather than calling it unreadable", () => {
		const data = makeResume((resume) => {
			resume.sections.experience.items = [experienceItem({ period: "2020.03 - 2022.06" })];
		});

		expect(codesOf(data)).not.toContain("UNPARSEABLE_PERIOD");
	});

	it("flags a date typed with fullwidth digits", () => {
		const value = "２０２０.０３ - ２０２２.０６";
		const data = makeResume((resume) => {
			resume.sections.experience.items = [experienceItem({ period: value })];
		});

		expect(lint(data).findings).toContainEqual({
			code: "FULLWIDTH_DATE_CHARACTER",
			severity: "warning",
			pointer: "/sections/experience/items/0/period",
			params: { value },
		});
	});

	it("flags an experience entry with no job title", () => {
		const data = makeResume((resume) => {
			resume.sections.experience.items = [experienceItem({ position: "" })];
		});

		expect(lint(data).findings).toContainEqual({
			code: "MISSING_EXPERIENCE_POSITION",
			severity: "warning",
			pointer: "/sections/experience/items/0/position",
		});
	});

	it("stays quiet when the title lives on a nested role", () => {
		const data = makeResume((resume) => {
			resume.sections.experience.items = [
				experienceItem({
					position: "",
					roles: [{ id: "r1", position: "Engineer", period: "2020 - 2022", description: "<p>Shipped it.</p>" }],
				}),
			];
		});

		expect(codesOf(data)).not.toContain("MISSING_EXPERIENCE_POSITION");
	});
});

describe("domestic parser rules: characters", () => {
	it("flags a private use area glyph", () => {
		const data = makeResume((resume) => {
			resume.basics.headline = `Engineer ${PRIVATE_USE_SAMPLE}`;
		});

		expect(lint(data).findings).toContainEqual({
			code: "TEXT_PRIVATE_USE_CHARACTER",
			severity: "warning",
			pointer: "/basics/headline",
		});
	});

	it("stays quiet about the fullwidth punctuation a Chinese resume is written in", () => {
		const data = makeResume((resume) => {
			resume.basics.headline = "资深工程师：平台方向";
		});

		expect(codesOf(data)).not.toContain("TEXT_PRIVATE_USE_CHARACTER");
	});

	it("flags a decorative glyph used as a bullet", () => {
		const data = makeResume((resume) => {
			resume.sections.experience.items = [experienceItem({ description: "<p>◆ Shipped the engine.</p>" })];
		});

		expect(lint(data).findings).toContainEqual({
			code: "NON_STANDARD_BULLET_CHARACTER",
			severity: "info",
			pointer: "/sections/experience/items/0/description",
			params: { character: "◆" },
		});
	});

	it("stays quiet about a plain bullet and about the same glyph mid-sentence", () => {
		const data = makeResume((resume) => {
			resume.sections.experience.items = [
				experienceItem({ description: "<ul><li>• Shipped the engine.</li><li>获奖 ◆ 年度最佳</li></ul>" }),
			];
		});

		expect(codesOf(data)).not.toContain("NON_STANDARD_BULLET_CHARACTER");
	});
});

describe("sample resume", () => {
	it("raises no errors on the resume the product ships as its example", () => {
		expect(lint(sampleResumeData).findings.filter((item) => item.severity === "error")).toEqual([]);
	});
});
