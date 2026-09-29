// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";

/**
 * The guard lives in `useRemainingLoginMethods` and is enforced by the disabled
 * button, so the only thing worth asserting here is the button itself: a guard
 * that runs after the click has already lost the account.
 */

type MockAccount = { providerId: string; accountId: string };

const accounts = vi.hoisted(() => ({ data: [] as MockAccount[] }));

/** `user.phoneNumber`, not an account row — the source that is easy to forget. */
const session = vi.hoisted(() => ({ phoneNumber: null as string | null }));

const unlink = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-query", () => ({
	useQuery: () => ({ data: accounts.data, isLoading: false, error: null }),
	useQueryClient: () => ({ invalidateQueries: vi.fn() }),
	useMutation: () => ({ isPending: false, mutate: vi.fn(), mutateAsync: vi.fn() }),
	useMutationState: () => [],
}));

vi.mock("@/libs/auth/client", () => ({
	authClient: {
		useSession: () => ({ data: { user: { id: "user-1", phoneNumber: session.phoneNumber } } }),
		listAccounts: vi.fn(async () => ({ data: accounts.data })),
		linkSocial: vi.fn(),
		unlinkAccount: unlink,
	},
}));

vi.mock("@/libs/orpc/client", () => ({
	orpc: {
		auth: { providers: { list: { queryOptions: () => ({ queryKey: ["auth", "providers"] }) } } },
	},
}));

vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: vi.fn(), close: vi.fn() } }));

i18n.loadAndActivate({ locale: "en", messages: {} });

const { SocialProviderSection } = await import("./social-provider");

const renderSection = () =>
	render(
		<I18nProvider i18n={i18n}>
			<SocialProviderSection provider="google" />
		</I18nProvider>,
	);

const disconnectButton = () => screen.getByRole("button", { name: /disconnect/i });

beforeEach(() => {
	accounts.data = [];
	session.phoneNumber = null;
	unlink.mockReset();
});

describe("SocialProviderSection", () => {
	it("disables Disconnect when the linked account is the only way to sign in", () => {
		accounts.data = [{ providerId: "google", accountId: "account-1" }];

		renderSection();

		expect(disconnectButton()).toBeDisabled();
	});

	it("keeps Disconnect available when a password is set as well", () => {
		accounts.data = [
			{ providerId: "google", accountId: "account-1" },
			{ providerId: "credential", accountId: "account-2" },
		];

		renderSection();

		expect(disconnectButton()).toBeEnabled();
	});

	// The phone number is a column on `user`, so a user whose only other method is
	// their phone has no account row for it. Counting account rows alone would
	// disable Disconnect here and strand them.
	it("counts a bound phone number even though it is not an account row", () => {
		accounts.data = [{ providerId: "google", accountId: "account-1" }];
		session.phoneNumber = "+8613800138000";

		renderSection();

		expect(disconnectButton()).toBeEnabled();
	});

	it("does not call unlink while the button is disabled", () => {
		accounts.data = [{ providerId: "google", accountId: "account-1" }];

		renderSection();
		disconnectButton().click();

		expect(unlink).not.toHaveBeenCalled();
	});
});
