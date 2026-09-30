// @vitest-environment happy-dom

import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { ORPCError } from "@orpc/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RECRUITMENT_ERROR_CODES } from "../errors";

const mocks = vi.hoisted(() => ({ report: vi.fn(), toast: vi.fn() }));

vi.mock("@/libs/orpc/client", () => ({
	orpc: {
		admin: { recruitment: { reports: { list: { queryKey: () => ["admin", "recruitment", "reports"] } } } },
		recruitment: {
			report: { mutationOptions: (options: object) => ({ ...options, mutationFn: mocks.report }) },
		},
	},
}));

vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: mocks.toast } }));

const { ReportDialog } = await import("./report-dialog");

const POST_ID = "post-1";

beforeAll(() => i18n.loadAndActivate({ locale: "en", messages: {} }));

beforeEach(() => {
	mocks.report.mockReset();
	mocks.toast.mockReset();
	mocks.report.mockResolvedValue({ id: "report-1", reportCount: 1 });
});

const renderDialog = (onReported?: () => void) => {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

	const tree: ReactNode = (
		<QueryClientProvider client={queryClient}>
			<I18nProvider i18n={i18n}>
				<ReportDialog postId={POST_ID} open onOpenChange={() => {}} onReported={onReported} />
			</I18nProvider>
		</QueryClientProvider>
	);

	render(tree);
};

const pickReason = async (label: string) => {
	await userEvent.click(screen.getByRole("combobox"));
	await userEvent.click(screen.getByText(label));
};

describe("ReportDialog", () => {
	it("cannot be sent before a reason is chosen", () => {
		renderDialog();

		expect(screen.getByRole("button", { name: "Send report" })).toBeDisabled();
	});

	it("sends the reason once one is chosen", async () => {
		renderDialog();

		await pickReason("The details are wrong or invented");
		await userEvent.click(screen.getByRole("button", { name: "Send report" }));

		// react-query hands `mutationFn` a second argument of its own bookkeeping.
		await waitFor(() =>
			expect(mocks.report).toHaveBeenCalledWith({ id: POST_ID, reason: "fakeInfo" }, expect.anything()),
		);
	});

	it("insists on details when the reason is 「something else」", async () => {
		renderDialog();

		await pickReason("Something else");

		expect(screen.getByRole("button", { name: "Send report" })).toBeDisabled();
		expect(screen.getByText('Say what is wrong — "something else" on its own cannot be acted on.')).toBeInTheDocument();

		await userEvent.type(screen.getByLabelText(/What is wrong with it/), "The link 404s");

		expect(screen.getByRole("button", { name: "Send report" })).toBeEnabled();
	});

	it("reads a 409 as 「already reported」 rather than as an unknown failure", async () => {
		const onReported = vi.fn();
		mocks.report.mockRejectedValue(
			new ORPCError("CONFLICT", {
				message: "You have already reported this post.",
				data: { code: RECRUITMENT_ERROR_CODES.alreadyReported },
			}),
		);

		renderDialog(onReported);

		await pickReason("They are not actually hiring");
		await userEvent.click(screen.getByRole("button", { name: "Send report" }));

		// The report is on record either way, so the caller flips its button rather than
		// leaving the reader to wonder whether the second report vanished.
		await waitFor(() => expect(onReported).toHaveBeenCalled());
		expect(screen.queryByText("Something went wrong. Please try again.")).not.toBeInTheDocument();
	});

	it("translates any other failure into copy, never into a raw error", async () => {
		mocks.report.mockRejectedValue(
			new ORPCError("BAD_REQUEST", { message: "nope", data: { code: RECRUITMENT_ERROR_CODES.selfReport } }),
		);

		renderDialog();

		await pickReason("They are not actually hiring");
		await userEvent.click(screen.getByRole("button", { name: "Send report" }));

		await waitFor(() =>
			expect(screen.getByText("You cannot report a post you submitted yourself.")).toBeInTheDocument(),
		);
	});
});
