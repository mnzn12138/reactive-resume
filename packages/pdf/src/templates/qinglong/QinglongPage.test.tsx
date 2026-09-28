import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getTemplatePage } from "../index";
import { QinglongPage } from "./QinglongPage";
import { qinglongSemanticManifest } from "./semantic";

const sourcePath = fileURLToPath(new URL("./QinglongPage.tsx", import.meta.url));

describe("qinglong template", () => {
	it("is registered in the template page registry", () => {
		expect(getTemplatePage("qinglong")).toBe(QinglongPage);
	});

	it("declares the meowth inline item header parts", () => {
		expect(qinglongSemanticManifest.template).toBe("qinglong");
		expect(qinglongSemanticManifest.regions.map((region) => region.name)).toEqual(["header", "main", "sidebar"]);
		expect(qinglongSemanticManifest.parts.map((part) => part.name)).toEqual([
			"item-header-row",
			"inline-item-header-leading",
			"inline-item-header-middle",
			"inline-item-header-trailing",
			"education-grade-row",
		]);
	});

	it("enables the inline item header feature", () => {
		const source = readFileSync(sourcePath, "utf8");

		expect(source).toContain("inlineItemHeader: true");
		expect(source).toContain("createBaseTemplateStyles");
		expect(source).toContain("createRtlStyleHelpers");
		expect(source).toContain("SemanticContactListView");
		expect(source).toContain("SemanticRegionView");
		expect(source).toContain('from "../shared/sections"');
	});

	it("keeps section headings lowercase", () => {
		const source = readFileSync(sourcePath, "utf8");

		expect(source).not.toContain("textTransform");
	});
});
