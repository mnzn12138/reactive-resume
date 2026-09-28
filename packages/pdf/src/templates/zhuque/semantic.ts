import type { TemplateSemanticManifest } from "../../semantic/template-manifest";
import { itemHeaderRowPart } from "../../semantic/shared-parts";

/**
 * zhuque is the single page standard template: header + main + optional right
 * sidebar. It declares the minimal part set, identical to kakuna / lapras / onyx,
 * so no `packages/resume` stylesheet registry change is required.
 */
export const zhuqueSemanticManifest = {
	template: "zhuque",
	regions: [
		{ name: "header", placement: "main", origins: [] },
		{ name: "main", placement: "main", origins: ["main"] },
		{ name: "sidebar", placement: "sidebar", origins: ["sidebar"] },
	],
	header: { region: "header", placement: "main" },
	specialSummary: null,
	parts: [itemHeaderRowPart],
} as const satisfies TemplateSemanticManifest;
