import type { Locale } from "@reactive-resume/utils/locale";
import { existsSync, readFileSync } from "node:fs";
import { isLocale } from "@reactive-resume/utils/locale";

/**
 * Prompts ship in two languages. `zh-CN` is the default because this fork is
 * Chinese-first: the UI default locale is `zh-CN`, so a caller that forgets to
 * pass a locale still gets instructions the user can read.
 *
 * `zh-TW` deliberately maps onto `zh-CN` prompts: the difference between the two
 * catalogs is UI wording, and a second near-identical prompt set would drift
 * without adding value.
 */
const promptLocales = ["en-US", "zh-CN"] as const;

type PromptLocale = (typeof promptLocales)[number];

const defaultPromptLocale: PromptLocale = "zh-CN";

/** Maps an app locale onto a prompt variant; anything unknown falls back to the default. */
const resolvePromptLocale = (locale?: Locale | string | null): PromptLocale => {
	if (!locale || !isLocale(locale)) return defaultPromptLocale;
	return locale === "en-US" ? "en-US" : "zh-CN";
};

/** Reads `<name>.<locale>.md` when it exists, otherwise the locale-less `<name>.md`. */
function readPrompt(name: string, locale: PromptLocale): string {
	const localized = new URL(`./prompts/${name}.${locale}.md`, import.meta.url);

	if (existsSync(localized)) return readFileSync(localized, "utf-8");

	return readFileSync(new URL(`./prompts/${name}.md`, import.meta.url), "utf-8");
}

type ParserVars = {
	FORMAT_HEADER: string;
	FORMAT_NOUN: string;
	ALLOWED_INPUT: string;
	URL_CLAUSE: string;
	EXTRA_RULES: string;
	FALLBACK_CLAUSE: string;
};

// ponytail: single template with per-source substitutions; produced text is identical per source type
const parserVars: Record<PromptLocale, { pdf: ParserVars; docx: ParserVars }> = {
	"en-US": {
		pdf: {
			FORMAT_HEADER: "PDF files",
			FORMAT_NOUN: "PDF",
			ALLOWED_INPUT:
				"- Use only the visible content from the attached PDF document.\n- Ignore OCR noise, watermarks, repeated headers/footers, and broken line wraps.",
			URL_CLAUSE: "full URLs that are explicitly present",
			EXTRA_RULES: "",
			FALLBACK_CLAUSE: "PDF is low quality or partially unreadable",
		},
		docx: {
			FORMAT_HEADER: "Microsoft Word files (DOC/DOCX)",
			FORMAT_NOUN: "document",
			ALLOWED_INPUT:
				"- Use only visible, intended content from the attached document.\n- Ignore hidden text, comments, track changes, revision history, document metadata, and layout artifacts.",
			URL_CLAUSE: "URLs explicitly visible in document content",
			EXTRA_RULES:
				"- Lists and tables: extract visible text faithfully; preserve relationships in section fields.\n- Headers/footers: include only if they contain real resume data.\n",
			FALLBACK_CLAUSE: "document is malformed or partially unreadable",
		},
	},
	"zh-CN": {
		pdf: {
			FORMAT_HEADER: "PDF 文件",
			FORMAT_NOUN: "PDF",
			ALLOWED_INPUT: "- 只使用附件 PDF 中可见的内容。\n- 忽略 OCR 噪声、水印、重复的页眉页脚,以及被断开的换行。",
			URL_CLAUSE: "原文中明确写出的完整网址",
			EXTRA_RULES: "",
			FALLBACK_CLAUSE: "PDF 质量过差或部分不可读",
		},
		docx: {
			FORMAT_HEADER: "Microsoft Word 文件(DOC/DOCX)",
			FORMAT_NOUN: "文档",
			ALLOWED_INPUT:
				"- 只使用附件中可见、且确实是简历正文的内容。\n- 忽略隐藏文字、批注、修订记录、版本历史、文档元数据和排版残留。",
			URL_CLAUSE: "正文中明确可见的链接",
			EXTRA_RULES:
				"- 列表与表格:如实抽取可见文字,并把对应关系保留到分区字段里。\n- 页眉页脚:只有确实含有简历信息时才收录。\n",
			FALLBACK_CLAUSE: "文档损坏或部分不可读",
		},
	},
};

function makeParserPrompt(template: string, vars: ParserVars): string {
	return Object.entries(vars).reduce((acc, [k, v]) => acc.replaceAll(`{{${k}}}`, v), template);
}

type PromptSet = {
	atsReviewSystemPrompt: string;
	atsReviewUserPromptTemplate: string;
	chatSystemPromptTemplate: string;
	docxParserSystemPrompt: string;
	docxParserUserPrompt: string;
	pdfParserSystemPrompt: string;
	pdfParserUserPrompt: string;
};

/** Loads every prompt for one locale. Cheap enough to call per request; no caching by design. */
function loadPrompts(locale?: Locale | string | null): PromptSet {
	const promptLocale = resolvePromptLocale(locale);
	const parserTemplate = readPrompt("parser-system", promptLocale);

	return {
		atsReviewSystemPrompt: readPrompt("ats-review-system", promptLocale),
		atsReviewUserPromptTemplate: readPrompt("ats-review-user", promptLocale),
		chatSystemPromptTemplate: readPrompt("chat-system", promptLocale),
		docxParserSystemPrompt: makeParserPrompt(parserTemplate, parserVars[promptLocale].docx),
		docxParserUserPrompt: readPrompt("docx-parser-user", promptLocale),
		pdfParserSystemPrompt: makeParserPrompt(parserTemplate, parserVars[promptLocale].pdf),
		pdfParserUserPrompt: readPrompt("pdf-parser-user", promptLocale),
	};
}

export { defaultPromptLocale, loadPrompts, type PromptLocale, type PromptSet, promptLocales, resolvePromptLocale };
