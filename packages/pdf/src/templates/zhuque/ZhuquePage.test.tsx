import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getTemplatePage } from "../index";
import { zhuqueSemanticManifest } from "./semantic";
import { ZhuquePage } from "./ZhuquePage";

const sourcePath = fileURLToPath(new URL("./ZhuquePage.tsx", import.meta.url));

describe("zhuque template", () => {
	it("is registered in the template page registry", () => {
		expect(getTemplatePage("zhuque")).toBe(ZhuquePage);
	});

	it("declares the minimal semantic manifest", () => {
		expect(zhuqueSemanticManifest.template).toBe("zhuque");
		expect(zhuqueSemanticManifest.regions.map((region) => region.name)).toEqual(["header", "main", "sidebar"]);
		expect(zhuqueSemanticManifest.header).toEqual({ region: "header", placement: "main" });
		expect(zhuqueSemanticManifest.specialSummary).toBeNull();
		expect(zhuqueSemanticManifest.parts.map((part) => part.name)).toEqual(["item-header-row"]);
	});

	it("renders sections and contacts through the shared primitives", () => {
		const source = readFileSync(sourcePath, "utf8");

		expect(source).toContain("createBaseTemplateStyles");
		expect(source).toContain("createRtlStyleHelpers");
		expect(source).toContain("SemanticContactListView");
		expect(source).toContain("SemanticRegionView");
		expect(source).toContain('from "../shared/sections"');
	});

	it("keeps section headings lowercase and left aligned", () => {
		const source = readFileSync(sourcePath, "utf8");

		expect(source).not.toContain("textTransform");
		expect(source).not.toContain('textAlign: "center"');
	});
});
