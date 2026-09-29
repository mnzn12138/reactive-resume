// @vitest-environment happy-dom

import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { buildApplicationDraft } from "@reactive-resume/api/features/recruitment/convert";
import { mockPost } from "../__fixtures__/post";
import { defaultRecruitmentSearch } from "../hooks/use-recruitment-filters";
import { JobsListPage } from "./jobs-list";

const createSpy = vi.hoisted(() => vi.fn());

// The route these pages sit under is not mounted here; only its Link is needed to assert that a
// row points at its own detail page.
vi.mock("@tanstack/react-router", () => ({
	Link: ({
		to,
		params,
		children,
		...rest
	}: {
		to: string;
		params?: { postId?: string };
		children?: ReactNode;
		className?: string;
	}) => (
		<a href={params ? to.replace("$postId", String(params.postId)) : to} {...rest}>
			{children}
		</a>
	),
}));

// Nothing may reach create() without the visitor asking for it, so the mutation is a spy and the
// sheet is a stub whose props are inspectable.
vi.mock("@/libs/orpc/client", () => ({
	orpc: {
		applications: {
			create: { mutationOptions: (options: object) => ({ ...options, mutationFn: createSpy }) },
		},
	},
}));

vi.mock("@/features/applications/components/application-form-sheet", () => ({
	ApplicationFormSheet: ({ open, draft }: { open: boolean; draft: unknown }) =>
		open && draft ? <pre data-testid="application-sheet">{JSON.stringify(draft)}</pre> : null,
}));

beforeAll(() => i18n.loadAndActivate({ locale: "en", messages: {} }));

beforeEach(() => createSpy.mockClear());

const pageProps = {
	posts: [mockPost],
	total: 1,
	isLoading: false,
	search: defaultRecruitmentSearch,
	onNavigate: () => {},
	isAuthenticated: true,
	loginHref: "/auth/login?callbackURL=%2Fjobs",
	pageSize: 20,
};

const renderPage = (props: Partial<typeof pageProps> = {}) =>
	render(
		<I18nProvider i18n={i18n}>
			<JobsListPage {...pageProps} {...props} />
		</I18nProvider>,
	);

const readDraft = () => JSON.parse(screen.getByTestId("application-sheet").textContent ?? "{}");

describe("JobsListPage", () => {
	it("renders a post's company, role and batch", () => {
		renderPage();

		expect(screen.getAllByText("Example Corp").length).toBeGreaterThan(0);
		expect(screen.getAllByText("Frontend Engineer").length).toBeGreaterThan(0);
		expect(screen.getAllByText("Regular batch").length).toBeGreaterThan(0);
	});

	it("links the role to the post's own page", () => {
		renderPage();

		const links = screen.getAllByRole("link", { name: "Frontend Engineer" });
		expect(links[0]).toHaveAttribute("href", "/jobs/post-1");
	});

	it("shows the server's freshness rather than recomputing it", () => {
		renderPage();

		const badges = screen.getAllByTestId("availability-badge");
		expect(badges[0]).toHaveTextContent("Open");
		expect(badges[0]).toHaveTextContent("3 days left");
	});

	it("reports the total that matched, not the size of the page", () => {
		renderPage({ total: 137 });

		expect(screen.getByTestId("filters-result-count")).toHaveTextContent("137");
	});

	it("pre-fills the application form and creates nothing until asked", async () => {
		renderPage();

		await userEvent.click(screen.getAllByRole("button", { name: "Add to my applications" })[0]);

		expect(screen.getByTestId("application-sheet")).toBeInTheDocument();
		expect(readDraft()).toEqual(buildApplicationDraft(mockPost));
		expect(createSpy).not.toHaveBeenCalled();
	});

	it("offers a sign-in route to anonymous visitors instead of tracking silently", async () => {
		renderPage({ isAuthenticated: false });

		const cta = screen.getAllByRole("button", { name: "Log in to track this role" })[0];
		expect(cta).toHaveAttribute("href", "/auth/login?callbackURL=%2Fjobs");
		expect(screen.queryByRole("button", { name: "Add to my applications" })).not.toBeInTheDocument();

		await userEvent.click(cta);
		expect(screen.queryByTestId("application-sheet")).not.toBeInTheDocument();
		expect(createSpy).not.toHaveBeenCalled();
	});

	it("distinguishes an empty board from an empty result set", () => {
		const { unmount } = renderPage({ posts: [], total: 0 });
		expect(screen.getByText("No roles have been published yet.")).toBeInTheDocument();
		unmount();

		renderPage({ posts: [], total: 0, search: { ...defaultRecruitmentSearch, search: "quantum" } });
		expect(screen.getByText("No roles match these filters.")).toBeInTheDocument();
		// One in the filter bar, one in the empty state.
		expect(screen.getAllByRole("button", { name: "Clear filters" })).toHaveLength(2);
	});

	it("keeps rows readable while the next page is loading", () => {
		renderPage({ isLoading: true });

		expect(screen.getAllByText("Example Corp").length).toBeGreaterThan(0);
	});
});
