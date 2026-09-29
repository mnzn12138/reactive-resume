import { describe, expect, it } from "vitest";
import { getPdfPageRenderSize } from "./pdf-thumbnail";

const A4 = { height: 841.89, width: 595.28 };

describe("getPdfPageRenderSize", () => {
	it("multiplies the natural page size by the requested scale", () => {
		expect(getPdfPageRenderSize(A4, 2)).toEqual({
			height: 1684,
			scale: 2,
			width: 1191,
		});
	});

	it("renders A4 at a share-friendly size at the image card scale", () => {
		const size = getPdfPageRenderSize(A4, 2);

		expect(size.width).toBeGreaterThanOrEqual(1190);
		expect(size.height).toBeGreaterThanOrEqual(1680);
	});

	it("keeps the aspect ratio of the page", () => {
		const size = getPdfPageRenderSize(A4, 1.5);
		expect(size.width / size.height).toBeCloseTo(A4.width / A4.height, 3);
	});

	it("rounds up so no page content is clipped", () => {
		const size = getPdfPageRenderSize({ height: 100.2, width: 50.1 }, 1);
		expect(size).toEqual({ height: 101, scale: 1, width: 51 });
	});

	it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("falls back to scale 1 for %s", (scale) => {
		expect(getPdfPageRenderSize(A4, scale).scale).toBe(1);
	});
});
