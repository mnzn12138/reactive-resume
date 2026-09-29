// @vitest-environment happy-dom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";

const mocks = vi.hoisted(() => ({
	sendOtp: vi.fn(),
	verify: vi.fn(),
	invalidate: vi.fn(),
	navigate: vi.fn(),
	toastAdd: vi.fn(),
	toastClose: vi.fn(),
}));

vi.mock("@/libs/auth/client", () => ({
	authClient: {
		phoneNumber: { sendOtp: mocks.sendOtp, verify: mocks.verify },
	},
}));

// Toasts are rendered by a viewport that only the app shell mounts, so the calls are asserted
// instead of the on-screen copy — the same approach `donation-toast.test.tsx` takes.
vi.mock("@reactive-resume/ui/components/toast", () => ({
	toast: { add: mocks.toastAdd, close: mocks.toastClose },
}));

vi.mock("@tanstack/react-router", () => ({
	useSearch: () => ({ callbackURL: undefined, reauthenticate: undefined }),
	useRouter: () => ({ invalidate: mocks.invalidate }),
	useNavigate: () => mocks.navigate,
}));

const { PhoneAuth } = await import("./phone-auth");

beforeAll(() => i18n.loadAndActivate({ locale: "en", messages: {} }));

beforeEach(() => {
	vi.clearAllMocks();
	mocks.sendOtp.mockResolvedValue({ data: { success: true }, error: null });
	mocks.verify.mockResolvedValue({ data: { status: true, user: { id: "user-1" } }, error: null });
});

function renderForm() {
	return render(
		<I18nProvider i18n={i18n}>
			<PhoneAuth />
		</I18nProvider>,
	);
}

// The consent sentence is the checkbox's label, which makes it its accessible name.
const consentCheckbox = () => screen.getByRole("checkbox", { name: /I have read and agree to the/ });
const sendCodeButton = () => screen.getByRole("button", { name: "Send Code" });

it("refuses to request a code until the legal documents are accepted", async () => {
	renderForm();
	await userEvent.type(screen.getByLabelText("Phone Number"), "13800138000");

	expect(sendCodeButton()).toBeDisabled();
	expect(mocks.sendOtp).not.toHaveBeenCalled();

	await userEvent.click(consentCheckbox());
	expect(sendCodeButton()).toBeEnabled();
});

it("asks the server for a code once consent is given, then moves to the code step", async () => {
	renderForm();
	await userEvent.click(consentCheckbox());
	await userEvent.type(screen.getByLabelText("Phone Number"), "13800138000");

	await userEvent.click(sendCodeButton());

	await waitFor(() => expect(mocks.sendOtp).toHaveBeenCalledTimes(1));
	expect(mocks.sendOtp).toHaveBeenCalledWith({ phoneNumber: "13800138000" });

	// One box per digit, every one of them labelled by the field's label (which the field group
	// picks up too, hence querying the inputs by role).
	expect(screen.getAllByRole("textbox", { name: "Verification Code" })).toHaveLength(6);
	expect(screen.getByText("We sent a 6-digit code to 13800138000.")).toBeVisible();
});

it("disables resending while the cooldown runs", async () => {
	renderForm();
	await userEvent.click(consentCheckbox());
	await userEvent.type(screen.getByLabelText("Phone Number"), "13800138000");
	await userEvent.click(sendCodeButton());

	const resendButton = await screen.findByRole("button", { name: /Resend in/ });
	expect(resendButton).toBeDisabled();

	await userEvent.click(resendButton);
	expect(mocks.sendOtp).toHaveBeenCalledTimes(1);
});

it("shows the server's rate-limit message verbatim and stays on the phone step", async () => {
	// Throttled requests come back in Chinese, seconds included, and nothing here should reword that.
	mocks.sendOtp.mockResolvedValue({ data: null, error: { code: "TOO_MANY_REQUESTS", message: "请 42 秒后再试" } });

	renderForm();
	await userEvent.click(consentCheckbox());
	await userEvent.type(screen.getByLabelText("Phone Number"), "13800138000");
	await userEvent.click(sendCodeButton());

	await waitFor(() =>
		expect(mocks.toastAdd).toHaveBeenCalledWith(
			expect.objectContaining({ type: "error", description: "请 42 秒后再试" }),
		),
	);

	// Stayed on step one, so the number can be corrected before the next try.
	expect(screen.getByLabelText("Phone Number")).toBeVisible();
	expect(mocks.sendOtp).toHaveBeenCalledTimes(1);
});
