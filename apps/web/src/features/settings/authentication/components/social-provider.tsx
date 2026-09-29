import type { AuthProvider } from "@reactive-resume/auth/types";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { LinkBreakIcon, LinkIcon } from "@phosphor-icons/react";
import { m } from "motion/react";
import { Button } from "@reactive-resume/ui/components/button";
import { Separator } from "@reactive-resume/ui/components/separator";
import { ActionButton } from "./action-button";
import {
	getProviderIcon,
	getProviderName,
	useAuthAccounts,
	useAuthProviderActions,
	useRemainingLoginMethods,
} from "./hooks";

type SocialProviderSectionProps = {
	provider: AuthProvider;
	name?: string;
	animationDelay?: number;
};

export function SocialProviderSection({ provider, name, animationDelay = 0 }: SocialProviderSectionProps) {
	const { link, unlink } = useAuthProviderActions();
	const { hasAccount, getAccountByProviderId } = useAuthAccounts();
	const { canUnlink } = useRemainingLoginMethods();

	const providerName = name ?? getProviderName(provider);
	const providerIcon = getProviderIcon(provider);

	const account = getAccountByProviderId(provider);
	const isConnected = hasAccount(provider);

	// The last remaining way in is not removable. Decided here, before the click,
	// rather than as an error afterwards — by then the account is already gone.
	const canDisconnect = canUnlink(provider);

	return (
		<m.div
			className="will-change-[transform,opacity]"
			initial={{ y: -20 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.2, delay: animationDelay, ease: "easeOut" }}
		>
			<Separator />

			<div className="mt-4 flex items-center justify-between gap-x-4">
				<h2 className="flex items-center gap-x-3 font-medium text-base">
					{providerIcon}
					{providerName}
				</h2>

				<ActionButton>
					{isConnected ? (
						<Button
							variant="outline"
							disabled={!canDisconnect}
							title={
								canDisconnect
									? undefined
									: t({
											comment: "Tooltip explaining why the last sign-in method cannot be disconnected",
											message: "Keep at least one way to sign in.",
										})
							}
							onClick={() => {
								if (account?.accountId) void unlink(provider, account.accountId);
							}}
						>
							<LinkBreakIcon />
							<Trans comment="Authentication settings action to unlink a connected social login provider">
								Disconnect
							</Trans>
						</Button>
					) : (
						<Button variant="outline" onClick={() => void link(provider)}>
							<LinkIcon />
							<Trans comment="Authentication settings action to link a social login provider">Connect</Trans>
						</Button>
					)}
				</ActionButton>
			</div>

			{isConnected && !canDisconnect && (
				<p className="mt-2 text-muted-foreground text-xs">
					<Trans comment="Hint explaining that the last remaining sign-in method cannot be removed">
						This is your only way to sign in. Connect another method before disconnecting this one.
					</Trans>
				</p>
			)}
		</m.div>
	);
}
