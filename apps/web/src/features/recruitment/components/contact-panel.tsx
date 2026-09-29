import type { RecruitmentPostDetail } from "../types";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { EnvelopeSimpleIcon, LockKeyIcon } from "@phosphor-icons/react";
import { Button } from "@reactive-resume/ui/components/button";
import { cn } from "@reactive-resume/utils/style";
import { contactKindLabels } from "../labels";

type ContactPanelProps = {
	/** `null` for anonymous callers — the server cuts the whole object, not its fields. */
	contact: RecruitmentPostDetail["contact"];
	isAuthenticated: boolean;
	loginHref: string;
	className?: string;
};

/**
 * How to reach whoever posted the role — the part of a post that must not be public.
 *
 * Anonymous visitors are treated as a normal path rather than an error state: they get an
 * explanation of what signing in unlocks instead of an empty panel, because an unauthenticated
 * share link is how most students arrive here.
 */
export function ContactPanel({ contact, isAuthenticated, loginHref, className }: ContactPanelProps) {
	const { i18n } = useLingui();

	return (
		<section className={cn("space-y-3 rounded-xl border p-4", className)} aria-labelledby="how-to-apply">
			<div className="flex items-center gap-x-2">
				<EnvelopeSimpleIcon className="text-muted-foreground" />
				<h2 className="font-medium text-sm" id="how-to-apply">
					<Trans>How to apply</Trans>
				</h2>
			</div>

			{contact === null && !isAuthenticated && (
				<div className="space-y-3 rounded-lg bg-muted/40 p-3">
					<p className="flex items-start gap-x-2 text-muted-foreground text-xs">
						<LockKeyIcon className="mt-0.5 shrink-0" />
						<Trans>Contact details are only shown to signed-in users. Log in to see how to reach the poster.</Trans>
					</p>

					<Button size="sm" variant="outline" nativeButton={false} render={<a href={loginHref}>{t`Log in`}</a>} />
				</div>
			)}

			{contact === null && isAuthenticated && (
				<p className="flex items-start gap-x-2 text-muted-foreground text-xs">
					<LockKeyIcon className="mt-0.5 shrink-0" />
					<Trans>The person who shared this role did not leave a way to be contacted.</Trans>
				</p>
			)}

			{contact !== null && (
				<dl className="space-y-2 text-sm">
					<div className="space-y-1">
						<dt className="text-muted-foreground text-xs">{i18n.t(contactKindLabels[contact.kind])}</dt>
						<dd className="wrap-anywhere rounded-lg bg-muted/40 p-2 font-mono text-xs">{contact.value}</dd>
					</div>

					{contact.referralCode !== null && (
						<div className="space-y-1">
							<dt className="text-muted-foreground text-xs">
								<Trans>Referral code</Trans>
							</dt>
							<dd className="wrap-anywhere rounded-lg bg-muted/40 p-2 font-mono text-xs">{contact.referralCode}</dd>
						</div>
					)}
				</dl>
			)}
		</section>
	);
}
