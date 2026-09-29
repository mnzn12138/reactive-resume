import { describe, expect, it } from "vitest";
import { DOMESTIC_MODEL_PRESETS, domesticModelPresetSchema, findDomesticModelPreset } from "./domestic-models";
import { aiProviderSchema } from "./types";

const validProviders = new Set<string>(aiProviderSchema.options);

describe("DOMESTIC_MODEL_PRESETS", () => {
	it("has unique ids", () => {
		const ids = DOMESTIC_MODEL_PRESETS.map((preset) => preset.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it.each(DOMESTIC_MODEL_PRESETS.map((preset) => [preset.id, preset] as const))(
		"%s only uses providers that already exist",
		(_id, preset) => {
			// The provider match in the API package is `.exhaustive()`: introducing a
			// new enum member would not compile. Presets must reuse existing ones.
			expect(validProviders.has(preset.provider)).toBe(true);
		},
	);

	it.each(DOMESTIC_MODEL_PRESETS.map((preset) => [preset.id, preset] as const))(
		"%s parses against its schema",
		(_id, preset) => {
			expect(domesticModelPresetSchema.safeParse(preset).success).toBe(true);
		},
	);

	it.each(DOMESTIC_MODEL_PRESETS.map((preset) => [preset.id, preset] as const))(
		"%s points at an https endpoint",
		(_id, preset) => {
			expect(preset.baseURL.startsWith("https://")).toBe(true);
			expect(preset.baseURL.endsWith("/")).toBe(false);
		},
	);

	it("gives every non-DeepSeek preset an explicit baseURL", () => {
		// `openai-compatible` defaults to an empty baseURL, so a preset that omits
		// it would silently produce an unusable form.
		for (const preset of DOMESTIC_MODEL_PRESETS) {
			if (preset.provider !== "openai-compatible") continue;
			expect(preset.baseURL, preset.id).not.toBe("");
		}
	});

	it("asks the user for the model id whenever it cannot be corroborated", () => {
		const withoutModel = DOMESTIC_MODEL_PRESETS.filter((preset) => preset.defaultModel === "");
		expect(withoutModel.length).toBeGreaterThan(0);
		for (const preset of withoutModel) {
			expect(preset.notes, preset.id).toBeTruthy();
		}
	});
});

describe("findDomesticModelPreset", () => {
	it("finds a known preset", () => {
		expect(findDomesticModelPreset("qwen")?.name).toBe("通义千问");
	});

	it("returns undefined for an unknown id", () => {
		expect(findDomesticModelPreset("not-a-vendor")).toBeUndefined();
	});
});
