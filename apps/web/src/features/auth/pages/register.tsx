import type { LegalConsent } from "@reactive-resume/schema/legal";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { ArrowRightIcon, EyeIcon, EyeSlashIcon } from "@phosphor-icons/react";
import { Link, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { useToggle } from "usehooks-ts";
import z from "zod";
import { legalDocumentRoutes, legalDocumentVersion } from "@reactive-resume/schema/legal";
import { Alert, AlertDescription, AlertTitle } from "@reactive-resume/ui/components/alert";
import { Button } from "@reactive-resume/ui/components/button";
import { Checkbox } from "@reactive-resume/ui/components/checkbox";
import { FormControl, FormDescription, FormItem, FormLabel, FormMessage } from "@reactive-resume/ui/components/form";
import { Input } from "@reactive-resume/ui/components/input";
import { toast } from "@reactive-resume/ui/components/toast";
import { authClient } from "@/libs/auth/client";
import { useAppForm } from "@/libs/tanstack-form";
import { SocialAuth } from "../components/social-auth";
import { getOAuthSignInOptions, isOAuthRedirect } from "../redirect";

const formSchema = z.object({
	name: z.string().min(3).max(64),
	username: z
		.string()
		.min(3)
		.max(64)
		.trim()
		.toLowerCase()
		.regex(/^[a-z0-9._-]+$/, {
			message: "Username can only contain lowercase letters, numbers, dots, hyphens and underscores.",
		}),
	email: z.email().toLowerCase(),
	password: z.string().min(6).max(64),
	// The server rejects a signup that does not carry matching consent, so the client has to make
	// an unchecked box unsubmittable rather than only uncomfortable.
	legalConsent: z.boolean().refine((value) => value, {
		error: () =>
			t({
				comment: "Validation error shown when the registration form is submitted without accepting the legal documents",
				message: "Accept the Terms of Service and the Privacy Policy to create your account.",
			}),
	}),
});

type Props = {
	disableEmailAuth: boolean;
};

/**
 * `legalConsent` is part of the signup contract the server enforces before the user row is created
 * (see `packages/auth/src/config.ts`). It is declared here rather than inferred so the call site
 * stays type-checked until the matching field is registered on the auth config as well.
 */
type SignUpEmailPayload = Parameters<typeof authClient.signUp.email>[0] & { legalConsent: LegalConsent };

export function RegisterPage({ disableEmailAuth }: Props) {
	const { callbackURL, reauthenticate } = useSearch({ from: "/auth" });
	const [submitted, setSubmitted] = useState(false);
	const [showPassword, toggleShowPassword] = useToggle(false);

	const form = useAppForm({
		defaultValues: { name: "", username: "", email: "", password: "", legalConsent: false },
		validators: { onSubmit: formSchema },
		onSubmit: async ({ value }) => {
			const toastId = toast.add({ type: "loading", description: t`Signing up...` });

			const oauthOptions = getOAuthSignInOptions(callbackURL);
			const createPrompt = new URLSearchParams(oauthOptions.oauth_query).get("prompt")?.split(" ").includes("create");
			// Validation above guarantees the box is checked, so the payload can state consent literally.
			const payload: SignUpEmailPayload = {
				name: value.name,
				email: value.email,
				password: value.password,
				username: value.username,
				displayUsername: value.username,
				callbackURL: callbackURL ?? "/dashboard",
				legalConsent: { accepted: true, version: legalDocumentVersion },
				...(!createPrompt ? oauthOptions : {}),
			};

			const { data, error } = await authClient.signUp.email(payload);

			if (error) {
				toast.add({
					type: "error",
					description:
						error.message ||
						t({
							comment: "Fallback toast when account registration fails without a server error message",
							message: "Failed to create your account. Please try again.",
						}),
					id: toastId,
				});
				return;
			}

			if (isOAuthRedirect(data)) return;
			if (createPrompt && oauthOptions.oauth_query) {
				const continuation = await authClient.oauth2.continue({ created: true, oauth_query: oauthOptions.oauth_query });
				if (continuation.error) {
					toast.add({ type: "error", description: continuation.error.message, id: toastId });
					return;
				}
				if (isOAuthRedirect(continuation.data)) return;
			}
			setSubmitted(true);
			toast.close(toastId);
		},
	});

	if (submitted) return <PostSignupScreen />;

	return (
		<>
			<div className="space-y-1 text-center">
				<h1 className="font-semibold text-2xl tracking-tight">
					<Trans>Create a new account</Trans>
				</h1>

				<div className="text-muted-foreground">
					<Trans>
						Already have an account?{" "}
						<Button
							variant="link"
							nativeButton={false}
							className="h-auto gap-1.5 px-1! py-0"
							render={
								<Link to="/auth/login" search={{ callbackURL, reauthenticate }}>
									<Trans comment="Call-to-action link from registration page to login page">Sign in now</Trans>{" "}
									<ArrowRightIcon />
								</Link>
							}
						/>
					</Trans>
				</div>
			</div>

			{!disableEmailAuth && (
				<form
					className="space-y-6"
					onSubmit={(event) => {
						event.preventDefault();
						event.stopPropagation();
						void form.handleSubmit();
					}}
				>
					<form.Field name="name">
						{(field) => (
							<FormItem hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
								<FormLabel>
									<Trans comment="Label for full name input on registration form">Name</Trans>
								</FormLabel>
								<FormControl
									render={
										<Input
											min={3}
											max={64}
											autoComplete="section-register name"
											placeholder={t({
												comment: "Example full name placeholder on registration form",
												message: "John Doe",
											})}
											name={field.name}
											value={field.state.value}
											onBlur={field.handleBlur}
											onChange={(event) => field.handleChange(event.target.value)}
										/>
									}
								/>
								<FormMessage errors={field.state.meta.errors} />
							</FormItem>
						)}
					</form.Field>

					<form.Field name="username">
						{(field) => (
							<FormItem hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
								<FormLabel>
									<Trans comment="Label for username input on registration form">Username</Trans>
								</FormLabel>
								<FormControl
									render={
										<Input
											min={3}
											max={64}
											autoComplete="section-register username"
											placeholder={t({
												comment: "Example username placeholder on registration form",
												message: "john.doe",
											})}
											className="lowercase"
											name={field.name}
											value={field.state.value}
											onBlur={field.handleBlur}
											onChange={(event) => field.handleChange(event.target.value)}
										/>
									}
								/>
								<FormMessage errors={field.state.meta.errors} />
							</FormItem>
						)}
					</form.Field>

					<form.Field name="email">
						{(field) => (
							<FormItem hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
								<FormLabel>
									<Trans comment="Label for email input on registration form">Email Address</Trans>
								</FormLabel>
								<FormControl
									render={
										<Input
											type="email"
											autoComplete="section-register email"
											placeholder="john.doe@example.com"
											className="lowercase"
											name={field.name}
											value={field.state.value}
											onBlur={field.handleBlur}
											onChange={(event) => field.handleChange(event.target.value)}
										/>
									}
								/>
								<FormMessage errors={field.state.meta.errors} />
							</FormItem>
						)}
					</form.Field>

					<form.Field name="password">
						{(field) => (
							<FormItem hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
								<FormLabel>
									<Trans comment="Label for password input on registration form">Password</Trans>
								</FormLabel>
								<div className="flex items-center gap-x-1.5">
									<FormControl
										render={
											<Input
												min={6}
												max={64}
												type={showPassword ? "text" : "password"}
												autoComplete="section-register new-password"
												name={field.name}
												value={field.state.value}
												onBlur={field.handleBlur}
												onChange={(event) => field.handleChange(event.target.value)}
											/>
										}
									/>

									<Button
										size="icon"
										variant="ghost"
										onClick={toggleShowPassword}
										aria-label={
											showPassword
												? t({
														comment: "Accessible label for button that hides password in registration form",
														message: "Hide password",
													})
												: t({
														comment: "Accessible label for button that reveals password in registration form",
														message: "Show password",
													})
										}
									>
										{showPassword ? <EyeIcon /> : <EyeSlashIcon />}
									</Button>
								</div>
								<FormMessage errors={field.state.meta.errors} />
							</FormItem>
						)}
					</form.Field>

					<form.Field name="legalConsent">
						{(field) => (
							<FormItem hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
								{/* `FormControl` wires the checkbox to the `FormLabel` below, which is what names it. */}
								<div className="flex items-start gap-x-2.5">
									<FormControl
										className="pt-0.5"
										render={
											<Checkbox
												name={field.name}
												checked={field.state.value}
												onBlur={field.handleBlur}
												onCheckedChange={(checked) => field.handleChange(checked === true)}
											/>
										}
									/>

									<FormLabel className="font-normal text-muted-foreground text-xs leading-relaxed">
										<Trans comment="Label beside the legal consent checkbox; the two links open the legal documents">
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
									</FormLabel>
								</div>

								<FormMessage errors={field.state.meta.errors} />
								<FormDescription>
									<Trans comment="Note under the legal consent checkbox naming the version being accepted">
										Version {legalDocumentVersion} of both documents.
									</Trans>
								</FormDescription>
							</FormItem>
						)}
					</form.Field>

					<Button type="submit" className="w-full">
						<Trans comment="Primary action button label on registration form">Sign up</Trans>
					</Button>
				</form>
			)}

			<SocialAuth />
		</>
	);
}

function PostSignupScreen() {
	const { callbackURL } = useSearch({ from: "/auth" });
	return (
		<>
			<div className="space-y-1 text-center">
				<h1 className="font-semibold text-2xl tracking-tight">
					<Trans>You've got mail!</Trans>
				</h1>
				<p className="text-muted-foreground">
					<Trans>Check your email for a link to verify your account.</Trans>
				</p>
			</div>

			<Alert>
				<AlertTitle>
					<Trans>This step is optional, but recommended.</Trans>
				</AlertTitle>
				<AlertDescription>
					<Trans>Verifying your email is required when resetting your password.</Trans>
				</AlertDescription>
			</Alert>

			<Button
				nativeButton={false}
				render={
					<a href={callbackURL ?? "/dashboard"}>
						<Trans comment="Button label to continue to dashboard after successful registration">Continue</Trans>{" "}
						<ArrowRightIcon />
					</a>
				}
			/>
		</>
	);
}
