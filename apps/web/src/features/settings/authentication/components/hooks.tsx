import type { AuthProvider } from "@reactive-resume/auth/types";
import type { ReactNode } from "react";
import { t } from "@lingui/core/macro";
import {
	DeviceMobileIcon,
	FingerprintIcon,
	GithubLogoIcon,
	GoogleLogoIcon,
	LinkedinLogoIcon,
	PasswordIcon,
	VaultIcon,
	WalletIcon,
	WechatLogoIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { match } from "ts-pattern";
import { toast } from "@reactive-resume/ui/components/toast";
import { authClient } from "@/libs/auth/client";
import { getReadableErrorMessage } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";

/**
 * Get the display name for a social provider
 */
export function getProviderName(providerId: AuthProvider): string {
	return match(providerId)
		.with("credential", () =>
			t({
				comment: "Authentication provider display name in account settings",
				message: "Password",
			}),
		)
		.with("passkey", () =>
			t({
				comment: "Authentication provider display name in account settings",
				message: "Passkey",
			}),
		)
		.with("google", () =>
			t({
				comment: "Authentication provider display name in account settings",
				message: "Google",
			}),
		)
		.with("github", () =>
			t({
				comment: "Authentication provider display name in account settings",
				message: "GitHub",
			}),
		)
		.with("linkedin", () =>
			t({
				comment: "Authentication provider display name in account settings",
				message: "LinkedIn",
			}),
		)
		.with("custom", () =>
			t({
				comment: "Authentication provider display name in account settings",
				message: "Custom OAuth",
			}),
		)
		.with("wechat", () =>
			t({
				comment: "Authentication provider display name in account settings",
				message: "WeChat",
			}),
		)
		.with("alipay", () =>
			t({
				comment: "Authentication provider display name in account settings",
				message: "Alipay",
			}),
		)
		.with("phone", () =>
			t({
				comment: "Authentication provider display name in account settings",
				message: "Phone Number",
			}),
		)
		.exhaustive();
}

/**
 * Get the icon component for a social provider
 */
export function getProviderIcon(providerId: AuthProvider): ReactNode {
	return match(providerId)
		.with("credential", () => <PasswordIcon />)
		.with("passkey", () => <FingerprintIcon />)
		.with("google", () => <GoogleLogoIcon />)
		.with("github", () => <GithubLogoIcon />)
		.with("linkedin", () => <LinkedinLogoIcon />)
		.with("custom", () => <VaultIcon />)
		.with("wechat", () => <WechatLogoIcon />)
		.with("alipay", () => <WalletIcon />)
		.with("phone", () => <DeviceMobileIcon />)
		.exhaustive();
}

/**
 * Hook to fetch and manage authentication accounts
 */
export function useAuthAccounts() {
	const { data: accounts } = useQuery({
		queryKey: ["auth", "accounts"],
		queryFn: () => authClient.listAccounts(),
		select: ({ data }) => data ?? [],
	});

	const getAccountByProviderId = useCallback(
		(providerId: string) => accounts?.find((account) => account.providerId === providerId),
		[accounts],
	);

	const hasAccount = useCallback(
		(providerId: string) => !!getAccountByProviderId(providerId),
		[getAccountByProviderId],
	);

	return {
		accounts,
		hasAccount,
		getAccountByProviderId,
	};
}

/**
 * Hook to manage authentication provider linking/unlinking
 */
export function useAuthProviderActions() {
	const link = useCallback(async (provider: AuthProvider) => {
		const providerName = getProviderName(provider);
		const toastId = toast.add({ type: "loading", description: t`Linking your ${providerName} account...` });

		const { error } = await authClient.linkSocial({ provider, callbackURL: "/dashboard/settings/authentication" });

		if (error) {
			toast.add({
				type: "error",
				description: getReadableErrorMessage(
					error,
					t({
						comment: "Fallback toast when linking a social authentication provider fails",
						message: "Failed to link provider. Please try again.",
					}),
				),
				id: toastId,
			});
			return;
		}

		toast.close(toastId);
	}, []);

	const unlink = useCallback(async (provider: AuthProvider, accountId: string) => {
		const providerName = getProviderName(provider);
		const toastId = toast.add({
			type: "loading",
			description: t`Unlinking your ${providerName} account...`,
		});

		const { error } = await authClient.unlinkAccount({ accountId });

		if (error) {
			toast.add({
				type: "error",
				description: getReadableErrorMessage(
					error,
					t({
						comment: "Fallback toast when unlinking a social authentication provider fails",
						message: "Failed to unlink provider. Please try again.",
					}),
				),
				id: toastId,
			});
			return;
		}

		toast.close(toastId);
	}, []);

	return { link, unlink };
}

/**
 * How many ways the user can still sign in, and whether one of them may be removed.
 *
 * The count has two sources because they live in two tables:
 *
 *  - `account` rows — one per linked provider, with `credential` present exactly
 *    when a password is set;
 *  - `user.phoneNumber` — the phone plug-in stores the number on the **user**
 *    row, so a user whose only way in is their phone has no account row for it.
 *
 * Forgetting the second source is the easy bug here, and it fails in both
 * directions: a phone-only user would look like they have zero methods left, and
 * a user with a phone plus one linked account would be allowed to drop the
 * account and lock themselves out.
 */
export function useRemainingLoginMethods() {
	const { accounts } = useAuthAccounts();
	const { data: session } = authClient.useSession();

	const providerIds = useMemo(() => new Set((accounts ?? []).map((account) => account.providerId)), [accounts]);

	const hasBoundPhone = Boolean(session?.user.phoneNumber) || providerIds.has("phone");

	// Counted once: a deployment that does keep an account row for the phone must
	// not have it counted twice.
	const remainingMethods = useMemo(
		() => providerIds.size + (hasBoundPhone && !providerIds.has("phone") ? 1 : 0),
		[providerIds, hasBoundPhone],
	);

	/**
	 * Whether removing `provider` still leaves a way in.
	 *
	 * Checked before the click rather than after it: a toast saying "you just
	 * locked yourself out" is not a recovery, it is an apology.
	 */
	const canUnlink = useCallback(
		(provider: AuthProvider) => {
			const isBound = provider === "phone" ? hasBoundPhone : providerIds.has(provider);

			// Nothing bound means nothing to remove, so the guard has no say.
			if (!isBound) return true;

			return remainingMethods > 1;
		},
		[providerIds, hasBoundPhone, remainingMethods],
	);

	return { remainingMethods, canUnlink };
}

/**
 * Hook to get enabled social providers for the current user
 * Possible values: "credential", "google", "github", "linkedin", "custom", "wechat", "alipay", "phone"
 */
export function useEnabledProviders() {
	const { data: enabledProviders = [] } = useQuery(orpc.auth.providers.list.queryOptions());

	return { enabledProviders };
}
