// @vitest-environment happy-dom

import type { ApplicationFormDraft } from "./application-form-sheet";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { buildApplicationDraft } from "@reactive-resume/api/features/recruitment/convert";

const createSpy = vi.hoisted(() => vi.fn());

/**
 * The board's pre-fill path ends inside this sheet, so this fixture exercises it end to end:
 * a draft produced by the shared mapping goes in, and the same values must be sitting in the
 * fields before anything is created.
 */
const noop = () => ({}) as never;
const emptyQuery = () => ({ queryKey: ["applications-sheet-stub"], queryFn: async () => [] as never[] });

vi.mock("@/libs/orpc/client", () => ({
	orpc: {
		resume: { list: { queryOptions: emptyQuery } },
		aiProviders: { list: { queryOptions: emptyQuery } },
		applications: {
			tags: { queryOptions: emptyQuery, queryKey: noop },
			stats: { queryKey: noop },
			getById: { queryKey: noop },
			create: { mutationOptions: (options: object) => ({ ...options, mutationFn: createSpy }) },
			update: { mutationOptions: (options: object) => ({ ...options, mutationFn: noop }) },
			ai: { autofill: { mutationOptions: (options: object) => ({ ...options, mutationFn: noop }) } },
		},
	},
}));

vi.mock("../queries", () => ({ applicationsListQueryKey: () => ["applications"] }));

// Stubbed rather than rendered: it reaches for the upload endpoints, which have nothing to do
// with what this test is checking.
vi.mock("./file-attachment-field", () => ({ FileAttachmentField: () => null }));

const { ApplicationFormSheet } = await import("./application-form-sheet");

beforeAll(() => i18n.loadAndActivate({ locale: "en", messages: {} }));

beforeEach(() => createSpy.mockClear());

const post = {
	company: "Example Corp",
	role: "Frontend Engineer",
	locations: ["Beijing", "Shanghai"],
	salaryText: "200-300/day",
	source: "official" as const,
	applyUrl: "https://example.com/apply",
	sourceUrl: "https://example.com/announcement",
	summary: "Build the campus hiring product.",
};

const renderSheet = (draft: ApplicationFormDraft | null) => {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

	return render(
		<QueryClientProvider client={client}>
			<I18nProvider i18n={i18n}>
				<ApplicationFormSheet open onOpenChange={() => {}} draft={draft} />
			</I18nProvider>
		</QueryClientProvider>,
	);
};

// The sheet renders through a portal, so its fields live on `document.body`, not in the render
// container.
const inputValues = () =>
	Array.from(document.body.querySelectorAll<HTMLInputElement>("input")).map((input) => input.value);

describe("ApplicationFormSheet draft pre-fill", () => {
	it("pours every mapped field into the form", () => {
		renderSheet(buildApplicationDraft(post));

		// `Label` is not wired to its control with htmlFor, so values are read by collecting the
		// inputs rather than by accessible name.
		const values = inputValues();
		expect(values.length).toBeGreaterThan(0);
		expect(values).toContain("Example Corp");
		expect(values).toContain("Frontend Engineer");
		expect(values).toContain("Beijing / Shanghai");
		expect(values).toContain("200-300/day");
		expect(values).toContain("https://example.com/apply");
	});

	it("creates nothing until the visitor saves, and then creates exactly what they saw", async () => {
		renderSheet(buildApplicationDraft(post));

		expect(createSpy).not.toHaveBeenCalled();

		await userEvent.click(screen.getByRole("button", { name: "Add to pipeline" }));

		expect(createSpy).toHaveBeenCalledTimes(1);
		expect(createSpy.mock.calls[0]?.[0]).toMatchObject({
			company: "Example Corp",
			role: "Frontend Engineer",
			location: "Beijing / Shanghai",
			salary: "200-300/day",
			sourceUrl: "https://example.com/apply",
			jobDescription: "Build the campus hiring product.",
			status: "saved",
		});
	});

	it("falls back to an empty form when there is no draft", () => {
		renderSheet(null);

		const values = inputValues();
		// Guard against passing for the wrong reason: an empty list is trivially all-empty.
		expect(values.length).toBeGreaterThan(0);
		expect(values).not.toContain("Example Corp");
		expect(values).not.toContain("Frontend Engineer");
	});
});
