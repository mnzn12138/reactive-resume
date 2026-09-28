import type { CustomField } from "@reactive-resume/schema/resume/data";
import { describe, expect, it } from "vitest";
import { CN_FIELD_KEYS, parseCnFieldText, partitionCnFields, resolveCnFieldKey } from "./cn-fields";

const field = (text: string, overrides: Partial<CustomField> = {}): CustomField => ({
	id: `field-${Math.random().toString(36).slice(2)}`,
	icon: "user",
	text,
	link: "",
	...overrides,
});

const ALL_KEYS = [...CN_FIELD_KEYS];

describe("parseCnFieldText", () => {
	it("splits on the fullwidth colon", () => {
		expect(parseCnFieldText("政治面貌：中共党员")).toEqual({ label: "政治面貌", value: "中共党员" });
	});

	it("falls back to the halfwidth colon", () => {
		expect(parseCnFieldText("民族:汉族")).toEqual({ label: "民族", value: "汉族" });
	});

	it("prefers the fullwidth colon when both appear", () => {
		expect(parseCnFieldText("籍贯：山东:济南")).toEqual({ label: "籍贯", value: "山东:济南" });
	});

	it("trims surrounding whitespace, including ideographic spaces", () => {
		expect(parseCnFieldText("性别 : 男 ")).toEqual({ label: "性别", value: "男" });
	});

	it("returns undefined when there is no colon", () => {
		expect(parseCnFieldText("中共党员")).toBeUndefined();
	});

	it("returns undefined when the label is empty", () => {
		expect(parseCnFieldText(":中共党员")).toBeUndefined();
	});
});

describe("resolveCnFieldKey", () => {
	it("prefers an explicit key over sniffing", () => {
		const customField = field("Some unrelated text", { key: "politicalStatus" });
		expect(resolveCnFieldKey(customField)).toBe("politicalStatus");
	});

	it("ignores an unknown explicit key and still sniffs", () => {
		// Cast on purpose: the schema narrows `key` to the known set, but resumes
		// imported from elsewhere can carry anything. The runtime guard must hold.
		const customField = field("民族：汉族", { key: "not-a-real-key" } as unknown as Partial<CustomField>);
		expect(resolveCnFieldKey(customField)).toBe("ethnicity");
	});

	it("sniffs every documented label alias", () => {
		const cases: [string, string][] = [
			["政治面貌：中共党员", "politicalStatus"],
			["政治面目：共青团员", "politicalStatus"],
			["民族：汉族", "ethnicity"],
			["族别：回族", "ethnicity"],
			["出生年月：1998-06", "birthDate"],
			["出生日期：1998-06-01", "birthDate"],
			["性别：男", "gender"],
			["籍贯：山东济南", "nativePlace"],
			["户籍：北京", "hukou"],
			["婚姻状况：未婚", "maritalStatus"],
			["身高：178cm", "height"],
		];

		for (const [text, expected] of cases) {
			expect(resolveCnFieldKey(field(text)), text).toBe(expected);
		}
	});

	it("returns undefined for unrecognised labels so the field renders verbatim", () => {
		expect(resolveCnFieldKey(field("LinkedIn：in/example"))).toBeUndefined();
		expect(resolveCnFieldKey(field("中共党员"))).toBeUndefined();
	});
});

describe("partitionCnFields", () => {
	it("claims only the wanted keys and leaves the rest untouched", () => {
		const fields = [
			field("政治面貌：中共党员"),
			field("民族：汉族"),
			field("LinkedIn：in/example"),
			field("身高：178cm"),
		];

		const { slots, rest } = partitionCnFields(fields, ["politicalStatus", "ethnicity"]);

		expect(Object.keys(slots).sort()).toEqual(["ethnicity", "politicalStatus"]);
		expect(slots.politicalStatus?.text).toBe("政治面貌：中共党员");
		expect(rest.map((item) => item.text)).toEqual(["LinkedIn：in/example", "身高：178cm"]);
	});

	it("renders everything when nothing is wanted", () => {
		const fields = [field("政治面貌：中共党员"), field("民族：汉族")];
		const { slots, rest } = partitionCnFields(fields, []);

		expect(slots).toEqual({});
		expect(rest).toEqual(fields);
	});

	it("consumes a duplicated key only once, keeping the extra in rest", () => {
		const fields = [field("民族：汉族"), field("民族：满族")];
		const { slots, rest } = partitionCnFields(fields, ALL_KEYS);

		expect(slots.ethnicity?.text).toBe("民族：汉族");
		expect(rest.map((item) => item.text)).toEqual(["民族：满族"]);
	});

	it("degrades to full rendering when sniffing fails for every field", () => {
		const fields = [field("中共党员"), field("汉族")];
		const { slots, rest } = partitionCnFields(fields, ALL_KEYS);

		expect(slots).toEqual({});
		expect(rest).toEqual(fields);
	});
});
