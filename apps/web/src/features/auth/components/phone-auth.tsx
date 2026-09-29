import type { LegalConsent } from "@reactive-resume/schema/legal";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { ArrowLeftIcon } from "@phosphor-icons/react";
import { useStore } from "@tanstack/react-form";
import { useNavigate, useRouter, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import z from "zod";
import { legalDocumentVersion } from "@reactive-resume/schema/legal";
import { Button } from "@reactive-resume/ui/components/button";
import { FormControl, FormDescription, FormItem, FormLabel, FormMessage } from "@reactive-resume/ui/components/form";
import { Input } from "@reactive-resume/ui/components/input";
import { OTPField } from "@reactive-resume/ui/components/otp-field";
import { toast } from "@reactive-resume/ui/components/toast";
import { authClient } from "@/libs/auth/client";
import { getReadableErrorMessage } from "@/libs/error-message";
import { useAppForm } from "@/libs/tanstack-form";
import { usePhoneOtp } from "../phone-otp";
import { getAuthRedirectOptions, getOAuthSignInOptions, isOAuthRedirect } from "../redirect";
import { LegalConsentCheckbox } from "./legal-consent-checkbox";

const phoneNumberFormSchema = z.object({
	// Deliberately loose: the server owns real phone validation and normalisation, this only keeps
	// obvious typos from burning a verification code.
	phoneNumber: z
		.string()
		.trim()
		.regex(/^\+?\d{6,20}$/, {
			message: "Enter a valid phone number, digits only, optionally starting with a plus sign.",
		}),
});

const codeFormSchema = z.object({
	code: z.string().length(6, { message: "Enter the 6-digit code we sent you." }),
});

/**
 * The consent rides along with the **verify** call, not the request for a code.
 *
 * Verifying is the only phone request that can create an account, so it is where the server gate
 * lives (`assertPhoneSignUpConsent` in `packages/auth/src/config.ts`). Numbers that already have an
 * account are exempt there, so ticking the box never blocks an existing user from signing in.
 */
const consentPayload: LegalConsent = { accepted: true, version: legalDocumentVersion };

export function PhoneAuth() {
	const router = useRouter();
	const navigate = useNavigate();
	const { callbackURL } = useSearch({ from: "/auth" });

	const otp = usePhoneOtp();
	const [consentGiven, setConsentGiven] = useState(false);

	const phoneForm = useAppForm({
		defaultValues: { phoneNumber: "" },
		validators: { onSubmit: phoneNumberFormSchema },
		onSubmit: async ({ value }) => {
			await otp.send(value.phoneNumber);
		},
	});

	const codeForm = useAppForm({
		defaultValues: { code: "" },
		validators: { onSubmit: codeFormSchema },
		onSubmit: async ({ value }) => {
			const toastId = toast.add({ type: "loading", description: t`Signing in...` });

			const { data, error } = await authClient.phoneNumber.verify({
				phoneNumber: otp.phoneNumber,
				code: value.code,
				legalConsent: consentPayload,
				...getOAuthSignInOptions(callbackURL),
			});

			if (error) {
				toast.add({
					type: "error",
					description: getReadableErrorMessage(
						error,
						t({
							comment: "Fallback toast when the SMS verification code cannot be verified",
							message: "Failed to sign in. Please check the code and try again.",
						}),
					),
					id: toastId,
				});
				return;
			}

			toast.close(toastId);

			// Same two steps as the email form in `login.tsx`: an OAuth continuation navigates on its
			// own, and everything else has to drop the router's cached session before it can render
			// the signed-in shell.
			if (isOAuthRedirect(data)) return;
			await router.invalidate();
			void navigate(getAuthRedirectOptions(callbackURL));
		},
	});

	const isSendingPhoneNumber = useStore(phoneForm.store, (state) => state.isSubmitting);
	const isVerifyingCode = useStore(codeForm.store, (state) => state.isSubmitting);

	if (otp.hasSentCode) {
		return (
			<form
				className="space-y-6"
				onSubmit={(event) => {
					event.preventDefault();
					event.stopPropagation();
					void codeForm.handleSubmit();
				}}
			>
				<codeForm.Field name="code">
					{(field) => (
						<FormItem hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
							<FormLabel>
								<Trans comment="Label for the SMS verification code input">Verification Code</Trans>
							</FormLabel>
							<FormControl
								render={
									<OTPField
										length={6}
										autoSubmit
										name={field.name}
										value={field.state.value}
										onBlur={field.handleBlur}
										onValueChange={field.handleChange}
									/>
								}
							/>
							<FormMessage errors={field.state.meta.errors} />
							<FormDescription>
								<Trans comment="Hint telling the user which number the verification code was sent to">
									We sent a 6-digit code to {otp.phoneNumber}.
								</Trans>
							</FormDescription>
						</FormItem>
					)}
				</codeForm.Field>

				<Button type="submit" className="w-full" disabled={isVerifyingCode}>
					<Trans comment="Primary action button that verifies the SMS code, signing the user in or creating the account">
						Sign in / Register
					</Trans>
				</Button>

				<div className="flex items-center justify-between gap-x-2">
					<Button type="button" variant="ghost" size="sm" onClick={otp.reset}>
						<ArrowLeftIcon />
						<Trans comment="Secondary action that returns from the code step to entering a phone number">
							Change Number
						</Trans>
					</Button>

					{/* Disabled while the local countdown runs, but remember: the countdown is UX, the
					    server's own rate limit is what actually decides. */}
					<Button
						type="button"
						variant="link"
						size="sm"
						disabled={otp.secondsLeft > 0 || otp.isSending}
						onClick={() => void otp.send(otp.phoneNumber)}
					>
						{otp.secondsLeft > 0 ? (
							<Trans comment="Resend button label counting down the seconds left before another code can be requested">
								Resend in {otp.secondsLeft}s
							</Trans>
						) : (
							<Trans comment="Action that asks for another SMS verification code">Resend Code</Trans>
						)}
					</Button>
				</div>
			</form>
		);
	}

	return (
		<form
			className="space-y-6"
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				void phoneForm.handleSubmit();
			}}
		>
			<phoneForm.Field name="phoneNumber">
				{(field) => (
					<FormItem hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
						<FormLabel>
							<Trans comment="Label for the phone number input used to sign in with an SMS code">Phone Number</Trans>
						</FormLabel>
						<FormControl
							render={
								<Input
									type="tel"
									inputMode="tel"
									autoComplete="tel"
									placeholder="13800138000"
									name={field.name}
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(event) => field.handleChange(event.target.value)}
								/>
							}
						/>
						<FormMessage errors={field.state.meta.errors} />
						<FormDescription>
							<Trans comment="Hint under the phone number input explaining an account is created on first use">
								We'll create your account the first time you use this number.
							</Trans>
						</FormDescription>
					</FormItem>
				)}
			</phoneForm.Field>

			<LegalConsentCheckbox id="phone-legal-consent" checked={consentGiven} onCheckedChange={setConsentGiven} />

			{/* Consent has to be given up front: the server refuses to create the account without it,
			    and once the account exists there is no page left to ask on. */}
			<Button type="submit" className="w-full" disabled={!consentGiven || isSendingPhoneNumber}>
				<Trans comment="Primary action button that requests an SMS verification code for the entered phone number">
					Send Code
				</Trans>
			</Button>
		</form>
	);
}
