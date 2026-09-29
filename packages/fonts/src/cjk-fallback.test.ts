import type { FontWeight } from "./types";
import { describe, expect, it } from "vitest";
import {
	cjkFallbackFontWeightPriority,
	getCjkFallbackFontWeights,
	getFallbackFontVariants,
	isCjkFontFamily,
} from "./cjk-fallback";

const fullCjkWeights: FontWeight[] = ["200", "300", "400", "500", "600", "700", "800", "900"];

describe("isCjkFontFamily", () => {
	it.each(["Noto Sans SC", "Noto Serif SC", "Noto Sans TC", "Noto Serif JP", "Noto Sans KR", "Noto Sans HK"])(
		"recognises %s as CJK",
		(family) => {
			expect(isCjkFontFamily(family)).toBe(true);
		},
	);

	it.each([
		"IBM Plex Serif",
		"Noto Serif",
		"Noto Emoji",
		"Noto Naskh Arabic",
		"Noto Sans Thai",
		// "SC" means Small-Caps for these Latin families — they DO ship italics
		// and must never be mistaken for Simplified Chinese.
		"Alegreya Sans SC",
		"Amatic SC",
		"Bona Nova SC",
		"Bowlby One SC",
		"Playfair Display SC",
	])("rejects %s as CJK", (family) => {
		expect(isCjkFontFamily(family)).toBe(false);
	});

	it.each([undefined, null, ""])("rejects %s", (family) => {
		expect(isCjkFontFamily(family)).toBe(false);
	});
});

describe("getCjkFallbackFontWeights", () => {
	it("keeps only body and emphasis faces out of a full weight range", () => {
		expect(getCjkFallbackFontWeights(fullCjkWeights)).toEqual(["400", "700"]);
	});

	it("is pure — repeated calls with the same input return the same output", () => {
		const first = getCjkFallbackFontWeights(fullCjkWeights, { requestedWeights: ["400", "500", "600", "700"] });
		const second = getCjkFallbackFontWeights(fullCjkWeights, { requestedWeights: ["400", "500", "600", "700"] });
		expect(first).toEqual(second);
		expect(first).not.toBe(second);
	});

	it("drops the 500/600 intermediate faces even when the caller asks for them", () => {
		expect(getCjkFallbackFontWeights(fullCjkWeights, { requestedWeights: ["400", "500", "600", "700"] })).toEqual([
			"400",
			"700",
		]);
	});

	it("returns weights sorted ascending", () => {
		expect(getCjkFallbackFontWeights(["700", "400", "900"])).toEqual(["400", "700"]);
	});

	it("honours a smaller budget", () => {
		expect(getCjkFallbackFontWeights(fullCjkWeights, { maxWeights: 1 })).toEqual(["400"]);
	});

	it("falls back to whatever the family ships when it has neither 400 nor 700", () => {
		expect(getCjkFallbackFontWeights(["300", "500"])).toEqual(["300", "500"]);
	});

	it("registers a single face when the family only has one", () => {
		expect(getCjkFallbackFontWeights(["400"])).toEqual(["400"]);
	});

	it("returns an empty set for a family with no weights at all", () => {
		expect(getCjkFallbackFontWeights([])).toEqual([]);
	});

	it("ignores requested weights the family does not have", () => {
		expect(getCjkFallbackFontWeights(["400", "700"], { requestedWeights: ["900"] })).toEqual(["400", "700"]);
	});

	it("prefers Regular then Bold over any other pair", () => {
		expect(cjkFallbackFontWeightPriority.slice(0, 2)).toEqual(["400", "700"]);
	});
});

describe("getFallbackFontVariants", () => {
	it("caps CJK families at two weights, in both styles", () => {
		expect(
			getFallbackFontVariants(fullCjkWeights, { cjk: true, requestedWeights: ["400", "500", "600", "700"] }),
		).toEqual([
			{ weight: "400", italic: false },
			{ weight: "400", italic: true },
			{ weight: "700", italic: false },
			{ weight: "700", italic: true },
		]);
	});

	it("keeps an italic variant for CJK families (react-pdf resolves by exact style)", () => {
		const variants = getFallbackFontVariants(fullCjkWeights, { cjk: true, requestedWeights: ["400", "700"] });
		expect(variants.filter((variant) => variant.italic)).toEqual([
			{ weight: "400", italic: true },
			{ weight: "700", italic: true },
		]);
		expect(variants).toHaveLength(4);
	});

	it("keeps both styles for every requested weight of a non-CJK family", () => {
		expect(getFallbackFontVariants(fullCjkWeights, { cjk: false, requestedWeights: ["400", "700"] })).toEqual([
			{ weight: "400", italic: false },
			{ weight: "400", italic: true },
			{ weight: "700", italic: false },
			{ weight: "700", italic: true },
		]);
	});

	it("does not apply the CJK weight budget to non-CJK families", () => {
		const variants = getFallbackFontVariants(fullCjkWeights, {
			cjk: false,
			requestedWeights: ["400", "500", "600", "700"],
		});
		expect(variants.map((variant) => variant.weight)).toEqual(["400", "400", "500", "500", "600", "600", "700", "700"]);
	});

	it("defaults to the non-CJK behaviour when `cjk` is omitted", () => {
		expect(getFallbackFontVariants(fullCjkWeights, { requestedWeights: ["400"] })).toEqual([
			{ weight: "400", italic: false },
			{ weight: "400", italic: true },
		]);
	});
});
