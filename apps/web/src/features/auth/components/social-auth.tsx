import type { LegalConsent } from "@reactive-resume/schema/legal";
import type { RouterOutput } from "@/libs/orpc/client";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import {
	FingerprintIcon,
	GithubLogoIcon,
	GoogleLogoIcon,
	LinkedinLogoIcon,
	VaultIcon,
	WalletIcon,
	WechatLogoIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { legalDocumentVersion } from "@reactive-resume/schema/legal";
import { Button } from "@reactive-resume/ui/components/button";
import { Skeleton } from "@reactive-resume/ui/components/skeleton";
import { toast } from "@reactive-resume/ui/components/toast";
import { cn } from "@reactive-resume/utils/style";
import { authClient } from "@/libs/auth/client";
import { orpc } from "@/libs/orpc/client";
import { getAuthRedirectOptions, getOAuthPasskeyOptions, getOAuthSignInOptions, isOAuthRedirect } from "../redirect";
import { LegalConsentCheckbox } from "./legal-consent-checkbox";

/**
 * Consent is collected **before** the browser leaves for WeChat or Alipay.
 *
 * A `user_consent` row is only legal evidence if the user accepted before the
 * account existed, and Better Auth creates the account inside the OAuth
 * callback — by which point there is no page left to ask on. So the checkbox
 * lives here, and the server refuses to hand out an authorization URL without it.
 */
const consentPayload: LegalConsent = { accepted: true, version: legalDocumentVersion };

/**
 * `legalConsent` is part of the sign-in contract the server enforces on the
 * domestic providers (see `packages/auth/src/config.ts`). The client's inferred
 * body type has no such field, so the payload is typed here — the same idiom the
 * registration form uses for the email path.
 */
type SocialSignInPayload = Parameters<typeof authClient.signIn.social>[0] & { legalConsent: LegalConsent };

export function SocialAuth() {
	const { data: providers = {}, isLoading } = useQuery(orpc.auth.providers.list.queryOptions());
	const [consentGiven, setConsentGiven] = useState(false);

	const hasDomesticProvider = "wechat" in providers || "alipay" in providers;

	return (
		<>
			{hasDomesticProvider && (
				<LegalConsentCheckbox id="social-legal-consent" checked={consentGiven} onCheckedChange={setConsentGiven} />
			)}

			<div className="flex items-center gap-x-2">
				<hr className="flex-1" />
				<span className="font-medium text-xs tracking-wide">
					<Trans context="Choose to authenticate with a social provider (Google, GitHub, etc.) instead of email and password">
						or continue with
					</Trans>
				</span>
				<hr className="flex-1" />
			</div>

			{isLoading ? <SocialAuthSkeleton /> : <SocialAuthButtons providers={providers} consentGiven={consentGiven} />}
		</>
	);
}

function SocialAuthSkeleton() {
	return (
		<div className="grid grid-cols-2 gap-4">
			<Skeleton className="h-9 w-full" />
			<Skeleton className="h-9 w-full" />
			<Skeleton className="h-9 w-full" />
			<Skeleton className="h-9 w-full" />
		</div>
	);
}

type SocialAuthButtonsProps = {
	providers: RouterOutput["auth"]["providers"]["list"];
	consentGiven: boolean;
};

function SocialAuthButtons({ providers, consentGiven }: SocialAuthButtonsProps) {
	const router = useRouter();
	const { callbackURL } = useSearch({ from: "/auth" });

	// Sending the consent with the request is what the server gate (G1) validates;
	// without it the request never becomes an authorization URL, so the buttons are
	// disabled rather than failing after a round trip through the provider.
	const signInWithDomesticProvider = (provider: "wechat" | "alipay") => {
		const payload: SocialSignInPayload = {
			provider,
			callbackURL: callbackURL ?? "/dashboard",
			legalConsent: consentPayload,
			...getOAuthSignInOptions(callbackURL),
		};

		return runSignIn(() => authClient.signIn.social(payload));
	};

	const runSignIn = async (
		fn: () => Promise<{ data?: unknown; error: { message?: string } | null }>,
		isPasskey = false,
	) => {
		const toastId = toast.add({ type: "loading", description: t`Signing in...` });
		const { data, error } = await fn();
		if (error) {
			toast.add({
				type: "error",
				description:
					error.message ||
					t({
						comment: "Fallback toast when sign-in fails without an error message",
						message: "Failed to sign in. Please try again.",
					}),
				id: toastId,
			});
			return;
		}
		toast.close(toastId);
		if (isOAuthRedirect(data)) return;
		await router.invalidate();
		if (isPasskey) void router.navigate(getAuthRedirectOptions(callbackURL));
	};

	return (
		<div className="grid grid-cols-2 gap-4">
			<Button
				variant="secondary"
				onClick={() =>
					runSignIn(() =>
						authClient.signIn.social({
							provider: "custom",
							callbackURL: callbackURL ?? "/dashboard",
							...getOAuthSignInOptions(callbackURL),
						}),
					)
				}
				className={cn("hidden", "custom" in providers && "inline-flex")}
			>
				<VaultIcon />
				{providers.custom}
			</Button>

			<Button
				variant="secondary"
				onClick={() =>
					runSignIn(() => authClient.signIn.passkey({ autoFill: false, ...getOAuthPasskeyOptions(callbackURL) }), true)
				}
				className={cn("hidden", "passkey" in providers && "inline-flex")}
			>
				<FingerprintIcon />
				<Trans comment="Label for passkey sign-in button">Passkey</Trans>
			</Button>

			<Button
				onClick={() =>
					runSignIn(() =>
						authClient.signIn.social({
							provider: "google",
							callbackURL: callbackURL ?? "/dashboard",
							...getOAuthSignInOptions(callbackURL),
						}),
					)
				}
				className={cn(
					"hidden flex-1 bg-[#4285F4] text-white hover:bg-[#4285F4]/80",
					"google" in providers && "inline-flex",
				)}
			>
				<GoogleLogoIcon />
				<Trans comment="Brand name label for Google social sign-in button">Google</Trans>
			</Button>

			<Button
				onClick={() =>
					runSignIn(() =>
						authClient.signIn.social({
							provider: "github",
							callbackURL: callbackURL ?? "/dashboard",
							...getOAuthSignInOptions(callbackURL),
						}),
					)
				}
				className={cn(
					"hidden flex-1 bg-[#2b3137] text-white hover:bg-[#2b3137]/80",
					"github" in providers && "inline-flex",
				)}
			>
				<GithubLogoIcon />
				<Trans comment="Brand name label for GitHub social sign-in button">GitHub</Trans>
			</Button>

			<Button
				onClick={() =>
					runSignIn(() =>
						authClient.signIn.social({
							provider: "linkedin",
							callbackURL: callbackURL ?? "/dashboard",
							...getOAuthSignInOptions(callbackURL),
						}),
					)
				}
				className={cn(
					"hidden flex-1 bg-[#0A66C2] text-white hover:bg-[#0A66C2]/80",
					"linkedin" in providers && "inline-flex",
				)}
			>
				<LinkedinLogoIcon />
				<Trans comment="Brand name label for LinkedIn social sign-in button">LinkedIn</Trans>
			</Button>

			<Button
				disabled={!consentGiven}
				onClick={() => signInWithDomesticProvider("wechat")}
				className={cn(
					"hidden flex-1 bg-[#07C160] text-white hover:bg-[#07C160]/80",
					"wechat" in providers && "inline-flex",
				)}
			>
				<WechatLogoIcon />
				<Trans comment="Brand name label for WeChat social sign-in button">WeChat</Trans>
			</Button>

			<Button
				disabled={!consentGiven}
				onClick={() => signInWithDomesticProvider("alipay")}
				className={cn(
					"hidden flex-1 bg-[#1677FF] text-white hover:bg-[#1677FF]/80",
					"alipay" in providers && "inline-flex",
				)}
			>
				<WalletIcon />
				<Trans comment="Brand name label for Alipay social sign-in button">Alipay</Trans>
			</Button>
		</div>
	);
}
