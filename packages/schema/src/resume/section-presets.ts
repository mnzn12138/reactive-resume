import z from "zod";
import { sectionTypeSchema } from "./data";

/**
 * Section presets for the layout editor.
 *
 * A preset is pure data: an ordering of the built-in sections across the main
 * and sidebar columns, plus the sections it hides. The display names live in the
 * web app (`packages/pdf` has no i18n runtime and this package must not carry
 * translatable strings at module scope).
 *
 * Applying a preset never drops custom sections — see `applySectionPreset`.
 */
export const sectionPresetSchema = z.enum(["standard", "cnCampus", "cnExperienced", "cnPublicSector"]);

export type SectionPreset = z.infer<typeof sectionPresetSchema>;
export type SectionType = z.infer<typeof sectionTypeSchema>;

export type SectionPresetLayout = {
	/** Built-in section ids in display order for the primary column. */
	main: readonly SectionType[];
	/** Built-in section ids in display order for the sidebar column. */
	sidebar: readonly SectionType[];
	/** Built-in sections the preset hides entirely. */
	hidden: readonly SectionType[];
};

/**
 * Annotated rather than `as const`: a const assertion narrows each preset's
 * `hidden` to its own literal tuple, and calling `.includes()` on the union of
 * those tuples collapses the parameter type to `never`.
 */
export const sectionPresets: Record<SectionPreset, SectionPresetLayout> = {
	standard: {
		main: ["profiles", "summary", "education", "experience", "projects", "volunteer", "references"],
		sidebar: ["skills", "certifications", "awards", "languages", "interests", "publications"],
		hidden: [],
	},
	// Campus recruitment: education leads, because a graduate's degree is the
	// strongest signal. References and publications are noise at this stage.
	cnCampus: {
		main: ["profiles", "summary", "education", "experience", "projects", "volunteer", "awards"],
		sidebar: ["skills", "certifications", "languages", "interests"],
		hidden: ["references", "publications"],
	},
	// Experienced hire: work history leads and education drops below it.
	cnExperienced: {
		main: ["profiles", "summary", "experience", "projects", "education", "awards"],
		sidebar: ["skills", "certifications", "languages"],
		hidden: ["volunteer", "references", "publications", "interests"],
	},
	// State owned enterprises and public institutions: steady, conservative
	// ordering, with awards moved into the body because 奖惩情况 is read closely.
	cnPublicSector: {
		main: ["profiles", "summary", "education", "experience", "awards", "volunteer"],
		sidebar: ["skills", "certifications", "languages", "interests"],
		hidden: ["projects", "references", "publications"],
	},
};

/**
 * Splits section ids into the ones a preset knows about and everything else.
 *
 * Anything not a built-in section type is a custom section and is preserved:
 * applying a preset reorders and shows/hides built-in sections, it never
 * deletes the user's own sections.
 */
export const partitionPresetSectionIds = (ids: readonly string[]): { builtIn: string[]; custom: string[] } => {
	const known = new Set<string>(sectionTypeSchema.options);
	const builtIn: string[] = [];
	const custom: string[] = [];

	for (const id of ids) {
		(known.has(id) ? builtIn : custom).push(id);
	}

	return { builtIn, custom };
};
