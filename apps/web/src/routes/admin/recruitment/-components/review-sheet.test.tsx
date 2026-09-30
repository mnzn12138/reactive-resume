// @vitest-environment happy-dom

import type { ReactNode } from "react";
import type { RecruitmentPostAdmin } from "@/features/recruitment/types";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";

vi.mock("@tanstack/react-router", () => ({
	Link: ({ to, params, children }: { to: string; params?: Record<string, string>; children?: ReactNode }) => (
		<a href={to.replace("$postId", params?.postId ?? "")}>{children}</a>
	),
}));

const { ReviewSheet } = await import("./review-sheet");
const { mockPostAdmin } = await import("@/features/recruitment/__fixtures__/post");

beforeAll(() => i18n.loadAndActivate({ locale: "en", messages: {} }));

const duplicate: RecruitmentPostAdmin = {
	...mockPostAdmin,
	dedupeKey: "example corp|frontend engineer|beijing",
	duplicateOf: { id: "post-8", company: "Example Corp", role: "Frontend Engineer", status: "published" },
};

const actions = () => ({
	onApprove: vi.fn(),
	onReject: vi.fn(),
	onClose: vi.fn(),
	onDelete: vi.fn(),
});

const renderSheet = (post: RecruitmentPostAdmin | null = duplicate) => {
	const handlers = actions();

	render(
		<I18nProvider i18n={i18n}>
			<ReviewSheet post={post} open onOpenChange={() => {}} {...handlers} />
		</I18nProvider>,
	);

	return handlers;
};

describe("ReviewSheet", () => {
	it("shows who submitted the post, so a verdict can be explained", () => {
		renderSheet();

		expect(screen.getByText("Zhang San")).toBeInTheDocument();
		expect(screen.getByText("zhang@example.com")).toBeInTheDocument();
	});

	it("shows the dedupe key and the other post holding it", () => {
		renderSheet();

		expect(screen.getByText("example corp|frontend engineer|beijing")).toBeInTheDocument();
		expect(screen.getByText(/Example Corp · Frontend Engineer/)).toBeInTheDocument();
	});

	it("says when a post has no duplicate rather than leaving the row blank", () => {
		renderSheet(mockPostAdmin);

		expect(screen.getAllByText("—").length).toBeGreaterThan(0);
	});

	it("shows the rejection reason when the post was already refused", () => {
		renderSheet({ ...mockPostAdmin, status: "rejected", rejectionReason: "The announcement link does not open." });

		expect(screen.getByText("The announcement link does not open.")).toBeInTheDocument();
	});

	it("offers all four verdicts", async () => {
		const handlers = renderSheet();

		await userEvent.click(screen.getByRole("button", { name: "Approve" }));
		await userEvent.click(screen.getByRole("button", { name: "Reject" }));
		await userEvent.click(screen.getByRole("button", { name: "Take down" }));
		await userEvent.click(screen.getByRole("button", { name: "Delete" }));

		expect(handlers.onApprove).toHaveBeenCalledWith(duplicate);
		expect(handlers.onReject).toHaveBeenCalledWith(duplicate);
		expect(handlers.onClose).toHaveBeenCalledWith(duplicate);
		expect(handlers.onDelete).toHaveBeenCalledWith(duplicate);
	});

	it("shows the report count here and nowhere public", () => {
		renderSheet({ ...mockPostAdmin, reportCount: 3 });

		expect(screen.getByText("3")).toBeInTheDocument();
	});
});
