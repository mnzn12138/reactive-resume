import { describe, expect, it } from "vitest";
import { sectionTypeSchema } from "./data";
import { sectionPresetSchema, sectionPresets } from "./section-presets";

const allSectionTypes = [...sectionTypeSchema.options];

describe("sectionPresets", () => {
	it.each([...sectionPresetSchema.options])("%s covers every built-in section exactly once", (preset) => {
		const layout = sectionPresets[preset];
		const covered = [...layout.main, ...layout.sidebar, ...layout.hidden];

		expect(covered).toHaveLength(allSectionTypes.length);
		expect([...covered].sort()).toEqual([...allSectionTypes].sort());
	});

	it.each([...sectionPresetSchema.options])("%s keeps summary in the main column", (preset) => {
		expect(sectionPresets[preset].main).toContain("summary");
	});

	it("never hides summary, because the layout editor cannot re-add it", () => {
		for (const preset of sectionPresetSchema.options) {
			expect(sectionPresets[preset].hidden).not.toContain("summary");
		}
	});

	it("orders campus recruitment with education above experience", () => {
		const main = sectionPresets.cnCampus.main;
		expect(main.indexOf("education")).toBeLessThan(main.indexOf("experience"));
	});

	it("orders experienced hiring with experience above education", () => {
		const main = sectionPresets.cnExperienced.main;
		expect(main.indexOf("experience")).toBeLessThan(main.indexOf("education"));
	});
});
