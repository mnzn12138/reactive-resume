import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { Template } from "@reactive-resume/schema/templates";
import type { SectionTitleResolver } from "./section-title";
import { createElement } from "react";
import { parseResumeData } from "@reactive-resume/schema/resume/data";
import { pdf } from "#react-pdf-renderer";
import { ResumeDocument } from "./document";

export type CreateResumePdfBlobOptions = {
	data: ResumeData;
	template?: Template | undefined;
	resolveSectionTitle?: SectionTitleResolver | undefined;
};

export const createResumePdfBlob = async ({
	data: input,
	template,
	resolveSectionTitle,
}: CreateResumePdfBlobOptions): Promise<Blob> => {
	const data = parseResumeData(input);
	const document = createElement(ResumeDocument, {
		data,
		template: template ?? data.metadata.template,
		resolveSectionTitle,
	}) as Parameters<typeof pdf>[0];

	return await pdf(document).toBlob();
};
