import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { Template } from "@reactive-resume/schema/templates";
import { describe, expect, it } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { act, createElement } from "react";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { ResumeDocument } from "../document";

/**
 * Renders a real PDF and returns every glyph pdf.js can recover from it.
 *
 * The unit tests next to each template only assert registry wiring and source
 * shape; they never prove that a domestic field actually reaches the page.
 * This is the check that does, so it deliberately goes through
 * `renderToBuffer` instead of inspecting React elements.
 */
const renderText = async (template: Template, customFields: readonly string[]): Promise<string> => {
	const data = structuredClone(defaultResumeData) as ResumeData;
	data.basics.name = "张伟";
	data.basics.headline = "软件工程师";
	data.basics.customFields = customFields.map((text, index) => ({
		id: `cn-${index}`,
		icon: "user",
		text,
		link: "",
	}));

	const element = createElement(ResumeDocument, { data, template }) as unknown as Parameters<typeof renderToBuffer>[0];

	let bytes = new Uint8Array();

	await act(async () => {
		bytes = new Uint8Array(await renderToBuffer(element));
	});

	const pdfDocument = await getDocument({ data: bytes.slice(), useSystemFonts: true }).promise;
	const chunks: string[] = [];

	for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
		const page = await pdfDocument.getPage(pageNumber);
		const content = await page.getTextContent();
		chunks.push(...content.items.map((item) => ("str" in item ? item.str : "")));
	}

	return chunks.join("");
};

const domesticFields = ["性别：男", "出生年月：1998-06", "民族：汉族", "政治面貌：中共党员", "籍贯：浙江杭州"] as const;

describe("Chinese template family renders domestic content", () => {
	it.each(["zhuque", "qinglong", "xuanwu"] as const)(
		"%s renders the Chinese name and headline it is given",
		async (template) => {
			const text = await renderText(template, domesticFields);

			expect(text).toContain("张伟");
			expect(text).toContain("软件工程师");
		},
		120_000,
	);

	it("xuanwu lifts every recognised domestic field into its information band", async () => {
		const text = await renderText("xuanwu", domesticFields);

		for (const field of domesticFields) {
			const [label, value] = field.split(/[：:]/);
			expect(text, `label: ${label}`).toContain(label);
			expect(text, `value: ${value}`).toContain(value);
		}
	}, 120_000);

	it("xuanwu still prints unrecognised custom fields instead of dropping them", async () => {
		const text = await renderText("xuanwu", [...domesticFields, "GitHub：https://github.com/example"]);

		expect(text).toContain("GitHub");
		expect(text).toContain("https://github.com/example");
	}, 120_000);

	it("xuanwu degrades to the plain contact row when nothing is recognised", async () => {
		const text = await renderText("xuanwu", ["LinkedIn：https://www.linkedin.com/in/example"]);

		expect(text).toContain("张伟");
		expect(text).toContain("LinkedIn");
	}, 120_000);
});
