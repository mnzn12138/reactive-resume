import type { PlatformId } from "@reactive-resume/resume/platform-profiles";
import type { PlatformBlock } from "@reactive-resume/resume/platform-text";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { PublicResumePdfOptions } from "@/features/resume/public/public-pdf";
import { t } from "@lingui/core/macro";
import { useCallback, useState } from "react";
import { useCopyToClipboard } from "usehooks-ts";
import { buildDocx } from "@reactive-resume/docx";
import { getResumeSectionTitle } from "@reactive-resume/pdf/section-title";
import { getResumeExportData } from "@reactive-resume/resume/export-sections";
import { buildMarkdown } from "@reactive-resume/resume/markdown";
import { buildPlatformBlocks, buildPlatformText } from "@reactive-resume/resume/platform-text";
import { buildStructuredText } from "@reactive-resume/resume/structured-text";
import { toast } from "@reactive-resume/ui/components/toast";
import { downloadWithAnchor, generateFilename, generateLocalizedFilename } from "@reactive-resume/utils/file";
import { resolvePublicResumePdfBlob } from "@/features/resume/public/public-pdf";
import { client } from "@/libs/orpc/client";
import { createSectionTitleResolverForLocale } from "@/libs/resume/section-title-locale";
import { createResumePdfBlob } from "./pdf-document";

/**
 * Section titles are stored empty by default and resolved (locale-aware) at render time. PDF does
 * this via an injected resolver; DOCX, Markdown, and the structured-text export reuse the same
 * resolution here so their section headings aren't blank. Returns a `(sectionId) => title` function.
 */
const createSectionTitleResolver = async (data: ResumeData) => {
	const resolveSectionTitle = await createSectionTitleResolverForLocale(data.metadata.page.locale);
	const dataWithResolver = { ...data, resolveSectionTitle };
	return (sectionId: string) => getResumeSectionTitle(dataWithResolver, sectionId);
};

// ponytail: loosened from Resume to Pick so public-resume (where name may be "" for non-owners) can reuse
type ExportableResume = {
	id?: string;
	name: string;
	slug: string;
	data: ResumeData;
};

type UseResumeExportOptions = {
	publicResumePdf?: PublicResumePdfOptions;
};

const getExportName = (resume: ExportableResume) => resume.name || resume.data.basics.name || resume.slug;

/**
 * Single source of truth for resume export (PDF / DOCX / JSON / Markdown / TXT / Print). Previously
 * duplicated verbatim between the builder dock and the right-panel Export section (#17).
 */
export function useResumeExport(resume: ExportableResume | undefined, exportOptions: UseResumeExportOptions = {}) {
	const [isExporting, setIsExporting] = useState(false);
	const [, copyToClipboard] = useCopyToClipboard();

	/**
	 * Renders one recruitment platform's version of the resume: the plain text plus the single blocks
	 * the copy dialog pastes field by field. Shared by the copy and download paths so both stay in sync.
	 */
	const preparePlatformExport = useCallback(
		async (platform: PlatformId): Promise<{ text: string; blocks: PlatformBlock[] } | undefined> => {
			if (!resume) return undefined;
			const data = getResumeExportData(resume.data);
			const resolveTitle = await createSectionTitleResolver(data);
			return {
				text: buildPlatformText(data, { platform, resolveTitle }),
				blocks: buildPlatformBlocks(data, { platform, resolveTitle }),
			};
		},
		[resume],
	);

	const onDownloadJSON = useCallback(() => {
		if (!resume) return;
		const blob = new Blob([JSON.stringify(resume.data, null, 2)], { type: "application/json" });
		downloadWithAnchor(blob, generateFilename(getExportName(resume), "json"));
	}, [resume]);

	const onDownloadMarkdown = useCallback(async () => {
		if (!resume) return;
		const data = getResumeExportData(resume.data);
		const resolveTitle = await createSectionTitleResolver(data);
		const blob = new Blob([buildMarkdown(data, resolveTitle)], { type: "text/markdown" });
		downloadWithAnchor(blob, generateFilename(getExportName(resume), "md"));
	}, [resume]);

	const onDownloadText = useCallback(async () => {
		if (!resume) return;
		setIsExporting(true);
		try {
			const data = getResumeExportData(resume.data);
			const resolveTitle = await createSectionTitleResolver(data);
			const text = buildStructuredText(data, resolveTitle);

			// An empty resume would otherwise download a 0-byte file with no feedback.
			if (!text.trim()) {
				toast.add({ type: "error", description: t`This resume has no content to export yet.` });
				return;
			}

			const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
			// Localized: a Chinese resume name would otherwise slugify away to a random word.
			downloadWithAnchor(blob, generateLocalizedFilename(getExportName(resume), "txt"));
		} catch {
			toast.add({ type: "error", description: t`Could not generate the text file. Please try again.` });
		} finally {
			setIsExporting(false);
		}
	}, [resume]);

	/** The blocks the copy dialog previews and pastes one at a time, for one platform. */
	const getPlatformBlocks = useCallback(
		async (platform: PlatformId): Promise<PlatformBlock[]> => {
			return (await preparePlatformExport(platform))?.blocks ?? [];
		},
		[preparePlatformExport],
	);

	const onCopyPlatformText = useCallback(
		async (platform: PlatformId) => {
			if (!resume) return;
			setIsExporting(true);
			try {
				const prepared = await preparePlatformExport(platform);
				if (!prepared?.text.trim()) {
					toast.add({ type: "error", description: t`This resume has no content to export yet.` });
					return;
				}

				await copyToClipboard(prepared.text);
				toast.add({ type: "success", description: t`Copied. Paste it into the job-site form field by field.` });
			} catch {
				toast.add({ type: "error", description: t`Could not copy the text. Please try again.` });
			} finally {
				setIsExporting(false);
			}
		},
		[copyToClipboard, preparePlatformExport, resume],
	);

	const onDownloadPlatformText = useCallback(
		async (platform: PlatformId) => {
			if (!resume) return;
			setIsExporting(true);
			try {
				const prepared = await preparePlatformExport(platform);
				if (!prepared?.text.trim()) {
					toast.add({ type: "error", description: t`This resume has no content to export yet.` });
					return;
				}

				const blob = new Blob([prepared.text], { type: "text/plain;charset=utf-8" });
				downloadWithAnchor(blob, generateLocalizedFilename(`${getExportName(resume)}-${platform}`, "txt"));
			} catch {
				toast.add({ type: "error", description: t`Could not generate the text file. Please try again.` });
			} finally {
				setIsExporting(false);
			}
		},
		[preparePlatformExport, resume],
	);

	const onDownloadDOCX = useCallback(async () => {
		if (!resume) return;
		try {
			const data = getResumeExportData(resume.data);
			const resolveTitle = await createSectionTitleResolver(data);
			const blob = await buildDocx(data, resolveTitle);
			downloadWithAnchor(blob, generateFilename(getExportName(resume), "docx"));
		} catch {
			toast.add({ type: "error", description: t`Could not generate the DOCX. Please try again.` });
		}
	}, [resume]);

	const onDownloadPDF = useCallback(async () => {
		if (!resume) return;
		const toastId = toast.add({
			type: "loading",
			description: t`Generating your PDF...`,
		});
		setIsExporting(true);
		try {
			const data = exportOptions.publicResumePdf ? resume.data : getResumeExportData(resume.data);
			const blob = exportOptions.publicResumePdf
				? await resolvePublicResumePdfBlob({ data, ...exportOptions.publicResumePdf })
				: await createResumePdfBlob(data);
			downloadWithAnchor(blob, generateFilename(getExportName(resume), "pdf"));
			if (exportOptions.publicResumePdf) {
				// Statistics are best effort and must not delay or fail a completed browser download.
				void client.resume.statistics.recordDownload(exportOptions.publicResumePdf.publicResume).catch(() => undefined);
			}
		} catch {
			toast.add({ type: "error", description: t`Could not generate the PDF. Please try again.` });
		} finally {
			setIsExporting(false);
			toast.close(toastId);
		}
	}, [exportOptions.publicResumePdf, resume]);

	const onPrint = useCallback(async () => {
		if (!resume) return;
		const toastId = toast.add({ type: "loading", description: t`Preparing your resume for printing...` });
		setIsExporting(true);
		try {
			const blob = exportOptions.publicResumePdf
				? await resolvePublicResumePdfBlob({ data: resume.data, ...exportOptions.publicResumePdf })
				: await createResumePdfBlob(resume.data);
			const url = URL.createObjectURL(blob);
			// ponytail: print the generated PDF via a hidden iframe (reliable in Chromium). If the browser
			// blocks iframe printing, fall back to opening the PDF in a new tab so the user can print manually.
			const iframe = document.createElement("iframe");
			iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
			iframe.src = url;
			iframe.onload = () => {
				try {
					iframe.contentWindow?.focus();
					iframe.contentWindow?.print();
				} catch {
					window.open(url, "_blank", "noopener");
				}
				setTimeout(() => {
					iframe.remove();
					URL.revokeObjectURL(url);
				}, 60_000);
			};
			document.body.appendChild(iframe);
		} catch {
			toast.add({
				type: "error",
				description: t`Could not prepare your resume for printing. Please try again.`,
			});
		} finally {
			setIsExporting(false);
			toast.close(toastId);
		}
	}, [exportOptions.publicResumePdf, resume]);

	return {
		onDownloadJSON,
		onDownloadMarkdown,
		onDownloadText,
		getPlatformBlocks,
		onCopyPlatformText,
		onDownloadPlatformText,
		onDownloadDOCX,
		onDownloadPDF,
		onPrint,
		isExporting,
	};
}
