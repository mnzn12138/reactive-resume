// @vitest-environment happy-dom

import type { ReactNode } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { buildApplicationDraft } from "@reactive-resume/api/features/recruitment/convert";
import { mockPostAnonymous, mockPostDetail } from "../__fixtures__/post";
import { JobsDetailPage } from "./jobs-detail";

const createSpy = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
	Link: ({ to, children, ...rest }: { to: string; children?: ReactNode; className?: string }) => (
		<a href={to} {...rest}>
			{children}
		</a>
	),
}));

vi.mock("@/libs/orpc/client", () => ({
	orpc: {
		applications: {
			create: { mutationOptions: (options: object) => ({ ...options, mutationFn: createSpy }) },
		},
		recruitment: {
			getById: { queryKey: (options?: { input?: { id?: string } }) => ["recruitment", "getById", options?.input?.id] },
			bookmarks: { queryKey: () => ["recruitment", "bookmarks"] },
			list: { queryKey: () => ["recruitment", "list"] },
			bookmark: { mutationOptions: (options: object) => ({ ...options, mutationFn: vi.fn() }) },
			unbookmark: { mutationOptions: (options: object) => ({ ...options, mutationFn: vi.fn() }) },
			report: { mutationOptions: (options: object) => ({ ...options, mutationFn: vi.fn() }) },
		},
	},
}));

// The bookmark button toasts on success and on failure; the manager is not mounted here.
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: vi.fn() } }));

vi.mock("@/features/applications/components/application-form-sheet", () => ({
	ApplicationFormSheet: ({ open, draft }: { open: boolean; draft: unknown }) =>
		open && draft ? <pre data-testid="application-sheet">{JSON.stringify(draft)}</pre> : null,
}));

beforeAll(() => i18n.loadAndActivate({ locale: "en", messages: {} }));

beforeEach(() => createSpy.mockClear());

const LOGIN_HREF = "/auth/login?callbackURL=%2Fjobs%2Fpost-1";

const renderPage = (
	props: {
		/**
		 * Absent means "use the default post". `undefined` — which the key makes distinguishable —
		 * means the server had nothing to show, the state the not-found copy exists for.
		 */
		post?: typeof mockPostDetail | typeof mockPostAnonymous | undefined;
		isLoading?: boolean;
		isAuthenticated?: boolean;
	} = {},
) =>
	render(
		<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
			<I18nProvider i18n={i18n}>
				<JobsDetailPage
					post={"post" in props ? props.post : mockPostDetail}
					isLoading={props.isLoading ?? false}
					isAuthenticated={props.isAuthenticated ?? true}
					loginHref={LOGIN_HREF}
				/>
			</I18nProvider>
		</QueryClientProvider>,
	);

const readDraft = () => JSON.parse(screen.getByTestId("application-sheet").textContent ?? "{}");

describe("JobsDetailPage", () => {
	it("lays out the fields the contract exposes", () => {
		renderPage();

		expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Frontend Engineer");
		expect(screen.getAllByText("Example Corp").length).toBeGreaterThan(0);
		expect(screen.getByText("Beijing / Shanghai")).toBeInTheDocument();
		expect(screen.getByText("200-300/day")).toBeInTheDocument();
		expect(screen.getByText("Build the campus hiring product.")).toBeInTheDocument();
	});

	it("renders the batch and freshness the server derived", () => {
		renderPage();

		expect(screen.getAllByText("Regular batch").length).toBeGreaterThan(0);
		expect(screen.getByTestId("availability-badge")).toHaveTextContent("Open");
	});

	it("points at the company's own application page when there is one", () => {
		renderPage();

		expect(screen.getByRole("link", { name: "Apply on the company's site" })).toHaveAttribute(
			"href",
			"https://example.com/apply",
		);
	});

	it("pre-fills the application form and creates nothing until asked", async () => {
		renderPage();

		await userEvent.click(screen.getByRole("button", { name: "Add to my applications" }));

		expect(screen.getByTestId("application-sheet")).toBeInTheDocument();
		expect(readDraft()).toEqual(buildApplicationDraft(mockPostDetail));
		expect(createSpy).not.toHaveBeenCalled();
	});

	it("hides the contact details from anonymous visitors and says why", () => {
		renderPage({ post: mockPostAnonymous, isAuthenticated: false });

		expect(screen.queryByText("example-hr")).not.toBeInTheDocument();
		expect(screen.queryByText("CAMPUS-42")).not.toBeInTheDocument();
		expect(
			screen.getByText("Contact details are only shown to signed-in users. Log in to see how to reach the poster."),
		).toBeInTheDocument();

		// `Button` renders its anchor with role=button; the href is what carries the callback URL.
		// Scoped to the panel, since the masthead has a sign-in button of its own.
		const heading = screen.getByRole("heading", { level: 2, name: "How to apply" });
		const panel = heading.closest("section") as HTMLElement;
		const login = within(panel).getByRole("button", { name: "Log in" });
		expect(login).toHaveAttribute("href", LOGIN_HREF);
	});

	it("shows the contact details once the visitor is signed in", () => {
		renderPage({ post: mockPostDetail, isAuthenticated: true });

		expect(screen.getByText("example-hr")).toBeInTheDocument();
		expect(screen.getByText("CAMPUS-42")).toBeInTheDocument();
		expect(screen.getAllByText("WeChat").length).toBeGreaterThan(0);
	});

	it("does not pretend a signed-in visitor has contact details when the post has none", () => {
		renderPage({ post: mockPostAnonymous, isAuthenticated: true });

		expect(
			screen.getByText("The person who shared this role did not leave a way to be contacted."),
		).toBeInTheDocument();
	});

	it("sends anonymous visitors to sign in instead of offering tracking", async () => {
		renderPage({ post: mockPostAnonymous, isAuthenticated: false });

		const cta = screen.getByRole("button", { name: "Log in to track this role" });
		expect(cta).toHaveAttribute("href", LOGIN_HREF);
		expect(screen.queryByRole("button", { name: "Add to my applications" })).not.toBeInTheDocument();

		await userEvent.click(cta);
		expect(screen.queryByTestId("application-sheet")).not.toBeInTheDocument();
		expect(createSpy).not.toHaveBeenCalled();
	});

	it("reads as gone rather than as broken when the post cannot be shown", () => {
		renderPage({ post: undefined });

		expect(screen.getByText("This role is no longer listed.")).toBeInTheDocument();
	});

	it("keeps the masthead while the post loads", () => {
		renderPage({ post: undefined, isLoading: true });

		expect(screen.getByRole("main")).toBeInTheDocument();
		expect(screen.queryByText("This role is no longer listed.")).not.toBeInTheDocument();
	});
});
