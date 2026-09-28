import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { SectionPreset, SectionType } from "@reactive-resume/schema/resume/section-presets";
import { sectionTypeSchema } from "@reactive-resume/schema/resume/data";
import { partitionPresetSectionIds, sectionPresets } from "@reactive-resume/schema/resume/section-presets";

type BuiltInSectionType = Exclude<SectionType, "summary">;

/**
 * Rewrites the first page's column assignment and per-section visibility to
 * match a preset, in place (an immer draft is expected).
 *
 * Custom sections are preserved: they are appended to the main column so a
 * preset can reorder and show/hide built-in sections without ever deleting
 * sections the user added themselves.
 *
 * Does nothing when the resume has no pages.
 */
export const applySectionPreset = (data: ResumeData, preset: SectionPreset): void => {
	const layout = sectionPresets[preset];
	const page = data.metadata.layout.pages[0];
	if (!page) return;

	const { custom } = partitionPresetSectionIds([...page.main, ...page.sidebar]);

	page.main = [...layout.main, ...custom];
	page.sidebar = [...layout.sidebar];

	for (const type of sectionTypeSchema.options) {
		const hidden = layout.hidden.includes(type);

		if (type === "summary") {
			data.summary.hidden = hidden;
			continue;
		}

		const section = data.sections[type as BuiltInSectionType];
		if (section) section.hidden = hidden;
	}
};

/** Returns the preset whose layout matches the given page, or undefined when none does. */
export const findMatchingSectionPreset = (data: ResumeData): SectionPreset | undefined => {
	const page = data.metadata.layout.pages[0];
	if (!page) return undefined;

	for (const preset of Object.keys(sectionPresets) as SectionPreset[]) {
		const layout = sectionPresets[preset];
		const { builtIn } = partitionPresetSectionIds(page.main);

		if (builtIn.join(",") !== layout.main.join(",")) continue;
		if (page.sidebar.join(",") !== layout.sidebar.join(",")) continue;

		return preset;
	}

	return undefined;
};
