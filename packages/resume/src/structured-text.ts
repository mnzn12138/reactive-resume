import type { CustomSection, CustomSectionType, ResumeData, SectionType } from "@reactive-resume/schema/resume/data";
import type { SectionTitleResolver } from "./markdown";
import {
	customFieldKeyLabels,
	customFieldKeySchema,
	customFieldKeySeparator,
} from "@reactive-resume/schema/resume/data";
import { htmlToMarkdown } from "./markdown";

type Sections = ResumeData["sections"];
type Website = ResumeData["basics"]["website"];

/** One copy-pasteable line: `标签：值`. */
export type StructuredField = { label: string; value: string };

/** A group of fields under a heading — the shape a recruitment form page takes. */
export type StructuredSection = { title: string; fields: StructuredField[] };

/** Fullwidth colon, matching `customFieldKeySeparator` used elsewhere in this fork. */
const FIELD_SEPARATOR = customFieldKeySeparator;

/** Joins several values that share one label — same separator `buildMarkdown` uses. */
const VALUE_SEPARATOR = " · ";

const BASICS_TITLE = "基本信息";
const INTENTION_TITLE = "求职意向";
const INTENTION_LABEL = "求职意向";
const SELF_EVALUATION_LABEL = "自我评价";
/** Used for a custom field that carries no semantic key and no label of its own. */
const FALLBACK_CUSTOM_FIELD_LABEL = "其他";

/**
 * Fixed recruitment-form order — deliberately *not* the layout order, because the point of this
 * export is that a candidate can walk a Chinese job site's form top to bottom and copy field by
 * field. `basics` and `headline` are synthetic blocks derived from `data.basics`; every other id
 * maps onto a built-in or custom section.
 *
 * Any section that is *not* listed here is still emitted, appended last in layout order.
 */
export const STRUCTURED_SECTION_ORDER = [
	"basics",
	"headline",
	"education",
	"experience",
	"projects",
	"skills",
	"certifications",
	"awards",
	"summary",
] as const;

/**
 * Serializes resume data to structured plain text: one `标签：值` line per field, grouped under
 * section headings, ordered the way a recruitment form is ordered.
 *
 * This is intentionally a different shape from `buildMarkdown`, which emits a single prose
 * document aimed at feeding an LLM. Scope the input first with `getResumeExportData(data)`.
 */
export function buildStructuredSections(data: ResumeData, resolveTitle?: SectionTitleResolver): StructuredSection[] {
	const sections: StructuredSection[] = [];
	const emitted = new Set<string>();

	const push = (section: StructuredSection | undefined) => {
		if (section && section.fields.length > 0) sections.push(section);
	};

	for (const blockId of STRUCTURED_SECTION_ORDER) {
		if (blockId === "basics") {
			push({ title: BASICS_TITLE, fields: renderBasics(data) });
			continue;
		}

		if (blockId === "headline") {
			push({
				title: INTENTION_TITLE,
				fields: compact([field(INTENTION_LABEL, data.basics.headline)]),
			});
			continue;
		}

		emitted.add(blockId);
		push(renderSection(blockId, data, resolveTitle));
	}

	// Everything the fixed order did not cover keeps the layout order `buildMarkdown` walks.
	for (const page of data.metadata.layout.pages) {
		for (const sectionId of [...page.main, ...page.sidebar]) {
			if (emitted.has(sectionId)) continue;
			emitted.add(sectionId);
			push(renderSection(sectionId, data, resolveTitle));
		}
	}

	return sections;
}

/** Renders {@link buildStructuredSections} as text: a heading line, then its `标签：值` lines. */
export function buildStructuredText(data: ResumeData, resolveTitle?: SectionTitleResolver): string {
	const blocks = buildStructuredSections(data, resolveTitle).map(renderBlock).filter(Boolean);

	if (blocks.length === 0) return "";

	// Collapse runs of blank lines into a clean document with exactly one trailing newline.
	return `${blocks
		.join("\n\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim()}\n`;
}

function renderBlock(section: StructuredSection): string {
	// Mirrors `heading()` in markdown.ts: a section with no resolvable title has no heading line.
	const lines = section.title ? [section.title] : [];
	for (const { label, value } of section.fields) lines.push(`${label}${FIELD_SEPARATOR}${value}`);
	return lines.join("\n");
}

// --- Basics (基本信息 / 求职意向) ---

/**
 * 姓名 first, then the domestic fields in `customFieldKeySchema` enum order, then custom fields
 * without a semantic key, then the plain contact fields.
 */
function renderBasics(data: ResumeData): StructuredField[] {
	const basics = data.basics;
	const fields: StructuredField[] = compact([field("姓名", basics.name)]);

	for (const key of customFieldKeySchema.options) {
		const custom = basics.customFields.find((item) => item.key === key);
		if (!custom) continue;
		fields.push(...compact([field(customFieldKeyLabels[key][0], valueAfterSeparator(custom.text))]));
	}

	for (const custom of basics.customFields) {
		if (custom.key !== undefined) continue;
		fields.push(...compact([splitCustomField(custom.text)]));
	}

	fields.push(
		...compact([
			field("手机", basics.phone),
			field("邮箱", basics.email),
			field("所在地", basics.location),
			field("网址", websiteValue(basics.website)),
		]),
	);

	return fields;
}

/** Everything after the first colon, or the whole text when the field is a bare value. */
function valueAfterSeparator(text: string): string {
	const parsed = splitOnSeparator(text);
	return parsed ? parsed.value : text.trim();
}

function splitCustomField(text: string): StructuredField | undefined {
	const parsed = splitOnSeparator(text);
	if (!parsed) return field(FALLBACK_CUSTOM_FIELD_LABEL, text);
	return field(parsed.label, parsed.value);
}

/** Splits on the first colon; the fullwidth one wins so both spellings behave identically. */
function splitOnSeparator(text: string): { label: string; value: string } | undefined {
	const fullwidthIndex = text.indexOf(customFieldKeySeparator);
	const index = fullwidthIndex >= 0 ? fullwidthIndex : text.indexOf(":");
	if (index < 0) return undefined;

	const label = text.slice(0, index).trim();
	const value = text.slice(index + 1).trim();
	if (label.length === 0) return undefined;

	return { label, value };
}

// --- Shared helpers ---

/** Builds a field, or `undefined` when the value is empty — a bare `标签：` is never emitted. */
function field(label: string, value: string | undefined): StructuredField | undefined {
	const text = (value ?? "").trim();
	return text.length > 0 ? { label, value: text } : undefined;
}

function compact(fields: (StructuredField | undefined)[]): StructuredField[] {
	return fields.filter((item): item is StructuredField => item !== undefined);
}

const websiteValue = (website: Website | undefined) => (website?.label || website?.url || "").trim();

/** Rich text is flattened with `htmlToMarkdown`, the same converter `buildMarkdown` uses. */
const richText = (html: string | undefined) => htmlToMarkdown(html ?? "");

function visibleItems<T extends { hidden: boolean }>(section: { hidden: boolean; items: T[] }): T[] {
	if (section.hidden) return [];
	return section.items.filter((item) => !item.hidden);
}

// --- Section renderers ---

function renderExperience(section: Sections["experience"]): StructuredField[] {
	const fields: StructuredField[] = [];
	for (const item of visibleItems(section)) {
		fields.push(
			...compact([field("公司名称", item.company), field("时间", item.period), field("地点", item.location)]),
		);

		if (item.roles.length > 0) {
			// Several roles inside one company share a single 职位 line, joined like buildMarkdown does.
			const positions = item.roles.map((role) => [role.position, role.period].filter(Boolean).join(VALUE_SEPARATOR));
			const descriptions = item.roles.map((role) => richText(role.description)).filter(Boolean);
			fields.push(
				...compact([
					field("职位", positions.filter(Boolean).join(VALUE_SEPARATOR)),
					field("工作描述", descriptions.join("\n")),
				]),
			);
		} else {
			fields.push(...compact([field("职位", item.position), field("工作描述", richText(item.description))]));
		}

		fields.push(...compact([field("网址", websiteValue(item.website))]));
	}
	return fields;
}

function renderEducation(section: Sections["education"]): StructuredField[] {
	const fields: StructuredField[] = [];
	for (const item of visibleItems(section)) {
		fields.push(
			...compact([
				field("学校", item.school),
				field("学历", item.degree),
				field("专业", item.area),
				field("时间", item.period),
				field("地点", item.location),
				field("成绩", item.grade),
				field("描述", richText(item.description)),
				field("网址", websiteValue(item.website)),
			]),
		);
	}
	return fields;
}

function renderProjects(section: Sections["projects"]): StructuredField[] {
	const fields: StructuredField[] = [];
	for (const item of visibleItems(section)) {
		fields.push(
			...compact([
				field("项目名称", item.name),
				field("时间", item.period),
				field("描述", richText(item.description)),
				field("网址", websiteValue(item.website)),
			]),
		);
	}
	return fields;
}

function renderSkills(section: Sections["skills"]): StructuredField[] {
	const fields: StructuredField[] = [];
	for (const item of visibleItems(section)) {
		fields.push(
			...compact([
				field("技能名称", item.name),
				field("熟练度", item.proficiency),
				field("关键词", item.keywords.filter(Boolean).join(", ")),
			]),
		);
	}
	return fields;
}

function renderLanguages(section: Sections["languages"]): StructuredField[] {
	const fields: StructuredField[] = [];
	for (const item of visibleItems(section)) {
		fields.push(...compact([field("语言", item.language), field("熟练度", item.fluency)]));
	}
	return fields;
}

function renderInterests(section: Sections["interests"]): StructuredField[] {
	const fields: StructuredField[] = [];
	for (const item of visibleItems(section)) {
		fields.push(...compact([field("兴趣", item.name), field("关键词", item.keywords.filter(Boolean).join(", "))]));
	}
	return fields;
}

function renderProfiles(section: Sections["profiles"]): StructuredField[] {
	const fields: StructuredField[] = [];
	for (const item of visibleItems(section)) {
		fields.push(
			...compact([
				field("平台", item.network),
				field("用户名", item.username),
				field("网址", websiteValue(item.website)),
			]),
		);
	}
	return fields;
}

function renderReferences(section: Sections["references"]): StructuredField[] {
	const fields: StructuredField[] = [];
	for (const item of visibleItems(section)) {
		fields.push(
			...compact([
				field("姓名", item.name),
				field("职位", item.position),
				field("电话", item.phone),
				field("网址", websiteValue(item.website)),
			]),
		);
	}
	return fields;
}

function renderAwards(section: Sections["awards"]): StructuredField[] {
	const fields: StructuredField[] = [];
	for (const item of visibleItems(section)) {
		fields.push(
			...compact([
				field("奖项名称", item.title),
				field("颁发机构", item.awarder),
				field("时间", item.date),
				field("描述", richText(item.description)),
				field("网址", websiteValue(item.website)),
			]),
		);
	}
	return fields;
}

function renderCertifications(section: Sections["certifications"]): StructuredField[] {
	const fields: StructuredField[] = [];
	for (const item of visibleItems(section)) {
		fields.push(
			...compact([
				field("证书名称", item.title),
				field("颁发机构", item.issuer),
				field("时间", item.date),
				field("描述", richText(item.description)),
				field("网址", websiteValue(item.website)),
			]),
		);
	}
	return fields;
}

function renderPublications(section: Sections["publications"]): StructuredField[] {
	const fields: StructuredField[] = [];
	for (const item of visibleItems(section)) {
		fields.push(
			...compact([
				field("标题", item.title),
				field("出版社", item.publisher),
				field("时间", item.date),
				field("描述", richText(item.description)),
				field("网址", websiteValue(item.website)),
			]),
		);
	}
	return fields;
}

function renderVolunteer(section: Sections["volunteer"]): StructuredField[] {
	const fields: StructuredField[] = [];
	for (const item of visibleItems(section)) {
		fields.push(
			...compact([
				field("组织", item.organization),
				field("时间", item.period),
				field("描述", richText(item.description)),
				field("网址", websiteValue(item.website)),
			]),
		);
	}
	return fields;
}

const sectionFieldRenderers: Record<SectionType, (section: Sections[SectionType]) => StructuredField[]> = {
	experience: renderExperience as (s: Sections[SectionType]) => StructuredField[],
	education: renderEducation as (s: Sections[SectionType]) => StructuredField[],
	projects: renderProjects as (s: Sections[SectionType]) => StructuredField[],
	skills: renderSkills as (s: Sections[SectionType]) => StructuredField[],
	languages: renderLanguages as (s: Sections[SectionType]) => StructuredField[],
	interests: renderInterests as (s: Sections[SectionType]) => StructuredField[],
	profiles: renderProfiles as (s: Sections[SectionType]) => StructuredField[],
	references: renderReferences as (s: Sections[SectionType]) => StructuredField[],
	awards: renderAwards as (s: Sections[SectionType]) => StructuredField[],
	certifications: renderCertifications as (s: Sections[SectionType]) => StructuredField[],
	publications: renderPublications as (s: Sections[SectionType]) => StructuredField[],
	volunteer: renderVolunteer as (s: Sections[SectionType]) => StructuredField[],
};

function renderSection(
	sectionId: string,
	data: ResumeData,
	resolveTitle?: SectionTitleResolver,
): StructuredSection | undefined {
	// Stored titles are empty by default and resolved (locale-aware) by the caller.
	const title = resolveTitle?.(sectionId)?.trim() || "";

	if (sectionId === "summary") {
		const summary = data.summary;
		if (summary.hidden) return undefined;
		const fields = compact([field(SELF_EVALUATION_LABEL, richText(summary.content))]);
		return fields.length > 0 ? { title: title || summary.title, fields } : undefined;
	}

	if (sectionId in data.sections) {
		const type = sectionId as SectionType;
		const section = data.sections[type];
		if (!section) return undefined;
		const fields = sectionFieldRenderers[type]?.(section) ?? [];
		return fields.length > 0 ? { title: title || section.title, fields } : undefined;
	}

	const customSection = data.customSections.find((cs) => cs.id === sectionId);
	if (!customSection) return undefined;
	const fields = renderCustomSection(customSection);
	return fields.length > 0 ? { title: title || customSection.title, fields } : undefined;
}

function renderCustomSection(section: CustomSection): StructuredField[] {
	const items = visibleItems(section);
	if (items.length === 0) return [];

	const sectionType = section.type as CustomSectionType;

	if (sectionType === "summary") {
		const fields: StructuredField[] = [];
		for (const item of items) {
			if ("content" in item && typeof item.content === "string") {
				fields.push(...compact([field("内容", richText(item.content))]));
			}
		}
		return fields;
	}

	if (sectionType in sectionFieldRenderers) {
		const synthetic = {
			title: section.title,
			hidden: false,
			columns: section.columns,
			items,
		} as Sections[SectionType];
		return sectionFieldRenderers[sectionType as SectionType]?.(synthetic) ?? [];
	}

	return [];
}
