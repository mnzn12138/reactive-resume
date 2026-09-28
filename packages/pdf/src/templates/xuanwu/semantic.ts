import type { TemplateSemanticManifest } from "../../semantic/template-manifest";
import { itemHeaderRowPart } from "../../semantic/shared-parts";

/**
 * xuanwu is the state owned enterprise / public institution template. Its
 * personal information band is a visual grouping of contact items produced by
 * `cn-fields.ts` inside the template; the semantic layer cannot route a single
 * custom field into its own cell (`name: "custom"` is moved as a whole), so the
 * manifest deliberately stays at the minimal part set.
 */
export const xuanwuSemanticManifest = {
	template: "xuanwu",
	regions: [
		{ name: "header", placement: "main", origins: [] },
		{ name: "main", placement: "main", origins: ["main"] },
		{ name: "sidebar", placement: "sidebar", origins: ["sidebar"] },
	],
	header: { region: "header", placement: "main" },
	specialSummary: null,
	parts: [itemHeaderRowPart],
} as const satisfies TemplateSemanticManifest;
