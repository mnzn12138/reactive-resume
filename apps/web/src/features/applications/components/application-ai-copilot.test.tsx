// @vitest-environment happy-dom

import type { Application } from "../types";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({ draft: vi.fn(), other: vi.fn() }));
vi.mock("@/libs/orpc/client", () => ({
	orpc: {
		applications: {
			ai: {
				matchScore: { mutationOptions: (options: object) => ({ ...options, mutationFn: mocks.other }) },
				tailorResume: { mutationOptions: (options: object) => ({ ...options, mutationFn: mocks.other }) },
				draftMessage: { mutationOptions: (options: object) => ({ ...options, mutationFn: mocks.draft }) },
			},
		},
	},
}));

const { ApplicationAiCopilot } = await import("./application-ai-copilot");
const application: Application = {
	id: "application",
	company: "Example",
	role: "Engineer",
	location: null,
	salary: null,
	status: "saved",
	archived: false,
	resumeId: null,
	source: null,
	sourceUrl: null,
	jobDescription: null,
	matchScore: null,
	aiMetadata: null,
	notes: null,
	resumeFileUrl: null,
	resumeFileName: null,
	followUpAt: null,
	followUpNote: null,
	tags: [],
	contacts: [],
	activity: [],
	appliedAt: new Date(),
	createdAt: new Date(),
	updatedAt: new Date(),
};

beforeAll(() => i18n.loadAndActivate({ locale: "en", messages: {} }));
beforeEach(() => vi.resetAllMocks());

function draftRequest() {
	let resolve!: (result: { text: string }) => void;
	const promise = new Promise<{ text: string }>((accept) => {
		resolve = accept;
	});
	return { promise, resolve };
}

function renderCopilot() {
	return render(
		<QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
			<I18nProvider i18n={i18n}>
				<ApplicationAiCopilot application={application} />
			</I18nProvider>
		</QueryClientProvider>,
	);
}

it("blocks the follow-up action while a draft is pending", async () => {
	const request = draftRequest();
	mocks.draft.mockReturnValue(request.promise);
	renderCopilot();
	const followUp = screen.getByRole("button", { name: /Draft a follow-up/ });

	await userEvent.click(followUp);
	await waitFor(() => expect(mocks.draft).toHaveBeenCalledTimes(1));
	// TanStack Query additionally passes an internal context object to the mutation function.
	expect(mocks.draft.mock.calls[0]?.[0]).toEqual({ id: application.id });
	expect(followUp).toBeDisabled();

	// Clicking again must not fire a second request while the first is in flight.
	await userEvent.click(followUp);
	expect(mocks.draft).toHaveBeenCalledTimes(1);

	await act(async () => request.resolve({ text: "Follow-up" }));
	expect(await screen.findByText("Follow-up")).toBeVisible();
	expect(followUp).toBeEnabled();
});

it("replaces an earlier draft once a newer follow-up completes", async () => {
	mocks.draft.mockResolvedValueOnce({ text: "Earlier follow-up" });
	mocks.draft.mockResolvedValueOnce({ text: "Latest follow-up" });
	renderCopilot();
	const followUp = screen.getByRole("button", { name: /Draft a follow-up/ });

	await userEvent.click(followUp);
	await screen.findByText("Earlier follow-up");

	await userEvent.click(followUp);
	expect(await screen.findByText("Latest follow-up")).toBeVisible();
	expect(screen.queryByText("Earlier follow-up")).not.toBeInTheDocument();
});
