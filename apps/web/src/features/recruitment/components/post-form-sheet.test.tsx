// @vitest-environment happy-dom

import type { ReactNode } from "react";
import type { RecruitmentPostOwner } from "../types";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { ORPCError } from "@orpc/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RECRUITMENT_ERROR_CODES } from "../errors";

const mocks = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), toast: vi.fn() }));

vi.mock("@tanstack/react-router", () => ({
	Link: ({ to, params, children }: { to: string; params?: Record<string, string>; children?: ReactNode }) => (
		<a href={to.replace("$postId", params?.postId ?? "")}>{children}</a>
	),
}));

vi.mock("@/libs/orpc/client", () => ({
	orpc: {
		recruitment: {
			mine: { queryKey: () => ["recruitment", "mine"] },
			list: { queryKey: () => ["recruitment", "list"] },
			create: { mutationOptions: (options: object) => ({ ...options, mutationFn: mocks.create }) },
			update: { mutationOptions: (options: object) => ({ ...options, mutationFn: mocks.update }) },
		},
	},
}));

vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: mocks.toast } }));

const { PostFormSheet } = await import("./post-form-sheet");
const { mockPostOwner } = await import("../__fixtures__/post");

beforeAll(() => i18n.loadAndActivate({ locale: "en", messages: {} }));

beforeEach(() => {
	mocks.create.mockReset();
	mocks.update.mockReset();
	mocks.toast.mockReset();
	mocks.create.mockResolvedValue({ id: "post-new" });
	mocks.update.mockResolvedValue({ id: "post-1" });
});

const renderSheet = (post: RecruitmentPostOwner | null = null, requireReview = true) =>
	render(
		<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
			<I18nProvider i18n={i18n}>
				<PostFormSheet open onOpenChange={() => {}} post={post} requireReview={requireReview} />
			</I18nProvider>
		</QueryClientProvider>,
	);

const fillRequired = async () => {
	await userEvent.type(screen.getByLabelText("Company"), "Example Corp");
	await userEvent.type(screen.getByLabelText("Role"), "Frontend Engineer");
	await userEvent.type(screen.getByLabelText("Application link"), "https://example.com/apply");
};

describe("PostFormSheet", () => {
	it("asks for company and role before it asks the server anything", async () => {
		renderSheet();

		await userEvent.click(screen.getByRole("button", { name: "Submit" }));

		expect(screen.getByText("Company and role are both required.")).toBeInTheDocument();
		expect(mocks.create).not.toHaveBeenCalled();
	});

	it("insists on a link, the rule the database cannot express", async () => {
		renderSheet();

		await userEvent.type(screen.getByLabelText("Company"), "Example Corp");
		await userEvent.type(screen.getByLabelText("Role"), "Frontend Engineer");
		await userEvent.click(screen.getByRole("button", { name: "Submit" }));

		expect(
			screen.getByText("Add either an application link or a link to the original announcement."),
		).toBeInTheDocument();
		expect(mocks.create).not.toHaveBeenCalled();
	});

	it("submits a complete posting", async () => {
		renderSheet();

		await fillRequired();
		await userEvent.click(screen.getByRole("button", { name: "Submit" }));

		await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
		expect(mocks.create.mock.calls[0]?.[0]).toMatchObject({
			company: "Example Corp",
			role: "Frontend Engineer",
			applyUrl: "https://example.com/apply",
			batch: "regular",
			employmentType: ["campus"],
		});
	});

	it("turns a duplicate into a way to the post that already exists", async () => {
		mocks.create.mockRejectedValue(
			new ORPCError("CONFLICT", {
				message: "A post for this company, role and city already exists.",
				data: { code: RECRUITMENT_ERROR_CODES.duplicate, existingPostId: "post-9" },
			}),
		);

		renderSheet();

		await fillRequired();
		await userEvent.click(screen.getByRole("button", { name: "Submit" }));

		await waitFor(() =>
			expect(screen.getByText("A post for this company, role and city already exists.")).toBeInTheDocument(),
		);
		expect(screen.getByRole("link", { name: /Open the post that already exists/ })).toHaveAttribute(
			"href",
			"/jobs/post-9",
		);
	});

	it("warns that editing a published post sends it back for review", () => {
		renderSheet(mockPostOwner);

		expect(screen.getByText("Editing sends this post back for review")).toBeInTheDocument();
	});

	it("edits through the update endpoint and keeps the id", async () => {
		renderSheet(mockPostOwner);

		await userEvent.clear(screen.getByLabelText("Company"));
		await userEvent.type(screen.getByLabelText("Company"), "New Corp");
		await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

		await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
		expect(mocks.update.mock.calls[0]?.[0]).toMatchObject({ id: "post-1", company: "New Corp" });
	});

	it("says submissions are published straight away when review is off", () => {
		renderSheet(null, false);

		expect(screen.getByText("Submissions appear on the board straight away.")).toBeInTheDocument();
	});
});
