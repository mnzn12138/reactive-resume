// @vitest-environment happy-dom

import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";

const downloadWithAnchor = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => ({ add: vi.fn(), close: vi.fn() }));
const buildDocx = vi.hoisted(() => vi.fn().mockResolvedValue(new Blob(["x"], { type: "application/x-docx" })));
const writeText = vi.hoisted(() => vi.fn(async (_text: string) => undefined));
const createResumePdfBlob = vi.hoisted(() => vi.fn().mockResolvedValue(new Blob(["x"], { type: "application/pdf" })));
const resumeMock = vi.hoisted(() => ({
	resume: undefined as
		| undefined
		| {
				id: string;
				name: string;
				slug: string;
				data: ResumeData;
		  },
}));

type SectionBaseProps = {
	children: React.ReactNode;
};

vi.mock("../shared/section-base", () => ({
	SectionBase: ({ children }: SectionBaseProps) => <div>{children}</div>,
}));
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast }));
vi.mock("@reactive-resume/utils/file", () => ({
	downloadWithAnchor,
	generateFilename: (name: string, ext: string) => `${name}.${ext}`,
	generateLocalizedFilename: (name: string, ext: string) => `${name}.${ext}`,
}));
vi.mock("@reactive-resume/docx", () => ({ buildDocx }));
vi.mock("@/features/resume/export/pdf-document", () => ({ createResumePdfBlob }));
// DOCX/Markdown resolve locale-aware section titles; stub the async locale resolver so exports
// fall back to the built-in English titles without loading real locale catalogs.
vi.mock("@/libs/resume/section-title-locale", () => ({
	createSectionTitleResolverForLocale: vi.fn().mockResolvedValue(() => undefined),
}));
vi.mock("@/features/resume/builder/draft", () => ({
	useResume: () => resumeMock.resume,
}));

const { ExportSectionBuilder } = await import("./export");

beforeAll(() => {
	i18n.loadAndActivate({ locale: "en", messages: {} });
});

beforeEach(() => {
	const data = structuredClone(defaultResumeData);
	data.metadata.stylesheet = {
		mode: "semantic",
		source: { languageVersion: 1, text: "@version 1;\nname {" },
	};
	resumeMock.resume = { id: "r1", name: "My Resume", slug: "my-resume", data };
});

afterEach(() => {
	downloadWithAnchor.mockReset();
	toast.add.mockReset();
	toast.close.mockReset();
	buildDocx.mockClear();
	createResumePdfBlob.mockClear();
});

const renderExport = () =>
	render(
		<I18nProvider i18n={i18n}>
			<ExportSectionBuilder />
		</I18nProvider>,
	);

const openDialog = () => {
	const trigger = screen.getByText("Choose PDF, DOCX, Markdown, TXT, JSON, or a job-site form.");
	fireEvent.click(trigger.closest("button") as HTMLButtonElement);
};

describe("ExportSectionBuilder", () => {
	it("renders the PDF, DOCX, Markdown, TXT, and JSON format rows", () => {
		renderExport();
		openDialog();

		expect(screen.getByRole("button", { name: "Download PDF" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Download DOCX" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Download Markdown" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Download TXT" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Download JSON" })).toBeInTheDocument();
	});

	it("downloads a structured plain-text blob when the TXT button is clicked", async () => {
		// `defaultResumeData` has no filled-in fields, and the export refuses to write an empty
		// file — give the resume a name so there is something to export.
		if (resumeMock.resume) resumeMock.resume.data.basics.name = "My Resume";

		renderExport();
		openDialog();
		fireEvent.click(screen.getByRole("button", { name: "Download TXT" }));

		await waitFor(() => expect(downloadWithAnchor).toHaveBeenCalledTimes(1));
		// biome-ignore lint/style/noNonNullAssertion: The assertion above verifies the download call exists before destructuring it.
		const [blob, filename] = downloadWithAnchor.mock.calls[0]!;
		expect((blob as Blob).type).toBe("text/plain;charset=utf-8");
		expect(filename).toBe("My Resume.txt");
	});

	it("refuses to download an empty text file for a resume with no content", async () => {
		renderExport();
		openDialog();
		fireEvent.click(screen.getByRole("button", { name: "Download TXT" }));

		await waitFor(() => expect(toast.add).toHaveBeenCalledWith(expect.objectContaining({ type: "error" })));
		expect(downloadWithAnchor).not.toHaveBeenCalled();
	});

	it("downloads a Markdown blob when the Markdown button is clicked", async () => {
		renderExport();
		openDialog();
		fireEvent.click(screen.getByRole("button", { name: "Download Markdown" }));

		await waitFor(() => expect(downloadWithAnchor).toHaveBeenCalledTimes(1));
		// biome-ignore lint/style/noNonNullAssertion: The assertion above verifies the download call exists before destructuring it.
		const [blob, filename] = downloadWithAnchor.mock.calls[0]!;
		expect((blob as Blob).type).toBe("text/markdown");
		expect(filename).toBe("My Resume.md");
	});

	it("downloads the current stylesheet source in JSON", async () => {
		renderExport();
		openDialog();
		fireEvent.click(screen.getByRole("button", { name: "Download JSON" }));

		expect(downloadWithAnchor).toHaveBeenCalledTimes(1);
		// biome-ignore lint/style/noNonNullAssertion: The assertion above verifies the download call exists before destructuring it.
		const [blob, filename] = downloadWithAnchor.mock.calls[0]!;
		expect(blob).toBeInstanceOf(Blob);
		expect((blob as Blob).type).toBe("application/json");
		expect(filename).toBe("My Resume.json");
		const exported = JSON.parse(await (blob as Blob).text());
		expect(exported.metadata.stylesheet).toEqual(resumeMock.resume?.data.metadata.stylesheet);
	});

	it("calls buildDocx and downloads the resulting blob when DOCX is clicked", async () => {
		renderExport();
		openDialog();
		fireEvent.click(screen.getByRole("button", { name: "Download DOCX" }));

		await waitFor(() => expect(buildDocx).toHaveBeenCalledTimes(1));
		expect(downloadWithAnchor).toHaveBeenCalledTimes(1);
		expect(downloadWithAnchor.mock.calls[0]?.[1]).toBe("My Resume.docx");
	});

	it("renders the recruitment platform row alongside the downloads", () => {
		renderExport();
		openDialog();

		expect(screen.getByRole("button", { name: "Copy for a recruitment platform" })).toBeInTheDocument();
	});

	it("copies the whole platform export from the copy dialog", async () => {
		// `defaultResumeData` has nothing filled in; give it a name so there is something to copy.
		if (resumeMock.resume) resumeMock.resume.data.basics.name = "My Resume";
		Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
		writeText.mockClear();

		renderExport();
		openDialog();
		fireEvent.click(screen.getByRole("button", { name: "Copy for a recruitment platform" }));

		const dialog = await waitFor(() => {
			const heading = screen.getByText("Platform");
			return (heading.closest('[role="dialog"]') ?? heading) as HTMLElement;
		});

		expect(within(dialog).getByText(/姓名：My Resume/)).toBeInTheDocument();

		fireEvent.click(within(dialog).getByRole("button", { name: "Copy all" }));

		await waitFor(() => expect(writeText).toHaveBeenCalled());
		expect(writeText.mock.calls[0]?.[0]).toContain("姓名：My Resume");
	});

	it("downloads the selected platform's text from the copy dialog", async () => {
		if (resumeMock.resume) resumeMock.resume.data.basics.name = "My Resume";

		renderExport();
		openDialog();
		fireEvent.click(screen.getByRole("button", { name: "Copy for a recruitment platform" }));

		const dialog = await waitFor(() => {
			const heading = screen.getByText("Platform");
			return (heading.closest('[role="dialog"]') ?? heading) as HTMLElement;
		});

		fireEvent.click(within(dialog).getByRole("button", { name: "Download TXT" }));

		await waitFor(() => expect(downloadWithAnchor).toHaveBeenCalledTimes(1));
		// biome-ignore lint/style/noNonNullAssertion: the download call is asserted just above.
		const [blob, filename] = downloadWithAnchor.mock.calls[0]!;
		expect((blob as Blob).type).toBe("text/plain;charset=utf-8");
		// The default profile is the generic one, so the filename carries that choice.
		expect(filename).toBe("My Resume-generic.txt");
	});

	it("calls createResumePdfBlob and downloads when PDF is clicked", async () => {
		renderExport();
		openDialog();
		fireEvent.click(screen.getByRole("button", { name: "Download PDF" }));
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();

		expect(createResumePdfBlob).toHaveBeenCalledTimes(1);
		expect(createResumePdfBlob).toHaveBeenCalledWith(resumeMock.resume?.data);
		expect(downloadWithAnchor).toHaveBeenCalledTimes(1);
		expect(downloadWithAnchor.mock.calls[0]?.[1]).toBe("My Resume.pdf");
	});
});
