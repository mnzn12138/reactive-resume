/**
 * Geometry, text and drawing helpers for the downloadable QR 名片 card.
 *
 * Everything in this module is pure with respect to React and only touches the DOM when
 * `canvasToPngBlob` is called, so the layout can be unit tested against a recording
 * canvas context (see `qr-card.shared.test.ts`).
 */

import { generateLocalizedFilename } from "@reactive-resume/utils/file";

/** Physical size of the exported card, in pixels. Portrait, 朋友圈 friendly. */
export const QR_CARD_SIZE = { height: 1200, width: 900 } as const;

/** Display size of the QR code inside the dialog preview, in CSS pixels. */
export const QR_CARD_PREVIEW_SIZE = 208;

const QR_CARD_PADDING = 72;
const QR_CARD_ACCENT_HEIGHT = 18;
const QR_CARD_QR_SIZE = 560;
const QR_CARD_QR_TOP = 372;
const QR_CARD_DIVIDER_Y = 312;

const QR_CARD_FONT_FAMILY =
	'"Manrope Variable", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';

const QR_CARD_COLORS = {
	accent: "#111827",
	background: "#ffffff",
	divider: "#e5e7eb",
	muted: "#6b7280",
	subtitle: "#4b5563",
	title: "#111827",
} as const;

export type QrCardTextStyle = { baseline: number; font: string };

export type QrCardLayout = {
	accentHeight: number;
	caption: QrCardTextStyle;
	centerX: number;
	contact: QrCardTextStyle;
	contentWidth: number;
	divider: { inset: number; thickness: number; y: number };
	headline: QrCardTextStyle;
	height: number;
	name: QrCardTextStyle;
	qr: { left: number; size: number; top: number };
	url: QrCardTextStyle;
	width: number;
};

export type QrCardContent = {
	/** Caption printed under the QR code, e.g. 「扫码查看完整简历」. */
	caption: string;
	/** One line of contact details, e.g. `me@example.com · 138… · 上海`. */
	contact: string;
	headline: string;
	name: string;
	url: string;
};

export type QrCardContact = {
	email?: string;
	location?: string;
	phone?: string;
};

export type QrCardHeadingSource = {
	contact: QrCardContact;
	/** Resume title, used when the resume has no author name yet. */
	fallbackName?: string;
	headline?: string;
	name?: string;
};

export type QrCardHeading = {
	contact: string;
	headline: string;
	name: string;
};

/**
 * The subset of `CanvasRenderingContext2D` the card drawing needs. A real 2D context
 * satisfies it structurally, which keeps `drawQrCard` testable without a browser.
 */
export type QrCardDrawContext = {
	drawImage: (image: HTMLCanvasElement, dx: number, dy: number, dWidth: number, dHeight: number) => void;
	fillRect: (x: number, y: number, width: number, height: number) => void;
	fillStyle: string | CanvasGradient | CanvasPattern;
	fillText: (text: string, x: number, y: number) => void;
	font: string;
	measureText: (text: string) => { width: number };
	textAlign: CanvasTextAlign;
};

const font = (size: number, weight = 400) => `${weight} ${size}px ${QR_CARD_FONT_FAMILY}`;

/**
 * Computes every coordinate the card drawing needs from the card constants.
 *
 * @returns The layout of a single card, centred horizontally on `centerX`.
 */
export const getQrCardLayout = (): QrCardLayout => {
	const { height, width } = QR_CARD_SIZE;
	const qrSize = QR_CARD_QR_SIZE;
	const qrTop = QR_CARD_QR_TOP;

	return {
		width,
		height,
		accentHeight: QR_CARD_ACCENT_HEIGHT,
		centerX: width / 2,
		contentWidth: width - QR_CARD_PADDING * 2,
		name: { baseline: 152, font: font(60, 700) },
		headline: { baseline: 214, font: font(34) },
		contact: { baseline: 264, font: font(26) },
		divider: { inset: QR_CARD_PADDING, thickness: 2, y: QR_CARD_DIVIDER_Y },
		qr: { left: (width - qrSize) / 2, size: qrSize, top: qrTop },
		caption: { baseline: qrTop + qrSize + 100, font: font(38, 600) },
		url: { baseline: qrTop + qrSize + 168, font: font(26) },
	};
};

/**
 * Truncates `text` with a trailing ellipsis so it fits `maxWidth`.
 *
 * @param context - Anything that can measure text, e.g. a 2D context or a test double.
 * @param text - The string to fit.
 * @param maxWidth - The maximum width the string may occupy.
 * @returns The original string when it fits, otherwise a truncated one ending in `…`.
 */
export const fitText = (context: Pick<QrCardDrawContext, "measureText">, text: string, maxWidth: number): string => {
	if (!text) return "";
	if (context.measureText(text).width <= maxWidth) return text;

	const ellipsis = "…";
	let truncated = text;

	while (truncated.length > 1 && context.measureText(`${truncated}${ellipsis}`).width > maxWidth) {
		truncated = truncated.slice(0, -1);
	}

	return `${truncated}${ellipsis}`;
};

/**
 * Joins the available contact details into a single line.
 *
 * @param contact - The email, phone and location of the resume author.
 * @returns The non-empty values joined by ` · `, or an empty string.
 */
export const getQrCardContactLine = (contact: QrCardContact): string => {
	const { email, location, phone } = contact;

	return [email, phone, location]
		.map((value) => (value ?? "").trim())
		.filter((value) => value.length > 0)
		.join(" · ");
};

/**
 * Derives the card heading from the resume, falling back to the resume title when the
 * author never filled in their name.
 *
 * @param source - The author name, headline and contact details of the resume.
 * @returns The trimmed name, headline and contact line to print on the card.
 */
export const getQrCardHeading = (source: QrCardHeadingSource): QrCardHeading => {
	const { contact, fallbackName, headline, name } = source;

	return {
		name: (name ?? "").trim() || (fallbackName ?? "").trim(),
		headline: (headline ?? "").trim(),
		contact: getQrCardContactLine(contact),
	};
};

/**
 * Decides whether a QR card can be generated: scanning it is pointless while the
 * resume is private, and a QR code needs a URL to encode.
 *
 * @param options - The public flag of the resume and its public URL.
 * @returns `true` when the QR card button should be enabled.
 */
export const isQrCardAvailable = (options: { isPublic: boolean; url: string }): boolean =>
	Boolean(options.isPublic && options.url.trim());

/**
 * Builds the download filename of the card, keeping CJK characters intact.
 *
 * @param name - The name printed on the card.
 * @param suffix - The localized suffix, e.g. 「名片」.
 * @returns A `.png` filename safe for every mainstream filesystem.
 */
export const getQrCardFilename = (name: string, suffix: string): string =>
	generateLocalizedFilename(`${name}-${suffix}`, "png");

const drawLine = (
	context: QrCardDrawContext,
	text: string,
	style: QrCardTextStyle,
	centerX: number,
	maxWidth: number,
	color: string,
) => {
	if (!text) return;

	context.font = style.font;
	context.fillStyle = color;
	context.fillText(fitText(context, text, maxWidth), centerX, style.baseline);
};

/**
 * Draws the whole 名片 onto a 2D context: white background, accent bar, heading block,
 * divider, the QR code centred, the caption and the URL.
 *
 * @param context - The 2D context of a canvas sized `QR_CARD_SIZE`.
 * @param content - The heading, contact line, caption and URL to print.
 * @param qr - The canvas holding the rendered QR code.
 */
export const drawQrCard = (context: QrCardDrawContext, content: QrCardContent, qr: HTMLCanvasElement) => {
	const layout = getQrCardLayout();
	const { centerX, contentWidth, height, width } = layout;

	context.fillStyle = QR_CARD_COLORS.background;
	context.fillRect(0, 0, width, height);

	context.fillStyle = QR_CARD_COLORS.accent;
	context.fillRect(0, 0, width, layout.accentHeight);

	context.fillStyle = QR_CARD_COLORS.divider;
	context.fillRect(layout.divider.inset, layout.divider.y, contentWidth, layout.divider.thickness);

	context.textAlign = "center";
	drawLine(context, content.name, layout.name, centerX, contentWidth, QR_CARD_COLORS.title);
	drawLine(context, content.headline, layout.headline, centerX, contentWidth, QR_CARD_COLORS.subtitle);
	drawLine(context, content.contact, layout.contact, centerX, contentWidth, QR_CARD_COLORS.muted);
	drawLine(context, content.caption, layout.caption, centerX, contentWidth, QR_CARD_COLORS.title);
	drawLine(context, content.url, layout.url, centerX, contentWidth, QR_CARD_COLORS.muted);

	context.drawImage(qr, layout.qr.left, layout.qr.top, layout.qr.size, layout.qr.size);
};
