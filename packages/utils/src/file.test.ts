/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadWithAnchor, generateFilename, generateLocalizedFilename } from "./file";

describe("generateFilename", () => {
	it("slugifies the prefix without extension", () => {
		expect(generateFilename("My Resume")).toBe("my-resume");
	});

	it("appends extension when provided", () => {
		expect(generateFilename("My Resume", "pdf")).toBe("my-resume.pdf");
	});

	it("appends extension verbatim (no extra dot)", () => {
		expect(generateFilename("Name", "json")).toBe("name.json");
	});

	it("handles empty extension as no extension", () => {
		expect(generateFilename("foo", "")).toBe("foo");
	});

	it("strips diacritics", () => {
		expect(generateFilename("Résumé", "pdf")).toBe("resume.pdf");
	});

	it("handles empty prefix", () => {
		expect(generateFilename("", "pdf")).toBe(".pdf");
	});
});

describe("generateLocalizedFilename", () => {
	it("keeps CJK characters that generateFilename would erase", () => {
		expect(generateFilename("张三-名片", "png")).not.toContain("张三");
		expect(generateLocalizedFilename("张三-名片", "png")).toBe("张三-名片.png");
	});

	it("collapses whitespace into a single dash", () => {
		expect(generateLocalizedFilename("  My   Resume  ", "png")).toBe("My-Resume.png");
	});

	it("strips characters that filesystems reject", () => {
		expect(generateLocalizedFilename('re:sume*?<>"|', "png")).toBe("re-sume.png");
	});

	it("drops leading and trailing separators", () => {
		expect(generateLocalizedFilename("---resume---", "png")).toBe("resume.png");
	});

	it("falls back when nothing usable is left", () => {
		expect(generateLocalizedFilename(":::", "png")).toBe("resume.png");
		expect(generateLocalizedFilename("", "png")).toBe("resume.png");
	});

	it("omits the extension when none is given", () => {
		expect(generateLocalizedFilename("简历图")).toBe("简历图");
	});
});

describe("downloadWithAnchor", () => {
	let createObjectURLSpy: ReturnType<typeof vi.fn<typeof URL.createObjectURL>>;
	let revokeObjectURLSpy: ReturnType<typeof vi.fn<typeof URL.revokeObjectURL>>;
	let originalCreate: typeof URL.createObjectURL;
	let originalRevoke: typeof URL.revokeObjectURL;

	beforeEach(() => {
		vi.useFakeTimers();
		originalCreate = URL.createObjectURL;
		originalRevoke = URL.revokeObjectURL;
		createObjectURLSpy = vi.fn<typeof URL.createObjectURL>(() => "blob:mock-url");
		revokeObjectURLSpy = vi.fn<typeof URL.revokeObjectURL>();
		URL.createObjectURL = createObjectURLSpy;
		URL.revokeObjectURL = revokeObjectURLSpy;
	});

	afterEach(() => {
		vi.useRealTimers();
		URL.createObjectURL = originalCreate;
		URL.revokeObjectURL = originalRevoke;
	});

	it("creates an anchor with correct href, rel, and download attributes", () => {
		const blob = new Blob(["hello"], { type: "text/plain" });
		const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

		downloadWithAnchor(blob, "test.txt");

		expect(createObjectURLSpy).toHaveBeenCalledWith(blob);
		expect(clickSpy).toHaveBeenCalledOnce();

		clickSpy.mockRestore();
	});

	it("removes the anchor from the DOM after click", () => {
		const blob = new Blob(["hello"]);
		vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

		const beforeChildCount = document.body.childElementCount;
		downloadWithAnchor(blob, "test.txt");
		const afterChildCount = document.body.childElementCount;

		expect(afterChildCount).toBe(beforeChildCount);
	});

	it("revokes the object URL after 5 seconds", () => {
		const blob = new Blob(["hello"]);
		vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

		downloadWithAnchor(blob, "test.txt");

		expect(revokeObjectURLSpy).not.toHaveBeenCalled();
		vi.advanceTimersByTime(4999);
		expect(revokeObjectURLSpy).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(revokeObjectURLSpy).toHaveBeenCalledWith("blob:mock-url");
	});
});
