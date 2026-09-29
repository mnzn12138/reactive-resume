import { describe, expect, it } from "vitest";
import { getImageCardFilename, IMAGE_CARD_SCALE, resolveImageCardPages } from "./image-card.shared";

describe("resolveImageCardPages", () => {
	it("renders only the first page in single-page mode", () => {
		expect(resolveImageCardPages("single")).toEqual([1]);
	});

	it("renders every page in long-image mode", () => {
		expect(resolveImageCardPages("long")).toBe("all");
	});
});

describe("IMAGE_CARD_SCALE", () => {
	it("is a share-friendly zoom above screen resolution", () => {
		expect(IMAGE_CARD_SCALE).toBe(2);
	});
});

describe("getImageCardFilename", () => {
	it("keeps CJK characters and appends the .png extension", () => {
		expect(getImageCardFilename("张三的简历", "简历图")).toBe("张三的简历-简历图.png");
	});

	it("drops characters filesystems reject", () => {
		expect(getImageCardFilename("resume/v1", "简历图")).toBe("resume-v1-简历图.png");
	});

	it("falls back to the suffix alone when there is no name", () => {
		expect(getImageCardFilename("", "简历图")).toBe("简历图.png");
	});
});
