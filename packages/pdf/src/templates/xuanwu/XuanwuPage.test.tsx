import type { CustomField } from "@reactive-resume/schema/resume/data";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getTemplatePage } from "../index";
import { partitionCnFields } from "../shared/cn-fields";
import { xuanwuSemanticManifest } from "./semantic";
import { XuanwuPage } from "./XuanwuPage";

const sourcePath = fileURLToPath(new URL("./XuanwuPage.tsx", import.meta.url));

const cnField = (text: string): CustomField => ({
	id: `field-${text}`,
	icon: "user",
	text,
	link: "",
});

describe("xuanwu template", () => {
	it("is registered in the template page registry", () => {
		expect(getTemplatePage("xuanwu")).toBe(XuanwuPage);
	});

	it("declares the minimal semantic manifest", () => {
		expect(xuanwuSemanticManifest.template).toBe("xuanwu");
		expect(xuanwuSemanticManifest.regions.map((region) => region.name)).toEqual(["header", "main", "sidebar"]);
		expect(xuanwuSemanticManifest.header).toEqual({ region: "header", placement: "main" });
		expect(xuanwuSemanticManifest.specialSummary).toBeNull();
		expect(xuanwuSemanticManifest.parts.map((part) => part.name)).toEqual(["item-header-row"]);
	});

	it("claims the domestic fields through the shared cn-fields helper", () => {
		const source = readFileSync(sourcePath, "utf8");

		expect(source).toContain('from "../shared/cn-fields"');
		expect(source).toContain("partitionCnFields");
		expect(source).toContain("CnFieldContactItem");
		expect(source).toContain("createBaseTemplateStyles");
		expect(source).toContain("createRtlStyleHelpers");
		expect(source).toContain('from "../shared/sections"');
	});

	it("renders every domestic field it claims and leaves the rest untouched", () => {
		const fields = [
			cnField("政治面貌：中共党员"),
			cnField("民族:汉族"),
			cnField("籍贯：浙江杭州"),
			cnField("出生年月：1998-06"),
			cnField("性别：男"),
			cnField("GitHub：https://github.com/example"),
			cnField("婚姻状况：未婚"),
		];
		const wanted = ["gender", "birthDate", "ethnicity", "politicalStatus", "nativePlace"] as const;

		const { slots, rest } = partitionCnFields(fields, wanted);

		expect(Object.keys(slots).sort()).toEqual([...wanted].sort());
		expect(slots.politicalStatus?.text).toBe("政治面貌：中共党员");
		expect(slots.ethnicity?.text).toBe("民族:汉族");
		expect(rest.map((field) => field.text)).toEqual(["GitHub：https://github.com/example", "婚姻状况：未婚"]);
	});

	it("degrades to the generic custom field row when nothing is recognised", () => {
		const fields = [cnField("LinkedIn"), cnField("https://example.com")];

		const { slots, rest } = partitionCnFields(fields, ["gender", "ethnicity"]);

		expect(slots).toEqual({});
		expect(rest).toHaveLength(2);
	});
});
