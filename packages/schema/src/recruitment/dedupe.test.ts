import { describe, expect, it } from "vitest";
import { buildDedupeKey, normalizeCompanyName, normalizeLocation, normalizeText } from "./dedupe";

describe("normalizeText", () => {
	it("folds full-width characters onto their half-width form", () => {
		expect(normalizeText("ＢｙｔｅＤａｎｃｅ")).toBe("bytedance");
		expect(normalizeText("Ｔｅｎｃｅｎｔ（深圳）")).toBe("tencent(深圳)");
	});

	it("treats the ideographic space as whitespace", () => {
		expect(normalizeText("腾讯　科技")).toBe("腾讯科技");
	});

	it("collapses leading, trailing and repeated spaces", () => {
		expect(normalizeText("  阿里  巴巴  ")).toBe("阿里巴巴");
	});

	it("lowercases mixed-case input", () => {
		expect(normalizeText("BackEnd Engineer")).toBe("backendengineer");
	});
});

describe("normalizeCompanyName", () => {
	it("strips the common legal suffixes", () => {
		expect(normalizeCompanyName("字节跳动有限公司")).toBe("字节跳动");
		expect(normalizeCompanyName("腾讯科技（深圳）股份有限公司")).toBe("腾讯科技(深圳)");
		expect(normalizeCompanyName("阿里巴巴集团有限公司")).toBe("阿里巴巴");
	});

	it("strips 中国 markers together with the suffix they sit inside", () => {
		expect(normalizeCompanyName("阿里巴巴（中国）有限公司")).toBe("阿里巴巴");
		expect(normalizeCompanyName("阿里巴巴(中国)")).toBe("阿里巴巴");
	});

	it("keeps a name that is nothing but a suffix", () => {
		expect(normalizeCompanyName("有限公司")).toBe("有限公司");
		expect(normalizeCompanyName("中国")).toBe("中国");
	});
});

describe("normalizeLocation", () => {
	it("normalises width and case like any other segment", () => {
		expect(normalizeLocation(" Ｂｅｉｊｉｎｇ ")).toBe("beijing");
	});
});

describe("buildDedupeKey", () => {
	it("joins company, role and first city with a pipe", () => {
		expect(buildDedupeKey({ company: "字节跳动有限公司", role: "后端工程师", locations: ["北京"] })).toBe(
			"字节跳动|后端工程师|北京",
		);
	});

	it("leaves the third segment empty when no city is given", () => {
		expect(buildDedupeKey({ company: "字节跳动", role: "后端工程师" })).toBe("字节跳动|后端工程师|");
		expect(buildDedupeKey({ company: "字节跳动", role: "后端工程师", locations: [] })).toBe("字节跳动|后端工程师|");
	});

	it("matches full-width input against half-width input", () => {
		const fullWidth = buildDedupeKey({ company: "ＢｙｔｅＤａｎｃｅ", role: "Ｂａｃｋｅｎｄ", locations: ["北京"] });
		const halfWidth = buildDedupeKey({ company: "ByteDance", role: "Backend", locations: ["北京"] });

		expect(fullWidth).toBe(halfWidth);
		expect(fullWidth).toBe("bytedance|backend|北京");
	});

	it("matches spacing variants of the same submission", () => {
		const spaced = buildDedupeKey({ company: "  阿里  巴巴 ", role: " 前端  工程师 ", locations: [" 杭州 "] });
		const tight = buildDedupeKey({ company: "阿里巴巴", role: "前端工程师", locations: ["杭州"] });

		expect(spaced).toBe(tight);
	});

	it("ignores letter case", () => {
		expect(buildDedupeKey({ company: "Tencent", role: "SWE", locations: ["Shenzhen"] })).toBe(
			buildDedupeKey({ company: "tencent", role: "swe", locations: ["Shenzhen"] }),
		);
	});

	it("ignores the order the cities were typed in", () => {
		expect(buildDedupeKey({ company: "美团", role: "后端", locations: ["北京", "上海"] })).toBe(
			buildDedupeKey({ company: "美团", role: "后端", locations: ["上海", "北京"] }),
		);
	});

	it("collapses legal-suffix variants of one company onto one key", () => {
		expect(buildDedupeKey({ company: "腾讯科技（深圳）有限公司", role: "客户端开发", locations: ["深圳"] })).toBe(
			buildDedupeKey({ company: "腾讯科技(深圳)", role: "客户端开发", locations: ["深圳"] }),
		);
	});

	it("still separates different companies, roles and cities", () => {
		const base = buildDedupeKey({ company: "美团", role: "后端", locations: ["北京"] });

		expect(buildDedupeKey({ company: "饿了么", role: "后端", locations: ["北京"] })).not.toBe(base);
		expect(buildDedupeKey({ company: "美团", role: "前端", locations: ["北京"] })).not.toBe(base);
		expect(buildDedupeKey({ company: "美团", role: "后端", locations: ["上海"] })).not.toBe(base);
	});
});
