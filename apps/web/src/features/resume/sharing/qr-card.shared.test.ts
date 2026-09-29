import type { QrCardDrawContext } from "./qr-card.shared";
import { describe, expect, it } from "vitest";
import {
	drawQrCard,
	fitText,
	getQrCardContactLine,
	getQrCardFilename,
	getQrCardHeading,
	getQrCardLayout,
	isQrCardAvailable,
	QR_CARD_SIZE,
} from "./qr-card.shared";

/** Records every drawing call so the geometry can be asserted without a browser canvas. */
const createRecordingContext = (charWidth: number) => {
	const calls: string[] = [];

	const context: QrCardDrawContext = {
		drawImage: (_image, dx, dy, dWidth, dHeight) => {
			calls.push(`drawImage:${dx},${dy},${dWidth},${dHeight}`);
		},
		fillRect: (x, y, width, height) => {
			calls.push(`fillRect:${x},${y},${width},${height}`);
		},
		fillStyle: "",
		fillText: (text, x, y) => {
			calls.push(`fillText:${text}@${x},${y}`);
		},
		font: "",
		measureText: (text) => ({ width: text.length * charWidth }),
		textAlign: "left",
	};

	return { calls, context };
};

const qrCanvas = { width: QR_CARD_SIZE.width, height: QR_CARD_SIZE.height } as unknown as HTMLCanvasElement;

describe("getQrCardLayout", () => {
	const layout = getQrCardLayout();

	it("uses the portrait card size that is friendly to 朋友圈", () => {
		expect(layout.width).toBe(900);
		expect(layout.height).toBe(1200);
		expect(layout.height).toBeGreaterThan(layout.width);
	});

	it("centres the QR code horizontally and keeps it inside the card", () => {
		expect(layout.qr.left).toBe((layout.width - layout.qr.size) / 2);
		expect(layout.qr.left).toBeGreaterThan(0);
		expect(layout.qr.left + layout.qr.size).toBe(layout.width - layout.qr.left);
		expect(layout.qr.top + layout.qr.size).toBeLessThan(layout.height);
	});

	it("orders the heading, divider, QR code, caption and URL from top to bottom", () => {
		const baselines = [
			layout.name.baseline,
			layout.headline.baseline,
			layout.contact.baseline,
			layout.divider.y,
			layout.qr.top,
			layout.qr.top + layout.qr.size,
			layout.caption.baseline,
			layout.url.baseline,
		];

		expect(baselines).toEqual([...baselines].sort((a, b) => a - b));
		expect(layout.url.baseline).toBeLessThan(layout.height);
		expect(layout.name.baseline).toBeGreaterThan(layout.accentHeight);
	});

	it("insets the content by the same padding on both sides", () => {
		expect(layout.contentWidth).toBe(layout.width - layout.divider.inset * 2);
		expect(layout.centerX).toBe(layout.width / 2);
	});
});

describe("fitText", () => {
	it("returns short text unchanged", () => {
		const { context } = createRecordingContext(10);
		expect(fitText(context, "张三", 100)).toBe("张三");
	});

	it("returns an empty string for empty input", () => {
		const { context } = createRecordingContext(10);
		expect(fitText(context, "", 100)).toBe("");
	});

	it("truncates long text down to the width budget with an ellipsis", () => {
		const { context } = createRecordingContext(10);
		const result = fitText(context, "a".repeat(50), 100);

		expect(result.endsWith("…")).toBe(true);
		expect(result.length).toBeLessThan(50);
		expect(context.measureText(result).width).toBeLessThanOrEqual(100);
	});

	it("keeps at least one character before the ellipsis", () => {
		const { context } = createRecordingContext(1000);
		expect(fitText(context, "张三", 10)).toBe("张…");
	});
});

describe("getQrCardContactLine", () => {
	it("joins every available contact detail with a middle dot", () => {
		expect(getQrCardContactLine({ email: "me@example.com", phone: "13800000000", location: "上海" })).toBe(
			"me@example.com · 13800000000 · 上海",
		);
	});

	it("skips blank values", () => {
		expect(getQrCardContactLine({ email: "me@example.com", phone: "  ", location: "" })).toBe("me@example.com");
	});

	it("returns an empty string when nothing is filled in", () => {
		expect(getQrCardContactLine({})).toBe("");
		expect(getQrCardContactLine({ email: undefined })).toBe("");
	});
});

describe("getQrCardHeading", () => {
	it("prefers the author name", () => {
		expect(getQrCardHeading({ name: "张三", fallbackName: "我的简历", contact: {} })).toMatchObject({
			name: "张三",
		});
	});

	it("falls back to the resume title when the author name is blank", () => {
		expect(getQrCardHeading({ name: "  ", fallbackName: "我的简历", contact: {} })).toMatchObject({
			name: "我的简历",
		});
	});

	it("trims the headline and derives the contact line", () => {
		expect(
			getQrCardHeading({ name: "张三", headline: "  前端工程师  ", contact: { email: "me@example.com" } }),
		).toEqual({ name: "张三", headline: "前端工程师", contact: "me@example.com" });
	});
});

describe("isQrCardAvailable", () => {
	it("is unavailable while the resume is private", () => {
		expect(isQrCardAvailable({ isPublic: false, url: "https://example.com/u/r" })).toBe(false);
	});

	it("is unavailable when there is no public URL to encode", () => {
		expect(isQrCardAvailable({ isPublic: true, url: "" })).toBe(false);
		expect(isQrCardAvailable({ isPublic: true, url: "   " })).toBe(false);
	});

	it("is available for a public resume with a URL", () => {
		expect(isQrCardAvailable({ isPublic: true, url: "https://example.com/u/r" })).toBe(true);
	});
});

describe("getQrCardFilename", () => {
	it("keeps CJK characters and appends the .png extension", () => {
		expect(getQrCardFilename("张三", "名片")).toBe("张三-名片.png");
	});

	it("drops characters filesystems reject", () => {
		expect(getQrCardFilename("re:sume", "名片")).toBe("re-sume-名片.png");
	});

	it("falls back to the suffix alone when there is no name", () => {
		expect(getQrCardFilename("", "名片")).toBe("名片.png");
	});
});

describe("drawQrCard", () => {
	const content = {
		caption: "扫码查看完整简历",
		contact: "me@example.com · 上海",
		headline: "前端工程师",
		name: "张三",
		url: "https://example.com/owner/resume",
	};

	it("paints the background, the accent bar and the divider", () => {
		const { calls, context } = createRecordingContext(10);
		const layout = getQrCardLayout();

		drawQrCard(context, content, qrCanvas);

		expect(calls[0]).toBe(`fillRect:0,0,${layout.width},${layout.height}`);
		expect(calls[1]).toBe(`fillRect:0,0,${layout.width},${layout.accentHeight}`);
		expect(calls[2]).toBe(
			`fillRect:${layout.divider.inset},${layout.divider.y},${layout.contentWidth},${layout.divider.thickness}`,
		);
	});

	it("draws the QR code at the centred square the layout reserves", () => {
		const { calls, context } = createRecordingContext(10);
		const layout = getQrCardLayout();

		drawQrCard(context, content, qrCanvas);

		expect(calls).toContain(`drawImage:${layout.qr.left},${layout.qr.top},${layout.qr.size},${layout.qr.size}`);
	});

	it("centres every line of text on the card", () => {
		const { calls, context } = createRecordingContext(10);
		const layout = getQrCardLayout();

		drawQrCard(context, content, qrCanvas);

		const texts = calls.filter((call) => call.startsWith("fillText:"));
		expect(texts).toHaveLength(5);
		for (const text of texts) {
			expect(text).toContain(`@${layout.centerX},`);
		}
		expect(context.textAlign).toBe("center");
	});

	it("truncates a heading that is wider than the content area", () => {
		const { calls, context } = createRecordingContext(40);
		const layout = getQrCardLayout();

		drawQrCard(context, { ...content, name: "A".repeat(100) }, qrCanvas);

		const nameCall = calls.find((call) => call.startsWith("fillText:AAA"));
		if (!nameCall) throw new Error("The name line was not drawn");
		const drawn = nameCall.slice("fillText:".length).split("@")[0];
		expect(drawn.endsWith("…")).toBe(true);
		expect(context.measureText(drawn).width).toBeLessThanOrEqual(layout.contentWidth);
	});

	it("skips empty optional lines instead of printing a stray separator", () => {
		const { calls, context } = createRecordingContext(10);

		drawQrCard(context, { ...content, headline: "", contact: "" }, qrCanvas);

		expect(calls.filter((call) => call.startsWith("fillText:"))).toHaveLength(3);
	});
});
