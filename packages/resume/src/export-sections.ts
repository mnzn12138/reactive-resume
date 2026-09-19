import type { ResumeData } from "@reactive-resume/schema/resume/data";

/**
 * Normalise a resume for export.
 *
 * A layout page can end up listing no section at all (every section it
 * referenced was deleted, for instance); those are dropped here so the
 * renderer never emits a blank page. When every page is empty a single empty
 * page is kept, which is what the PDF/DOCX templates expect.
 */
export function getResumeExportData(data: ResumeData): ResumeData {
	const pages = data.metadata.layout.pages.filter((page) => page.main.length > 0 || page.sidebar.length > 0);

	return {
		...data,
		metadata: {
			...data.metadata,
			layout: {
				...data.metadata.layout,
				pages: pages.length > 0 ? pages : [{ fullWidth: true, main: [], sidebar: [] }],
			},
		},
	};
}
