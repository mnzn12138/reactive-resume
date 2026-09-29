import { describe, expect, it } from "vitest";
import { getStitchedCanvasSize } from "./canvas";

describe("getStitchedCanvasSize", () => {
	it("stacks pages vertically at full scale", () => {
		const size = getStitchedCanvasSize(
			[
				{ width: 1190, height: 1684 },
				{ width: 1190, height: 1684 },
			],
			12000,
		);

		expect(size).toEqual({ width: 1190, height: 3368, scale: 1 });
	});

	it("scales a long resume down to the height ceiling", () => {
		const size = getStitchedCanvasSize(
			Array.from({ length: 10 }, () => ({ width: 1190, height: 1684 })),
			12000,
		);

		expect(size.scale).toBeCloseTo(12000 / 16840, 5);
		expect(size.height).toBe(12000);
		expect(size.width).toBe(Math.round(1190 * (12000 / 16840)));
	});

	it("never enlarges a stack that already fits", () => {
		const size = getStitchedCanvasSize([{ width: 1190, height: 1684 }], 12000);
		expect(size.scale).toBe(1);
	});

	it("uses the widest page for the output width", () => {
		const size = getStitchedCanvasSize(
			[
				{ width: 1190, height: 1684 },
				{ width: 1300, height: 800 },
			],
			12000,
		);

		expect(size.width).toBe(1300);
	});

	it("produces a usable canvas for an empty selection", () => {
		expect(getStitchedCanvasSize([], 12000)).toEqual({ width: 1, height: 1, scale: 1 });
	});
});
