// @vitest-environment happy-dom

import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockPostDetail } from "../__fixtures__/post";

const mocks = vi.hoisted(() => ({
	add: vi.fn(),
	remove: vi.fn(),
	toast: vi.fn(),
}));

vi.mock("@/libs/orpc/client", () => ({
	orpc: {
		recruitment: {
			getById: { queryKey: (options?: { input?: { id?: string } }) => ["recruitment", "getById", options?.input?.id] },
			bookmarks: { queryKey: () => ["recruitment", "bookmarks"] },
			list: { queryKey: () => ["recruitment", "list"] },
			bookmark: { mutationOptions: (options: object) => ({ ...options, mutationFn: mocks.add }) },
			unbookmark: { mutationOptions: (options: object) => ({ ...options, mutationFn: mocks.remove }) },
		},
	},
}));

vi.mock("@reactive-resume/ui/components/toast", () => ({
	toast: { add: mocks.toast },
}));

const { BookmarkButton } = await import("./bookmark-button");

const POST_ID = "post-1";

beforeAll(() => i18n.loadAndActivate({ locale: "en", messages: {} }));

beforeEach(() => {
	mocks.add.mockReset();
	mocks.remove.mockReset();
	mocks.toast.mockReset();
	mocks.add.mockResolvedValue({ bookmarked: true });
	mocks.remove.mockResolvedValue({ bookmarked: false });
});

function renderButton(props: { bookmarked?: boolean; isAuthenticated?: boolean; seeded?: boolean } = {}) {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

	if (props.seeded !== false) {
		queryClient.setQueryData(["recruitment", "getById", POST_ID], {
			...mockPostDetail,
			bookmarked: props.bookmarked ?? false,
		});
	}

	const tree: ReactNode = (
		<QueryClientProvider client={queryClient}>
			<I18nProvider i18n={i18n}>
				<BookmarkButton
					postId={POST_ID}
					bookmarked={props.bookmarked ?? false}
					isAuthenticated={props.isAuthenticated ?? true}
					loginHref="/auth/login?callbackURL=%2Fjobs%2Fpost-1"
				/>
			</I18nProvider>
		</QueryClientProvider>
	);

	return { ...render(tree), queryClient };
}

describe("BookmarkButton", () => {
	it("adds a bookmark when the post is not bookmarked yet", async () => {
		renderButton({ bookmarked: false });

		await userEvent.click(screen.getByRole("button", { name: "Bookmark this post" }));

		// react-query hands `mutationFn` a second argument of its own bookkeeping, so the
		// assertion has to allow for it rather than demand an exact arity.
		expect(mocks.add).toHaveBeenCalledWith({ id: POST_ID }, expect.anything());
		expect(mocks.remove).not.toHaveBeenCalled();
	});

	it("removes the bookmark when it is already set", async () => {
		renderButton({ bookmarked: true });

		await userEvent.click(screen.getByRole("button", { name: "Remove bookmark" }));

		expect(mocks.remove).toHaveBeenCalledWith({ id: POST_ID }, expect.anything());
		expect(mocks.add).not.toHaveBeenCalled();
	});

	it("flips the cached row before the server answers", async () => {
		const { queryClient } = renderButton({ bookmarked: false });

		await userEvent.click(screen.getByRole("button", { name: "Bookmark this post" }));

		await waitFor(() =>
			expect(
				(queryClient.getQueryData(["recruitment", "getById", POST_ID]) as { bookmarked: boolean }).bookmarked,
			).toBe(true),
		);
	});

	it("rolls the cached row back when the request fails", async () => {
		mocks.add.mockRejectedValue(new Error("offline"));

		const { queryClient } = renderButton({ bookmarked: false });

		await userEvent.click(screen.getByRole("button", { name: "Bookmark this post" }));

		await waitFor(() =>
			expect(
				(queryClient.getQueryData(["recruitment", "getById", POST_ID]) as { bookmarked: boolean }).bookmarked,
			).toBe(false),
		);
	});

	it("offers a sign-in shortcut to anonymous visitors instead of a dead button", () => {
		renderButton({ isAuthenticated: false });

		expect(screen.queryByRole("button", { name: "Bookmark this post" })).not.toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Log in to bookmark" })).toHaveAttribute(
			"href",
			"/auth/login?callbackURL=%2Fjobs%2Fpost-1",
		);
	});
});
