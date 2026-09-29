// @vitest-environment happy-dom

import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { legalDocumentVersion } from "@reactive-resume/schema/legal";

const mocks = vi.hoisted(() => ({ signUpEmail: vi.fn() }));

vi.mock("@/libs/auth/client", () => ({ authClient: { signUp: { email: mocks.signUpEmail } } }));
vi.mock("../components/social-auth", () => ({ SocialAuth: () => null }));
vi.mock("@tanstack/react-router", () => ({
	useSearch: () => ({ callbackURL: undefined, reauthenticate: undefined }),
	Link: ({ children, to }: { children?: ReactNode; to: string; search?: unknown }) => <a href={to}>{children}</a>,
}));

const { RegisterPage } = await import("./register");

beforeAll(() => i18n.loadAndActivate({ locale: "en", messages: {} }));

beforeEach(() => {
	vi.clearAllMocks();
	mocks.signUpEmail.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
});

function renderPage() {
	return render(
		<I18nProvider i18n={i18n}>
			<RegisterPage disableEmailAuth={false} />
		</I18nProvider>,
	);
}

async function fillValidCredentials() {
	await userEvent.type(screen.getByLabelText("Name"), "Jane Doe");
	await userEvent.type(screen.getByLabelText("Username"), "jane.doe");
	await userEvent.type(screen.getByLabelText("Email Address"), "jane.doe@example.com");
	await userEvent.type(screen.getByLabelText("Password"), "supersecret");
}

// `FormControl` names the checkbox with the consent sentence beside it, so that is its accessible name.
const checkbox = () => screen.getByRole("checkbox", { name: /I have read and agree to the/ });

it("links to both legal documents from the consent row", () => {
	renderPage();

	expect(screen.getByRole("link", { name: "Terms of Service" })).toHaveAttribute("href", "/terms");
	expect(screen.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");
	expect(checkbox()).not.toBeChecked();
});

it("refuses to submit until the legal documents are accepted", async () => {
	renderPage();
	await fillValidCredentials();

	await userEvent.click(screen.getByRole("button", { name: "Sign up" }));

	expect(
		await screen.findByText("Accept the Terms of Service and the Privacy Policy to create your account."),
	).toBeVisible();
	expect(mocks.signUpEmail).not.toHaveBeenCalled();
});

it("sends consent for the published document version once accepted", async () => {
	renderPage();
	await fillValidCredentials();

	await userEvent.click(checkbox());
	await userEvent.click(screen.getByRole("button", { name: "Sign up" }));

	await waitFor(() => expect(mocks.signUpEmail).toHaveBeenCalledTimes(1));
	expect(mocks.signUpEmail).toHaveBeenCalledWith(
		expect.objectContaining({ legalConsent: { accepted: true, version: legalDocumentVersion } }),
	);
});

it("keeps consent out of the payload when the box is unchecked again", async () => {
	renderPage();
	await fillValidCredentials();

	await userEvent.click(checkbox());
	await userEvent.click(checkbox());
	await userEvent.click(screen.getByRole("button", { name: "Sign up" }));

	expect(
		await screen.findByText("Accept the Terms of Service and the Privacy Policy to create your account."),
	).toBeVisible();
	expect(mocks.signUpEmail).not.toHaveBeenCalled();
});
