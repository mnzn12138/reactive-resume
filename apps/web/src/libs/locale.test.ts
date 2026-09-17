// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import Cookies from "js-cookie";
import { changeLocale, formatRelativeTime, isLocale, resolveLocale } from "./locale";

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
	Cookies.remove("locale");
});

describe("isLocale", () => {
	it("returns true for known locale en-US", () => {
		expect(isLocale("en-US")).toBe(true);
	});

	it("returns true for zh-TW", () => {
		expect(isLocale("zh-TW")).toBe(true);
	});

	it("returns true for zh-CN", () => {
		expect(isLocale("zh-CN")).toBe(true);
	});

	it("returns false for unknown locale", () => {
		expect(isLocale("xx-YY")).toBe(false);
	});

	it("returns false for empty string", () => {
		expect(isLocale("")).toBe(false);
	});

	it("returns false for malformed locale", () => {
		expect(isLocale("not a locale")).toBe(false);
	});

	it("is case-sensitive", () => {
		expect(isLocale("en-us")).toBe(false);
	});
});

describe("resolveLocale", () => {
	it("returns the locale unchanged when valid", () => {
		expect(resolveLocale("zh-TW")).toBe("zh-TW");
	});

	it("returns zh-CN default for a locale whose catalog was removed", () => {
		expect(resolveLocale("xx-YY")).toBe("zh-CN");
	});

	it("returns zh-CN default for empty string", () => {
		expect(resolveLocale("")).toBe("zh-CN");
	});
});

describe("formatRelativeTime", () => {
	it("selects the largest matching unit", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-02T12:00:00Z"));
		const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

		expect(formatRelativeTime("2026-01-02T10:00:00Z", formatter)).toBe("2 hours ago");
		expect(formatRelativeTime("2026-01-02T11:59:45Z", formatter)).toBe("now");
	});

	it("uses the requested fallback for an invalid date", () => {
		const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

		expect(formatRelativeTime("invalid", formatter, "")).toBe("");
	});
});

describe("changeLocale", () => {
	it("persists a valid locale and reloads", () => {
		const reload = vi.spyOn(window.location, "reload").mockImplementation(() => undefined);

		changeLocale("zh-TW");

		expect(Cookies.get("locale")).toBe("zh-TW");
		expect(reload).toHaveBeenCalledOnce();
	});
});
