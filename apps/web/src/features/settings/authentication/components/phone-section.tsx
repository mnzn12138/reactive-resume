import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { LinkIcon, PencilSimpleLineIcon } from "@phosphor-icons/react";
import { useStore } from "@tanstack/react-form";
import { useRouter } from "@tanstack/react-router";
import { m } from "motion/react";
import { useState } from "react";
import z from "zod";
import { Button } from "@reactive-resume/ui/components/button";
import { FormControl, FormDescription, FormItem, FormLabel, FormMessage } from "@reactive-resume/ui/components/form";
import { Input } from "@reactive-resume/ui/components/input";
import { OTPField } from "@reactive-resume/ui/components/otp-field";
import { Separator } from "@reactive-resume/ui/components/separator";
import { toast } from "@reactive-resume/ui/components/toast";
import { usePhoneOtp } from "@/features/auth/phone-otp";
import { authClient } from "@/libs/auth/client";
import { getReadableErrorMessage } from "@/libs/error-message";
import { useAppForm } from "@/libs/tanstack-form";
import { ActionButton } from "./action-button";
import { getProviderIcon, getProviderName } from "./hooks";

/**
 * The phone number binding for an existing account: show it, replace it — and nothing else.
 *
 * There is deliberately **no unbind button** here. Removing a phone number has to respect the
 * "keep at least one way to sign in" rule, and that rule belongs to the unlink paths owned by T04
 * (`useAuthProviderActions().unlink`, `SocialProviderSection`). Adding unbind here first would
 * either duplicate that guard or let a user strip their last credential. Wire it in with T04, then
 * drop this paragraph.
 */

const phoneNumberFormSchema = z.object({
	// Same shape check as the login form: the server validates and normalises for real, this only
	// keeps obvious typos from spending a verification code.
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

type PhoneSectionProps = {
	animationDelay?: number;
};

export function PhoneSection({ animationDelay = 0 }: PhoneSectionProps) {
	const router = useRouter();
	const { data: session } = authClient.useSession();
	const otp = usePhoneOtp();
	const [isEditing, setIsEditing] = useState(false);

	// `phoneNumber` is part of the user row the phone plug-in adds, so it comes back with the session.
	const boundPhoneNumber = session?.user.phoneNumber ?? null;

	const providerName = getProviderName("phone");
	const providerIcon = getProviderIcon("phone");

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
			const toastId = toast.add({ type: "loading", description: t`Verifying code…` });

			// `updatePhoneNumber` is the switch that makes `/phone-number/verify` move the *current*
			// user onto the new number instead of creating an account for it — the endpoint requires a
			// session for that branch, which is exactly what this settings page has.
			const { error } = await authClient.phoneNumber.verify({
				phoneNumber: otp.phoneNumber,
				code: value.code,
				updatePhoneNumber: true,
			});

			if (error) {
				toast.add({
					type: "error",
					description: getReadableErrorMessage(
						error,
						t({
							comment: "Fallback toast when changing the bound phone number fails",
							message: "Failed to change your phone number. Please try again.",
						}),
					),
					id: toastId,
				});
				return;
			}

			// The session carries the old number, so it has to be dropped before the row above can
			// show the new one.
			toast.close(toastId);
			toast.add({ type: "success", description: t`Your phone number has been changed.` });

			await router.invalidate();
			stopEditing();
		},
	});

	const isSendingPhoneNumber = useStore(phoneForm.store, (state) => state.isSubmitting);
	const isVerifyingCode = useStore(codeForm.store, (state) => state.isSubmitting);

	const startEditing = () => {
		setIsEditing(true);
	};

	const stopEditing = () => {
		setIsEditing(false);
		otp.reset();
		phoneForm.reset();
		codeForm.reset();
	};

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
					<Button variant="outline" disabled={isEditing} onClick={startEditing}>
						{boundPhoneNumber ? (
							<>
								<PencilSimpleLineIcon />
								<Trans comment="Authentication settings action that starts changing the bound phone number">
									Change Number
								</Trans>
							</>
						) : (
							<>
								<LinkIcon />
								<Trans comment="Authentication settings action that starts binding a phone number">Connect</Trans>
							</>
						)}
					</Button>
				</ActionButton>
			</div>

			{boundPhoneNumber && (
				<p className="mt-2 font-mono text-muted-foreground text-sm">{maskPhoneNumber(boundPhoneNumber)}</p>
			)}

			{isEditing && (
				<div className="mt-4 space-y-4">
					{otp.hasSentCode ? (
						<form
							className="space-y-4"
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

							<div className="flex items-center gap-x-2">
								<Button type="submit" disabled={isVerifyingCode}>
									<Trans comment="Primary action button that verifies the code and moves the account to the new number">
										Confirm
									</Trans>
								</Button>

								{/* Same countdown caveat as the login form: it is UX only, the server's rate
								    limit on `/phone-number/send-otp` is what actually throttles. */}
								<Button
									type="button"
									variant="ghost"
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

								<Button type="button" variant="outline" className="ms-auto" onClick={stopEditing}>
									<Trans comment="Secondary action that aborts changing the phone number">Cancel</Trans>
								</Button>
							</div>
						</form>
					) : (
						<form
							className="space-y-4"
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
											<Trans comment="Label for the phone number input in account settings">Phone Number</Trans>
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
											<Trans comment="Hint explaining that the new number replaces the current one once verified">
												Verifying the code replaces the number your account uses to sign in.
											</Trans>
										</FormDescription>
									</FormItem>
								)}
							</phoneForm.Field>

							<div className="flex items-center gap-x-2">
								<Button type="submit" disabled={isSendingPhoneNumber}>
									<Trans comment="Primary action button that requests an SMS verification code for the new number">
										Send Code
									</Trans>
								</Button>

								<Button type="button" variant="outline" onClick={stopEditing}>
									<Trans comment="Secondary action that aborts changing the phone number">Cancel</Trans>
								</Button>
							</div>
						</form>
					)}
				</div>
			)}
		</m.div>
	);
}

/**
 * `+8613800138000` → `+86****8000`.
 *
 * The server hands over the full number — there is no masked field — so masking happens here, and
 * this screen is the only place it can happen. Numbers too short to hide anything are returned
 * untouched rather than rendered as something that merely looks masked.
 */
function maskPhoneNumber(value: string): string {
	const visiblePrefixLength = 3;
	const visibleSuffixLength = 4;

	if (value.length <= visiblePrefixLength + visibleSuffixLength) return value;

	return `${value.slice(0, visiblePrefixLength)}****${value.slice(-visibleSuffixLength)}`;
}
