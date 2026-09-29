import { describe, expect, it } from "vitest";
import { hashIpAddress, hashPhoneNumber, maskPhoneNumber, normalizePhoneNumber } from "./phone";

const PEPPER = "test-auth-secret";

describe("normalizePhoneNumber", () => {
	it("国内 11 位号码默认补 +86", () => {
		expect(normalizePhoneNumber("13800138000")).toBe("+8613800138000");
	});

	it("接受 86 / 0086 / +86 前缀", () => {
		expect(normalizePhoneNumber("8613800138000")).toBe("+8613800138000");
		expect(normalizePhoneNumber("008613800138000")).toBe("+8613800138000");
		expect(normalizePhoneNumber("+8613800138000")).toBe("+8613800138000");
	});

	it("忽略空格、连字符与括号", () => {
		expect(normalizePhoneNumber(" 138-0013-8000 ")).toBe("+8613800138000");
		expect(normalizePhoneNumber("(138) 0013 8000")).toBe("+8613800138000");
	});

	it("保留非中国的国家码", () => {
		expect(normalizePhoneNumber("+85200000000")).toBe("+85200000000");
		expect(normalizePhoneNumber("+12025550123")).toBe("+12025550123");
	});

	it("非法号码返回 undefined", () => {
		expect(normalizePhoneNumber("")).toBeUndefined();
		expect(normalizePhoneNumber("   ")).toBeUndefined();
		expect(normalizePhoneNumber("12345")).toBeUndefined();
		expect(normalizePhoneNumber("abcdefghijk")).toBeUndefined();
		expect(normalizePhoneNumber("+0123456")).toBeUndefined();
	});
});

describe("maskPhoneNumber", () => {
	it("国内号码显示成 138****8000", () => {
		expect(maskPhoneNumber("13800138000")).toBe("138****8000");
		expect(maskPhoneNumber("+8613800138000")).toBe("138****8000");
	});

	it("号码无法识别时降级为 ***", () => {
		expect(maskPhoneNumber("not-a-number")).toBe("***");
	});

	it("脱敏结果不含完整号码", () => {
		const masked = maskPhoneNumber("+8613800138000");

		expect(masked).not.toContain("13800138000");
		expect(masked).toContain("****");
	});
});

describe("hashPhoneNumber", () => {
	it("同一种号码的不同写法落到同一个哈希", () => {
		const a = hashPhoneNumber("13800138000", PEPPER);
		const b = hashPhoneNumber("+8613800138000", PEPPER);
		const c = hashPhoneNumber("008613800138000", PEPPER);

		expect(a).toBe(b);
		expect(b).toBe(c);
	});

	it("不同号码得到不同哈希", () => {
		expect(hashPhoneNumber("13800138000", PEPPER)).not.toBe(hashPhoneNumber("13800138001", PEPPER));
	});

	it("更换 pepper 后哈希变化(避免跨实例碰撞与彩虹表反查)", () => {
		expect(hashPhoneNumber("13800138000", PEPPER)).not.toBe(hashPhoneNumber("13800138000", "another-secret"));
	});

	it("哈希值不含明文号码", () => {
		const hash = hashPhoneNumber("13800138000", PEPPER);

		expect(hash).toMatch(/^[0-9a-f]{64}$/);
		expect(hash).not.toContain("13800138000");
	});

	it("缺少 pepper 时抛错,避免退化为可反查的裸哈希", () => {
		expect(() => hashPhoneNumber("13800138000", "")).toThrow(/pepper/);
	});
});

describe("hashIpAddress", () => {
	it("IPv4 与 IPv4-mapped IPv6 收敛到同一个哈希", () => {
		expect(hashIpAddress("203.0.113.7", PEPPER)).toBe(hashIpAddress("::ffff:203.0.113.7", PEPPER));
	});

	it("大小写与空白不影响结果", () => {
		expect(hashIpAddress(" 2001:DB8::1 ", PEPPER)).toBe(hashIpAddress("2001:db8::1", PEPPER));
	});

	it("未知 IP 返回 undefined(该列可空)", () => {
		expect(hashIpAddress(undefined, PEPPER)).toBeUndefined();
		expect(hashIpAddress("", PEPPER)).toBeUndefined();
		expect(hashIpAddress("   ", PEPPER)).toBeUndefined();
	});

	it("哈希值不含明文 IP", () => {
		const hash = hashIpAddress("203.0.113.7", PEPPER);

		expect(hash).toMatch(/^[0-9a-f]{64}$/);
		expect(hash).not.toContain("203.0.113.7");
	});
});
