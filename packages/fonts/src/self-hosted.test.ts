import { afterEach, describe, expect, it, vi } from "vitest";
import {
	clearSelfHostedFontOverrides,
	getSelfHostedFontBaseUrl,
	getSelfHostedFontFamilies,
	getSelfHostedOverrides,
	registerSelfHostedFontOverride,
	resolveSelfHostedFontUrl,
	selfHostBaseUrlEnvKey,
	selfHostedFontOverrides,
} from "./self-hosted";

afterEach(() => {
	clearSelfHostedFontOverrides();
	vi.unstubAllEnvs();
	vi.resetModules();
});

describe("selfHostedFontOverrides", () => {
	it("ships empty so the default install keeps using fonts.gstatic.com", () => {
		expect(selfHostedFontOverrides).toEqual([]);
		expect(getSelfHostedOverrides()).toEqual([]);
		expect(getSelfHostedFontFamilies()).toEqual([]);
	});
});

describe("registerSelfHostedFontOverride", () => {
	it("returns the registered override", () => {
		registerSelfHostedFontOverride({
			family: "Noto Sans SC",
			weights: ["400", "700"],
			files: { "400": "/fonts/noto-sans-sc-400.ttf", "700": "/fonts/noto-sans-sc-700.ttf" },
		});

		expect(getSelfHostedOverrides()).toEqual([
			{
				family: "Noto Sans SC",
				weights: ["400", "700"],
				files: { "400": "/fonts/noto-sans-sc-400.ttf", "700": "/fonts/noto-sans-sc-700.ttf" },
			},
		]);
		expect(getSelfHostedFontFamilies()).toEqual(["Noto Sans SC"]);
	});

	it("replaces an entry of the same family instead of duplicating it", () => {
		registerSelfHostedFontOverride({ family: "Noto Sans SC", weights: ["400"], files: { "400": "/fonts/a.ttf" } });
		registerSelfHostedFontOverride({ family: "Noto Sans SC", weights: ["400"], files: { "400": "/fonts/b.ttf" } });

		const overrides = getSelfHostedOverrides();
		expect(overrides).toHaveLength(1);
		expect(overrides[0]?.files["400"]).toBe("/fonts/b.ttf");
	});

	it("ignores entries without a family name", () => {
		registerSelfHostedFontOverride({ family: "   ", weights: [], files: {} });
		expect(getSelfHostedOverrides()).toEqual([]);
	});

	it("returns copies so callers cannot mutate the registry", () => {
		registerSelfHostedFontOverride({ family: "Noto Sans SC", weights: ["400"], files: { "400": "/fonts/a.ttf" } });

		const overrides = getSelfHostedOverrides();
		const first = overrides[0];
		expect(first).toBeDefined();
		first?.weights.push("900");
		if (first) first.files["900"] = "/fonts/evil.ttf";

		expect(getSelfHostedOverrides()[0]?.weights).toEqual(["400"]);
		expect(getSelfHostedOverrides()[0]?.files["900"]).toBeUndefined();
	});

	it("restores the static table on clear", () => {
		registerSelfHostedFontOverride({ family: "Noto Sans SC", weights: ["400"], files: { "400": "/fonts/a.ttf" } });
		clearSelfHostedFontOverrides();
		expect(getSelfHostedOverrides()).toEqual([]);
	});

	it("skips families that declare no files", () => {
		registerSelfHostedFontOverride({ family: "Noto Sans SC", weights: [], files: {} });
		expect(getSelfHostedFontFamilies()).toEqual([]);
	});
});

describe("getSelfHostedFontBaseUrl", () => {
	it.each([
		[undefined, null],
		["", null],
		["   ", null],
		["https://fonts.example.com", "https://fonts.example.com"],
		["https://fonts.example.com/", "https://fonts.example.com"],
		["https://fonts.example.com///", "https://fonts.example.com"],
	])("normalises %s to %s", (value, expected) => {
		if (value !== undefined) vi.stubEnv(selfHostBaseUrlEnvKey, value);
		expect(getSelfHostedFontBaseUrl()).toBe(expected);
	});
});

describe("resolveSelfHostedFontUrl", () => {
	it("prefixes root-relative paths with the base URL", () => {
		expect(resolveSelfHostedFontUrl("/fonts/a.ttf", "https://fonts.example.com")).toBe(
			"https://fonts.example.com/fonts/a.ttf",
		);
	});

	it("prefixes bare filenames too", () => {
		expect(resolveSelfHostedFontUrl("a.ttf", "https://fonts.example.com")).toBe("https://fonts.example.com/a.ttf");
	});

	it("leaves absolute URLs alone so one family can be pinned elsewhere", () => {
		const url = "https://other.example.com/fonts/a.ttf";
		expect(resolveSelfHostedFontUrl(url, "https://fonts.example.com")).toBe(url);
	});

	it("is a no-op without a base URL", () => {
		expect(resolveSelfHostedFontUrl("/fonts/a.ttf", null)).toBe("/fonts/a.ttf");
	});
});

describe("override table merged into the webfont list", () => {
	it("leaves the generated list untouched when the table is empty", async () => {
		vi.resetModules();
		const fonts = await import("./index");

		expect(fonts.getWebFontSource("Noto Sans SC", "400")).toContain("fonts.gstatic.com");
		expect(fonts.webFontMap.size).toBe(fonts.webFontList.length);
		expect(fonts.describeFontSources().selfHosted).toEqual([]);
	});

	it("overrides an existing family in place without duplicating it", async () => {
		vi.resetModules();
		const selfHosted = await import("./self-hosted");
		selfHosted.registerSelfHostedFontOverride({
			family: "Noto Sans SC",
			weights: ["400"],
			files: { "400": "/fonts/noto-sans-sc-400-subset.ttf" },
		});
		const fonts = await import("./index");

		expect(fonts.getWebFontSource("Noto Sans SC", "400")).toBe("/fonts/noto-sans-sc-400-subset.ttf");
		expect(fonts.webFontList.filter((font) => font.family === "Noto Sans SC")).toHaveLength(1);
		// Weights the deployment did not ship keep resolving from the generated list.
		expect(fonts.getWebFontSource("Noto Sans SC", "700")).toContain("fonts.gstatic.com");
	});

	it("appends a family that is not in the generated list at all", async () => {
		vi.resetModules();
		const selfHosted = await import("./self-hosted");
		selfHosted.registerSelfHostedFontOverride({
			family: "MyCorp Han Sans",
			weights: ["400"],
			files: { "400": "/fonts/mycorp-han-400.ttf" },
		});
		const fonts = await import("./index");

		expect(fonts.getWebFontSource("MyCorp Han Sans", "400")).toBe("/fonts/mycorp-han-400.ttf");
		expect(fonts.webFontList.filter((font) => font.family === "MyCorp Han Sans")).toHaveLength(1);
	});

	it("applies FONT_SELF_HOST_BASE_URL to self-hosted paths at load time", async () => {
		vi.resetModules();
		vi.stubEnv(selfHostBaseUrlEnvKey, "https://fonts.example.com/");
		const selfHosted = await import("./self-hosted");
		selfHosted.registerSelfHostedFontOverride({
			family: "Noto Sans SC",
			weights: ["400"],
			files: { "400": "/fonts/noto-sans-sc-400-subset.ttf" },
		});
		const fonts = await import("./index");

		expect(fonts.getWebFontSource("Noto Sans SC", "400")).toBe(
			"https://fonts.example.com/fonts/noto-sans-sc-400-subset.ttf",
		);
		expect(fonts.describeFontSources().baseUrl).toBe("https://fonts.example.com");
	});

	it("reports which families are self-hosted and which are still remote", async () => {
		vi.resetModules();
		const selfHosted = await import("./self-hosted");
		selfHosted.registerSelfHostedFontOverride({
			family: "Noto Sans SC",
			weights: ["400"],
			files: { "400": "/fonts/noto-sans-sc-400-subset.ttf" },
		});
		const fonts = await import("./index");

		const report = fonts.describeFontSources();
		expect(report.selfHosted.map((entry) => entry.family)).toContain("Noto Sans SC");
		expect(report.selfHosted[0]?.files).toEqual({ "400": "/fonts/noto-sans-sc-400-subset.ttf" });
		// Only the Regular face was overridden, so the family is still partly remote.
		expect(report.remote.map((entry) => entry.family)).toContain("Noto Sans SC");
		expect(report.remoteHosts).toContain("fonts.gstatic.com");
		expect(report.baseUrl).toBeNull();
	});

	it("re-applies the table for overrides registered after module load", async () => {
		vi.resetModules();
		const fonts = await import("./index");
		const selfHosted = await import("./self-hosted");

		expect(fonts.getWebFontSource("Noto Sans SC", "400")).toContain("fonts.gstatic.com");

		selfHosted.registerSelfHostedFontOverride({
			family: "Noto Sans SC",
			weights: ["400"],
			files: { "400": "/fonts/late.ttf" },
		});
		fonts.applySelfHostedOverrides();

		expect(fonts.getWebFontSource("Noto Sans SC", "400")).toBe("/fonts/late.ttf");
	});
});
