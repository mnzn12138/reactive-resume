import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { SectionTitleResolver } from "./markdown";
import type { PlatformId, PlatformProfile } from "./platform-profiles";
import type { StructuredSection } from "./structured-text";
import { customFieldKeySeparator } from "@reactive-resume/schema/resume/data";
import { getPlatformProfile } from "./platform-profiles";
import { BASICS_BLOCK_ID, buildStructuredSections, INTENTION_BLOCK_ID } from "./structured-text";

/** Fullwidth colon, the same separator {@link buildStructuredSections} writes between label and value. */
const FIELD_SEPARATOR = customFieldKeySeparator;

/** One chunk of copy-pasteable text: a heading followed by its `标签：值` lines. */
export type PlatformBlock = { id: string; title: string; text: string };

export type BuildPlatformOptions = {
	/** A {@link PlatformId}. Anything unrecognised silently resolves to the generic profile. */
	platform: PlatformId | string;
	/** Resolves locale-aware section headings, exactly as in {@link buildStructuredSections}. */
	resolveTitle?: SectionTitleResolver;
};

/**
 * Renders resume data the way one recruitment site's online form is laid out.
 *
 * This is a layer *on top of* {@link buildStructuredSections}: it reuses that renderer unchanged and
 * only reshapes its output — reorder blocks, rename headings and labels, lift 求职意向 fields out of
 * 基本信息, and cut the result into copy-pasteable blocks. Nothing here re-implements the A7
 * rendering (rich text flattening, `hidden` filtering, empty-value omission included), and the
 * `generic` profile is byte-identical to {@link buildStructuredText}.
 *
 * Scope the input first with `getResumeExportData(data)`.
 */
export function buildPlatformBlocks(data: ResumeData, options: BuildPlatformOptions): PlatformBlock[] {
	const profile = getPlatformProfile(options.platform);
	const sections = orderSections(buildStructuredSections(data, options.resolveTitle), profile);

	const reshaped = dedupeIntentionLabels(applyAliases(promoteIntentionFields(sections, profile), profile), profile);

	return groupSections(reshaped, profile)
		.filter((group) => group.some((section) => section.fields.length > 0))
		.map(toBlock);
}

/** Renders {@link buildPlatformBlocks} as one document: blocks joined by a blank line. */
export function buildPlatformText(data: ResumeData, options: BuildPlatformOptions): string {
	const blocks = buildPlatformBlocks(data, options)
		.map((block) => block.text)
		.filter(Boolean);

	if (blocks.length === 0) return "";

	// Same clean-up `buildStructuredText` applies: no blank-line runs, one trailing newline.
	return `${blocks
		.join("\n\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim()}\n`;
}

// --- Pipeline steps ---

/** Stable sort by the profile's order; blocks it does not list keep their place and trail the rest. */
function orderSections(sections: StructuredSection[], profile: PlatformProfile): StructuredSection[] {
	const rank = (id: string) => {
		const index = profile.sectionOrder.indexOf(id);
		return index < 0 ? Number.MAX_SAFE_INTEGER : index;
	};

	return [...sections].sort((left, right) => rank(left.id) - rank(right.id));
}

/**
 * Moves recognised 求职意向 fields out of 基本信息 into the 求职意向 block.
 *
 * Those fields have no home in the resume schema — 期望薪资, 到岗时间, 当前状态 — so they live in
 * `basics.customFields` as free text and surface in 基本信息 by default. Lifting them puts them next
 * to the 期望职位 the headline already provides, which is where every one of these forms asks for
 * them. Nothing is invented: absent fields simply never appear.
 */
function promoteIntentionFields(sections: StructuredSection[], profile: PlatformProfile): StructuredSection[] {
	if (profile.intentionLabels.length === 0) return sections;

	const basics = sections.find((section) => section.id === BASICS_BLOCK_ID);
	const intention = sections.find((section) => section.id === INTENTION_BLOCK_ID);
	if (!basics || !intention) return sections;

	const wanted = new Set(profile.intentionLabels);
	const promoted = basics.fields.filter((field) => wanted.has(field.label));
	if (promoted.length === 0) return sections;

	const remaining = basics.fields.filter((field) => !wanted.has(field.label));

	return sections
		.map((section) => {
			if (section.id === BASICS_BLOCK_ID) return { ...section, fields: remaining };
			// Explicit user data first: it wins over the headline-derived line when both carry the
			// same label (see `dedupeIntentionLabels`).
			if (section.id === INTENTION_BLOCK_ID) return { ...section, fields: [...promoted, ...section.fields] };
			return section;
		})
		.filter((section) => section.fields.length > 0);
}

/** Applies the profile's heading and label vocabulary. Per-block labels win over global ones. */
function applyAliases(sections: StructuredSection[], profile: PlatformProfile): StructuredSection[] {
	return sections.map((section) => {
		const overrides = profile.sectionFieldLabels[section.id] ?? {};

		return {
			id: section.id,
			title: profile.sectionTitles[section.id] ?? section.title,
			fields: section.fields.map((field) => ({
				label: overrides[field.label] ?? profile.fieldLabels[field.label] ?? field.label,
				value: field.value,
			})),
		};
	});
}

/** Keeps the first line per label inside 求职意向, so the same field never prints twice. */
function dedupeIntentionLabels(sections: StructuredSection[], profile: PlatformProfile): StructuredSection[] {
	if (profile.intentionLabels.length === 0) return sections;

	return sections.map((section) => {
		if (section.id !== INTENTION_BLOCK_ID) return section;

		const seen = new Set<string>();
		const fields = section.fields.filter((field) => {
			if (seen.has(field.label)) return false;
			seen.add(field.label);
			return true;
		});

		return { ...section, fields };
	});
}

/** Cuts ordered sections into chunks, collapsing the profile's groups. Everything else stands alone. */
function groupSections(sections: StructuredSection[], profile: PlatformProfile): StructuredSection[][] {
	const groups = profile.blockGroups.filter((group) => group.length > 0);
	const consumed = new Set<string>();
	const result: StructuredSection[][] = [];

	for (const section of sections) {
		if (consumed.has(section.id)) continue;
		consumed.add(section.id);

		const group = groups.find((ids) => ids.includes(section.id));
		if (!group) {
			result.push([section]);
			continue;
		}

		const members = group
			.map((id) => sections.find((candidate) => candidate.id === id && candidate.id !== section.id))
			.filter((candidate): candidate is StructuredSection => candidate !== undefined && !consumed.has(candidate.id));

		for (const member of members) consumed.add(member.id);
		result.push([section, ...members]);
	}

	return result;
}

function toBlock(group: StructuredSection[]): PlatformBlock {
	return {
		id: group.map((section) => section.id).join("+"),
		title: group
			.map((section) => section.title)
			.filter((title) => title.length > 0)
			.join(" · "),
		text: renderGroup(group),
	};
}

/** Section rendering, mirroring `renderBlock` in structured-text.ts, for one or more sections. */
function renderGroup(group: StructuredSection[]): string {
	return group
		.map(renderSection)
		.filter(Boolean)
		.join("\n\n")
		.replace(/\n{3,}/g, "\n\n");
}

function renderSection(section: StructuredSection): string {
	// A section with no resolvable title contributes no heading line, same as A7.
	const lines = section.title ? [section.title] : [];
	for (const { label, value } of section.fields) lines.push(`${label}${FIELD_SEPARATOR}${value}`);
	return lines.join("\n");
}
