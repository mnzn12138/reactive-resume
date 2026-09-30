// @vitest-environment happy-dom

import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({ update: vi.fn(), toast: vi.fn() }));

vi.mock("@/libs/orpc/client", () => ({
	orpc: {
		admin: {
			recruitment: {
				posts: {
					list: { queryKey: () => ["admin", "recruitment", "posts"] },
					update: { mutationOptions: (options: object) => ({ ...options, mutationFn: mocks.update }) },
				},
			},
		},
	},
}));

vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: mocks.toast } }));

const { RejectDialog } = await import("./reject-dialog");
const { mockPostAdmin } = await import("@/features/recruitment/__fixtures__/post");

beforeAll(() => i18n.loadAndActivate({ locale: "en", messages: {} }));

beforeEach(() => {
	mocks.update.mockReset();
	mocks.toast.mockReset();
	mocks.update.mockResolvedValue({ id: "post-1", status: "rejected" });
});

const renderDialog = (onOpenChange = vi.fn()) => {
	const tree: ReactNode = (
		<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
			<I18nProvider i18n={i18n}>
				<RejectDialog post={mockPostAdmin} open onOpenChange={onOpenChange} />
			</I18nProvider>
		</QueryClientProvider>
	);

	return { ...render(tree), onOpenChange };
};

describe("RejectDialog", () => {
	it("refuses to reject without a reason, because the submitter has to be told why", () => {
		renderDialog();

		expect(screen.getByRole("button", { name: "Reject" })).toBeDisabled();
		expect(mocks.update).not.toHaveBeenCalled();
	});

	it("stays disabled for a reason made only of whitespace", async () => {
		renderDialog();

		await userEvent.type(screen.getByLabelText("Reason"), "   ");

		expect(screen.getByRole("button", { name: "Reject" })).toBeDisabled();
	});

	it("sends the trimmed reason with the action", async () => {
		renderDialog();

		await userEvent.type(screen.getByLabelText("Reason"), "  The announcement link does not open.  ");
		await userEvent.click(screen.getByRole("button", { name: "Reject" }));

		// react-query hands `mutationFn` a second argument of its own bookkeeping.
		await waitFor(() =>
			expect(mocks.update).toHaveBeenCalledWith(
				{
					action: "reject",
					id: "post-1",
					rejectionReason: "The announcement link does not open.",
				},
				expect.anything(),
			),
		);
	});

	it("closes once the verdict is recorded", async () => {
		const { onOpenChange } = renderDialog();

		await userEvent.type(screen.getByLabelText("Reason"), "Not a campus role.");
		await userEvent.click(screen.getByRole("button", { name: "Reject" }));

		await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
	});

	it("says the reason is shown to whoever submitted the post", () => {
		renderDialog();

		expect(
			screen.getByText("The reason is shown to whoever submitted it, so it has to say what to fix."),
		).toBeInTheDocument();
	});
});
