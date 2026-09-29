import { describe, expect, it } from "vitest";
import { buildPlaceholderEmail, FALLBACK_PLACEHOLDER_DOMAIN, resolvePlaceholderEmailDomain } from "./placeholder";

describe("resolvePlaceholderEmailDomain", () => {
	it("derives the domain from the instance URL", () => {
		expect(resolvePlaceholderEmailDomain("https://resume.example.com")).toBe("users.noreply.resume.example.com");
		expect(resolvePlaceholderEmailDomain("http://localhost:3000")).toBe("users.noreply.localhost");
	});

	it("falls back to a fixed, unreachable domain when the URL is unusable", () => {
		expect(resolvePlaceholderEmailDomain(undefined)).toBe(FALLBACK_PLACEHOLDER_DOMAIN);
		expect(resolvePlaceholderEmailDomain("")).toBe(FALLBACK_PLACEHOLDER_DOMAIN);
		expect(resolvePlaceholderEmailDomain("not a url")).toBe(FALLBACK_PLACEHOLDER_DOMAIN);
	});
});

describe("buildPlaceholderEmail", () => {
	it("uses the channel and subject so two providers cannot collide", () => {
		const subject = "o6_bmasdasdsad6_2sgVt7hMZOPfL0";

		expect(buildPlaceholderEmail({ channel: "wechat", subject, appUrl: "https://resume.example.com" })).toBe(
			"wechat_o6_bmasdasdsad6_2sgvt7hmzopfl0@users.noreply.resume.example.com",
		);
		expect(buildPlaceholderEmail({ channel: "alipay", subject, appUrl: "https://resume.example.com" })).toBe(
			"alipay_o6_bmasdasdsad6_2sgvt7hmzopfl0@users.noreply.resume.example.com",
		);
	});

	it("stays inside the username character set and length limit", () => {
		const email = buildPlaceholderEmail({
			channel: "wechat",
			// A subject with characters `username` validation rejects, plus a CJK nickname.
			subject: "oPENID#$%你好",
			appUrl: "https://resume.example.com",
		});
		const [localPart] = email.split("@");

		expect(localPart).toBe("wechat_openid");
		expect(localPart).toMatch(/^[a-z0-9._-]+$/);
		expect(localPart?.length ?? 0).toBeLessThanOrEqual(64);
	});

	it("never produces an empty local part", () => {
		const email = buildPlaceholderEmail({ channel: "alipay", subject: "###" });

		expect(email).toBe(`alipay_user@${FALLBACK_PLACEHOLDER_DOMAIN}`);
	});

	it("gives different subjects different addresses", () => {
		const first = buildPlaceholderEmail({ channel: "wechat", subject: "abc", appUrl: "https://resume.example.com" });
		const second = buildPlaceholderEmail({ channel: "wechat", subject: "abd", appUrl: "https://resume.example.com" });

		expect(first).not.toBe(second);
	});
});
