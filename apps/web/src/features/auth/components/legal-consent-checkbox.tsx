import { Trans } from "@lingui/react/macro";
import { legalDocumentRoutes, legalDocumentVersion } from "@reactive-resume/schema/legal";
import { Checkbox } from "@reactive-resume/ui/components/checkbox";

type LegalConsentCheckboxProps = {
	id: string;
	checked: boolean;
	onCheckedChange: (checked: boolean) => void;
};

/**
 * The privacy-policy / terms checkbox that must be ticked **before** an account exists.
 *
 * It is shared by every sign-in channel that can create the account from a single click — the
 * domestic providers (`social-auth.tsx`) and the SMS phone form (`phone-auth.tsx`) — because the
 * server gate needs the answer before the user row is written, and by then the browser is already
 * on its way elsewhere (see the consent hooks in `packages/auth/src/config.ts`).
 *
 * One component, not two copies: the links and the version line are legal evidence, so both
 * surfaces must point at the same documents and print the same version.
 */
export function LegalConsentCheckbox({ id, checked, onCheckedChange }: LegalConsentCheckboxProps) {
	return (
		<div className="flex items-start gap-x-2.5">
			<Checkbox
				id={id}
				className="mt-0.5"
				checked={checked}
				onCheckedChange={(value) => onCheckedChange(value === true)}
			/>

			<label htmlFor={id} className="font-normal text-muted-foreground text-xs leading-relaxed">
				<Trans comment="Label beside the legal consent checkbox that gates the sign-up buttons">
					I have read and agree to the{" "}
					<a
						className="text-foreground underline underline-offset-2"
						href={legalDocumentRoutes.terms}
						target="_blank"
						rel="noreferrer"
					>
						Terms of Service
					</a>{" "}
					and the{" "}
					<a
						className="text-foreground underline underline-offset-2"
						href={legalDocumentRoutes.privacy}
						target="_blank"
						rel="noreferrer"
					>
						Privacy Policy
					</a>
					.
				</Trans>

				<span className="block text-muted-foreground text-xs">
					<Trans comment="Note under the consent checkbox naming the version being accepted">
						Version {legalDocumentVersion} of both documents.
					</Trans>
				</span>
			</label>
		</div>
	);
}
