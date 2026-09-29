import type { CustomSectionType, ResumeData } from "@reactive-resume/schema/resume/data";
import type { AtsRuleCode } from "./catalog";
import type { AtsFinding, AtsFindingParams } from "./types";
import type { WalkedItem, WalkedSection } from "./walk";
import { atsRuleSeverity } from "./catalog";
import { isFutureEndpoint, isReversedPeriod, parsePeriod, parseSingleDate } from "./period";
import { SECTION_TITLE_ALIASES } from "./section-aliases";
import { isRenderedSection } from "./walk";

export type RuleContext = {
	data: ResumeData;
	sections: readonly WalkedSection[];
	locale: string;
	now: Date;
};

export type AtsRule = (context: RuleContext) => AtsFinding[];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const ALLOWED_URL_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

const PERIOD_REQUIRED_TYPES = new Set<CustomSectionType>(["experience", "education"]);

const PROSE_SECTION_TYPES = new Set<CustomSectionType>(["summary", "experience", "education", "projects", "volunteer"]);

const MIN_BODY_FONT_SIZE = 9;
const MIN_LINE_HEIGHT = 1.15;
const MIN_PAGE_MARGIN = 8;

/**
 * Rich-text keys written by the editor. `description` covers every item type that carries prose
 * (experience, education, projects, volunteer, awards, certifications, publications, references);
 * `content` covers the summary and any custom section of type summary.
 */
const RICH_TEXT_KEYS = new Set(["description", "content"]);

/**
 * Private use area (U+E000–U+F8FF). Icon fonts map their glyphs here, so the codepoint carries
 * no meaning outside the font that shipped it — a parser reading the characters sees placeholder
 * noise, and CJK parsers in particular tend to drop the whole run. Corporate-use subtypes beyond
 * U+F8FF are excluded on purpose: those planes hold real, if rare, assigned characters.
 */
const PRIVATE_USE_CHARACTER = /[\uE000-\uF8FF]/;

/**
 * Fullwidth digits and the fullwidth separators a Chinese IME produces when it is left in
 * fullwidth mode. Fullwidth punctuation in running prose is normal and is *not* reported — see
 * `characterRules` — but inside a date it is what stops a date parser from matching at all.
 */
const FULLWIDTH_DATE_CHARACTER = /[\uFF10-\uFF19\uFF0D\uFF0E\uFF0F]/;

/**
 * Decorative glyphs used as list bullets. Deliberately narrow: `•`, `·`, `-`, `*`, `+`, `–`, `—`
 * and `>` are the shapes every parser already copes with, and `○`/`●`/`✓`/`✔` are so common in
 * Chinese resumes that flagging them would light up correct documents. Only the shapes that read
 * as icon-font decoration are listed.
 */
const NON_STANDARD_BULLET_CHARACTERS = new Set([
	"◆",
	"◇",
	"◈",
	"❖",
	"✦",
	"✧",
	"✱",
	"✳",
	"✴",
	"✵",
	"➤",
	"➢",
	"►",
	"▶",
	"▪",
	"▫",
	"▸",
	"▹",
	"■",
	"□",
	"❑",
	"❒",
	"»",
	"›",
]);

function finding(code: AtsRuleCode, pointer: string, params?: AtsFindingParams): AtsFinding {
	return { code, severity: atsRuleSeverity(code), pointer, ...(params ? { params } : {}) };
}

const textOf = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const hasText = (value: unknown) =>
	typeof value === "string" &&
	value
		.replace(/<[^>]*>/g, "")
		.replace(/&nbsp;/g, " ")
		.trim().length > 0;

/** Markup stripped, entities unwrapped — the characters a parser would actually receive. */
function stripMarkup(html: string): string {
	return html
		.replace(/<[^>]*>/g, "")
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.trim();
}

/**
 * Flattens rich text into lines so a bullet glyph can be found at a line start. Only block and
 * list boundaries break a line: a glyph mid-sentence is ordinary punctuation, not a bullet.
 */
function htmlToLines(html: string): string[] {
	return html
		.replace(/<(?:br|p|li|div|tr|h[1-6])\b[^>]*>/gi, "\n")
		.replace(/<\/(?:p|li|div|tr|h[1-6]|ul|ol|table)>/gi, "\n")
		.replace(/<[^>]*>/g, "")
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.split("\n");
}

/** The first decorative bullet glyph standing at the start of a line, if there is one. */
function leadingBulletGlyph(html: string): string | null {
	for (const line of htmlToLines(html)) {
		const trimmed = line.replace(/^[\s\u00A0]+/, "");
		const glyph = trimmed[0];
		if (glyph && NON_STANDARD_BULLET_CHARACTERS.has(glyph)) return glyph;
	}
	return null;
}

type TextField = { pointer: string; value: string };

type RichTextField = { pointer: string; html: string };

/**
 * Every plain-text string a parser would receive, paired with the pointer that owns it. Markup is
 * stripped here so a character scan sees what the file will say, not the HTML that produced it.
 */
function* textFields(context: RuleContext): Generator<TextField> {
	const { basics } = context.data;

	yield { pointer: "/basics/name", value: basics.name };
	yield { pointer: "/basics/headline", value: basics.headline };
	yield { pointer: "/basics/location", value: basics.location };

	for (const [index, field] of basics.customFields.entries()) {
		yield { pointer: `/basics/customFields/${index}/text`, value: field.text };
	}

	for (const section of context.sections) {
		if (!isRenderedSection(section)) continue;

		yield { pointer: `${section.pointer}/title`, value: section.title };

		for (const item of section.items) {
			for (const [key, raw] of Object.entries(item.value)) {
				if (typeof raw === "string") yield { pointer: `${item.pointer}/${key}`, value: stripMarkup(raw) };
			}

			const roles = item.value.roles;
			if (!Array.isArray(roles)) continue;

			for (const [index, role] of roles.entries()) {
				for (const [key, raw] of Object.entries(role as Record<string, unknown>)) {
					if (typeof raw !== "string") {
						continue;
					}
					yield { pointer: `${item.pointer}/roles/${index}/${key}`, value: stripMarkup(raw) };
				}
			}
		}
	}
}

/**
 * Every rich-text field of an item, including the descriptions of its nested roles. Table, image
 * and bullet checks all need the same walk, so it lives here rather than in each rule.
 */
function richTextFields(item: WalkedItem): RichTextField[] {
	const fields: RichTextField[] = [];

	for (const key of RICH_TEXT_KEYS) {
		const raw = item.value[key];
		if (typeof raw === "string") fields.push({ pointer: `${item.pointer}/${key}`, html: raw });
	}

	const roles = item.value.roles;
	if (!Array.isArray(roles)) return fields;

	roles.forEach((role, index) => {
		const description = (role as Record<string, unknown>).description;
		if (typeof description === "string") {
			fields.push({ pointer: `${item.pointer}/roles/${index}/description`, html: description });
		}
	});

	return fields;
}

function isParseableUrl(value: string): boolean {
	try {
		return ALLOWED_URL_PROTOCOLS.has(new URL(value).protocol);
	} catch {
		return false;
	}
}

const contactRules: AtsRule = (context) => {
	const { basics, picture } = context.data;
	const findings: AtsFinding[] = [];

	if (!basics.name.trim()) findings.push(finding("MISSING_NAME", "/basics/name"));

	const email = basics.email.trim();
	if (email) {
		if (!EMAIL_PATTERN.test(email)) findings.push(finding("MALFORMED_EMAIL", "/basics/email", { value: email }));
	} else {
		findings.push(finding("MISSING_EMAIL", "/basics/email"));
	}

	if (!basics.phone.trim()) findings.push(finding("MISSING_PHONE", "/basics/phone"));
	if (!basics.location.trim()) findings.push(finding("MISSING_LOCATION", "/basics/location"));
	if (!picture.hidden && picture.url.trim()) findings.push(finding("PICTURE_PRESENT", "/picture"));

	return findings;
};

const urlRules: AtsRule = (context) => {
	const findings: AtsFinding[] = [];

	const website = context.data.basics.website.url.trim();
	if (website && !isParseableUrl(website)) {
		findings.push(finding("MALFORMED_URL", "/basics/website/url", { value: website }));
	}

	context.data.basics.customFields.forEach((field, index) => {
		const link = field.link.trim();
		if (link && !isParseableUrl(link)) {
			findings.push(finding("MALFORMED_URL", `/basics/customFields/${index}/link`, { value: link }));
		}
	});

	for (const section of context.sections) {
		if (!isRenderedSection(section)) continue;

		for (const item of section.items) {
			const itemWebsite = item.value.website as { url?: unknown } | undefined;
			const url = typeof itemWebsite?.url === "string" ? itemWebsite.url.trim() : "";
			if (url && !isParseableUrl(url)) {
				findings.push(finding("MALFORMED_URL", `${item.pointer}/website/url`, { value: url }));
			}
		}
	}

	return findings;
};

function periodFindings(raw: unknown, pointer: string, type: CustomSectionType, context: RuleContext): AtsFinding[] {
	if (typeof raw !== "string") return [];

	const value = raw.trim();
	if (!value) return PERIOD_REQUIRED_TYPES.has(type) ? [finding("EMPTY_PERIOD", pointer)] : [];

	// Reported ahead of the parse check and returned alone: a fullwidth date is almost always
	// unparseable too, and naming the cause is more useful than reporting both.
	if (FULLWIDTH_DATE_CHARACTER.test(value)) {
		return [finding("FULLWIDTH_DATE_CHARACTER", pointer, { value })];
	}

	const parsed = parsePeriod(value, context.locale);
	if (!parsed) return [finding("UNPARSEABLE_PERIOD", pointer, { value })];

	const findings: AtsFinding[] = [];

	// Domestic parsers rebuild a timeline from a "company - title - start - end" character
	// pattern, so a period that reads but never ends gives them only half of it: "2019" is stored
	// as a start with no duration, and an unfinished range is indistinguishable from a typo. An
	// ongoing marker is complete and is not reported, and neither is a section type that only ever
	// carries a single date anyway.
	if (PERIOD_REQUIRED_TYPES.has(type) && !parsed.end && !parsed.ongoing) {
		findings.push(finding("INCOMPLETE_PERIOD", pointer, { value }));
	}

	if (parsed.start && parsed.end && isReversedPeriod(parsed.start, parsed.end)) {
		findings.push(finding("REVERSED_PERIOD", pointer, { value }));
	}
	if (parsed.start && isFutureEndpoint(parsed.start, context.now)) {
		findings.push(finding("FUTURE_DATED_PERIOD", pointer, { value }));
	}

	return findings;
}

function singleDateFindings(raw: unknown, pointer: string, context: RuleContext): AtsFinding[] {
	if (typeof raw !== "string") return [];

	const value = raw.trim();
	if (!value) return [];

	if (FULLWIDTH_DATE_CHARACTER.test(value)) {
		return [finding("FULLWIDTH_DATE_CHARACTER", pointer, { value })];
	}

	return parseSingleDate(value, context.locale) ? [] : [finding("UNPARSEABLE_DATE", pointer, { value })];
}

const dateRules: AtsRule = (context) => {
	const findings: AtsFinding[] = [];

	for (const section of context.sections) {
		if (!isRenderedSection(section)) continue;

		for (const item of section.items) {
			findings.push(...periodFindings(item.value.period, `${item.pointer}/period`, section.type, context));
			findings.push(...singleDateFindings(item.value.date, `${item.pointer}/date`, context));

			const roles = item.value.roles;
			if (!Array.isArray(roles)) continue;

			roles.forEach((role, index) => {
				const value = (role as Record<string, unknown>).period;
				findings.push(...periodFindings(value, `${item.pointer}/roles/${index}/period`, section.type, context));
			});
		}
	}

	return findings;
};

const structureRules: AtsRule = (context) => {
	const findings: AtsFinding[] = [];

	// A section with no items is not reported: every template's renderer returns null before it
	// emits a heading, so an empty section produces nothing on the page rather than a bare title.
	// Only content that can never render — placed on no page at all — is worth a finding.
	for (const section of context.sections) {
		if (section.hidden) continue;

		if (section.placement === "none" && section.items.length > 0) {
			findings.push(finding("SECTION_MISSING_FROM_LAYOUT", section.pointer, { section: section.id }));
		}
	}

	const experienceSections = context.sections.filter(
		(section) => section.type === "experience" && isRenderedSection(section),
	);

	if (!experienceSections.some((section) => section.items.length > 0)) {
		findings.push(finding("NO_VISIBLE_EXPERIENCE", "/sections/experience"));
	}

	for (const section of experienceSections) {
		for (const item of section.items) {
			const roles = item.value.roles;
			const roleHasText =
				Array.isArray(roles) && roles.some((role) => hasText((role as Record<string, unknown>).description));

			if (!hasText(item.value.description) && !roleHasText) {
				findings.push(finding("MISSING_EXPERIENCE_DESCRIPTION", `${item.pointer}/description`));
			}

			// 公司 - 职位 - 起止时间 is the character pattern a domestic parser matches an experience
			// entry on, and the title is the middle of it. An employer with no title under it is
			// stored as a company and nothing else, so the role never lands on the timeline.
			//
			// Not reported: an entry whose titles all live on nested roles — that is the shape the
			// schema encourages for career progression, and each role carries its own title.
			const roleHasPosition =
				Array.isArray(roles) && roles.some((role) => textOf((role as Record<string, unknown>).position).length > 0);

			if (!textOf(item.value.position) && !roleHasPosition) {
				findings.push(finding("MISSING_EXPERIENCE_POSITION", `${item.pointer}/position`));
			}
		}
	}

	return findings;
};

const titleRules: AtsRule = (context) => {
	if (!context.locale.toLowerCase().startsWith("en")) return [];

	const findings: AtsFinding[] = [];

	for (const section of context.sections) {
		if (!isRenderedSection(section)) continue;

		const title = section.title.trim();
		if (!title) continue;

		const aliases = SECTION_TITLE_ALIASES[section.type];
		if (!aliases || aliases.has(title.toLowerCase())) continue;

		findings.push(finding("NON_STANDARD_SECTION_TITLE", `${section.pointer}/title`, { section: section.id, title }));
	}

	return findings;
};

const layoutRules: AtsRule = (context) => {
	const findings: AtsFinding[] = [];

	for (const section of context.sections) {
		if (!isRenderedSection(section)) continue;
		if (!PROSE_SECTION_TYPES.has(section.type) || section.items.length === 0) continue;

		if (section.columns > 1) {
			findings.push(
				finding("MULTI_COLUMN_PROSE_SECTION", `${section.pointer}/columns`, {
					section: section.id,
					columns: section.columns,
				}),
			);
		}

		if (section.placement === "sidebar") {
			findings.push(finding("PROSE_SECTION_IN_SIDEBAR", section.pointer, { section: section.id }));
		}
	}

	return findings;
};

const typographyRules: AtsRule = (context) => {
	const findings: AtsFinding[] = [];
	const { page, typography } = context.data.metadata;

	if (typography.body.fontSize < MIN_BODY_FONT_SIZE) {
		findings.push(
			finding("SMALL_BODY_FONT", "/metadata/typography/body/fontSize", {
				fontSize: typography.body.fontSize,
				minimum: MIN_BODY_FONT_SIZE,
			}),
		);
	}

	if (typography.body.lineHeight < MIN_LINE_HEIGHT) {
		findings.push(
			finding("TIGHT_LINE_HEIGHT", "/metadata/typography/body/lineHeight", {
				lineHeight: typography.body.lineHeight,
				minimum: MIN_LINE_HEIGHT,
			}),
		);
	}

	for (const axis of ["marginX", "marginY"] as const) {
		if (page[axis] < MIN_PAGE_MARGIN) {
			findings.push(
				finding("TIGHT_PAGE_MARGINS", `/metadata/page/${axis}`, { margin: page[axis], minimum: MIN_PAGE_MARGIN }),
			);
		}
	}

	return findings;
};

/**
 * Two-column detection at page level.
 *
 * `MULTI_COLUMN_PROSE_SECTION` and `PROSE_SECTION_IN_SIDEBAR` already cover the two section-level
 * shapes; this covers the page itself, because a domestic parser decides reading order per page
 * and a page split down the middle is the single shape it most often reads wrong — even when every
 * section in the side column is a short, self-contained list.
 *
 * Not reported: a page whose side column is empty, which renders full width whatever `fullWidth`
 * says; a page with nothing on one side; and every page after the first offender, since the fix is
 * one layout decision rather than one fix per page.
 */
const pageLayoutRules: AtsRule = (context) => {
	const carrying = new Set(
		context.sections.filter((section) => isRenderedSection(section) && section.items.length > 0).map((s) => s.id),
	);

	for (const [index, page] of context.data.metadata.layout.pages.entries()) {
		if (page.fullWidth) continue;

		const hasMain = page.main.some((id) => carrying.has(id));
		const hasSidebar = page.sidebar.some((id) => carrying.has(id));
		if (!hasMain || !hasSidebar) continue;

		return [finding("TWO_COLUMN_PAGE_LAYOUT", `/metadata/layout/pages/${index}`, { page: index })];
	}

	return [];
};

/**
 * Tables.
 *
 * A domestic parser walks a document as a stream of text runs; a table cell is either flattened
 * out of position or dropped entirely, which is why the guidance is that no key entry may live
 * inside one. Rich text is the only place a user can author a table, so that is all this inspects,
 * and it reports per field so the author is pointed at the exact entry.
 *
 * Not reported: anything that is not markup the editor actually emits as a table — a bare `<table`
 * fragment that never closes is still a table as far as the renderer is concerned, so it counts.
 */
const tableRules: AtsRule = (context) => {
	const findings: AtsFinding[] = [];

	for (const section of context.sections) {
		if (!isRenderedSection(section)) continue;

		for (const item of section.items) {
			for (const field of richTextFields(item)) {
				if (/<table[\s>]/i.test(field.html)) findings.push(finding("ENTRY_CONTENT_IN_TABLE", field.pointer));
			}
		}
	}

	return findings;
};

/**
 * Images and icons standing in for text.
 *
 * A 证件照 is convention in a Chinese resume and is *not* what this reports — that is
 * `PICTURE_PRESENT`, and it stays a note. What is reported is a field that renders an image and no
 * text at all: a scanned certificate, a screenshot standing in for a project description, a radar
 * chart of skills. There is nothing for a parser to read, and a CJK parser that tries tends to
 * emit the surrounding whitespace as garbage.
 *
 * Not reported: an image with text alongside it, which loses nothing if the image is dropped; and
 * a contact field whose icon is decorative because its text and link both carry the value.
 */
const imageTextRules: AtsRule = (context) => {
	const findings: AtsFinding[] = [];

	for (const section of context.sections) {
		if (!isRenderedSection(section)) continue;

		for (const item of section.items) {
			for (const field of richTextFields(item)) {
				if (!/<img[\s>]/i.test(field.html)) continue;
				if (stripMarkup(field.html)) continue;

				findings.push(finding("ENTRY_CONTENT_IMAGE_ONLY", field.pointer));
			}
		}
	}

	for (const [index, field] of context.data.basics.customFields.entries()) {
		if (!field.icon.trim() || field.text.trim() || field.link.trim()) continue;

		findings.push(finding("ICON_ONLY_CUSTOM_FIELD", `/basics/customFields/${index}/icon`));
	}

	return findings;
};

/**
 * Characters.
 *
 * Two things are reported here, and a great deal is deliberately not. Private use area glyphs come
 * from icon fonts and mean nothing outside the file that shipped them. Decorative bullets are
 * reported only where they open a line of prose, which is the only place they act as list markers.
 *
 * Not reported: fullwidth punctuation in running prose. 「：」「，」「。」 are how a Chinese resume
 * is written and every domestic parser handles them; flagging them would light up correct
 * documents. Fullwidth digits are checked in the date rules instead, because inside a date they
 * defeat the parser outright and there is no upside to the author in keeping them.
 */
const characterRules: AtsRule = (context) => {
	const findings: AtsFinding[] = [];

	for (const field of textFields(context)) {
		if (PRIVATE_USE_CHARACTER.test(field.value)) {
			findings.push(finding("TEXT_PRIVATE_USE_CHARACTER", field.pointer));
		}
	}

	for (const section of context.sections) {
		if (!isRenderedSection(section)) continue;
		if (!PROSE_SECTION_TYPES.has(section.type)) continue;

		for (const item of section.items) {
			for (const field of richTextFields(item)) {
				const glyph = leadingBulletGlyph(field.html);
				if (glyph) {
					findings.push(finding("NON_STANDARD_BULLET_CHARACTER", field.pointer, { character: glyph }));
				}
			}
		}
	}

	return findings;
};

export const ATS_RULES: readonly AtsRule[] = [
	contactRules,
	urlRules,
	dateRules,
	structureRules,
	titleRules,
	layoutRules,
	typographyRules,
	pageLayoutRules,
	tableRules,
	imageTextRules,
	characterRules,
];
