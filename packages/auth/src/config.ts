import type { GenericOAuthConfig, GenericOAuthUserInfo } from "better-auth/plugins";
import type { JWTPayload } from "jose";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { dash } from "@better-auth/infra";
import { oauthProvider } from "@better-auth/oauth-provider";
import { passkey } from "@better-auth/passkey";
import { compare, hash } from "bcrypt";
import { APIError, betterAuth } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { verifyBearerToken } from "better-auth/oauth2";
import { admin, jwt } from "better-auth/plugins";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { twoFactor } from "better-auth/plugins/two-factor";
import { username } from "better-auth/plugins/username";
import { createElement } from "react";
import { db } from "@reactive-resume/db/client";
import * as schema from "@reactive-resume/db/schema";
import { ResetPasswordEmail, VerifyEmail, VerifyEmailChange } from "@reactive-resume/email/templates/auth";
import { sendEmail } from "@reactive-resume/email/transport";
import { env } from "@reactive-resume/env/server";
import { legalConsentSchema, legalDocuments, legalDocumentVersion } from "@reactive-resume/schema/legal";
import { rateLimitConfig, TRUSTED_IP_HEADERS } from "@reactive-resume/utils/rate-limit";
import { generateId, toUsername } from "@reactive-resume/utils/string";
import { isAllowedOAuthRedirectUri } from "@reactive-resume/utils/url-security.node";
import { isEmailAuthDisabled, isSignupDisabled } from "./instance-settings";
import { createGithubProfileMapper, createProfileMapper } from "./oauth-profile";
import { getTrustedOrigins } from "./trusted-origins";

const authBaseUrl = env.APP_URL;
const isRateLimitEnabled = process.env.NODE_ENV === "production" && !env.FLAG_DISABLE_API_RATE_LIMIT;

/**
 * Every route the `emailAndPassword` plugin exposes. Turning the plugin off at
 * boot removes all of them, so a runtime override has to answer for the same set
 * — keeping the list explicit is what makes that coverage reviewable.
 */
const EMAIL_AUTH_PATHS = [
	"/sign-up/email",
	"/sign-in/email",
	"/forget-password",
	"/reset-password",
	"/send-verification-email",
] as const;

const isEmailAuthPath = (path: string) => EMAIL_AUTH_PATHS.some((candidate) => path.includes(candidate));

/**
 * How a consent row was collected. Stored verbatim on `user_consent.source`.
 *
 * "manual" is reserved for a future re-acceptance surface — asking an existing
 * user to take the current version after a document bump. Nothing produces it
 * yet, so today every row comes from the sign-up gate below.
 */
type ConsentSource = "signup-email" | "manual";

/**
 * The one endpoint allowed to record consent: the path the gate above actually
 * runs on.
 *
 * A `user_consent` row is legal evidence that this user accepted this version of
 * this document, so it may only be written when the gate has run and `legalConsent`
 * has been validated. That is why `/callback/:id` is deliberately absent: a social
 * or generic-OAuth account is inserted there after a redirect through the third
 * party, so the user never sees our checkbox. Writing a row for it would assert an
 * acceptance that never happened — a misrepresentation of the user, which is worse
 * than having no row at all.
 *
 * Signing in again is absent for the same reason: stamping an existing account
 * with the current document version would backdate consent to a request that
 * asked for nothing.
 */
function consentSourceFor(path: string): ConsentSource | null {
	if (path.includes("/sign-up/email")) return "signup-email";
	return null;
}

/**
 * Appends one `user_consent` row per published legal document.
 *
 * Best effort, mirroring `recordAudit` in the admin feature: a failure is
 * logged and never thrown, because a missing ledger row must not fail a
 * signup. The `(userId, document, version)` unique index makes a repeat
 * insert a no-op, so this is safe to call from any account-creating request.
 */
async function recordConsent(entry: {
	userId: string;
	source: ConsentSource;
	metadata: { ip?: string; userAgent?: string };
}): Promise<void> {
	try {
		await db
			.insert(schema.userConsent)
			.values(
				legalDocuments.map((document) => ({
					userId: entry.userId,
					document,
					version: legalDocumentVersion,
					source: entry.source,
					metadata: entry.metadata,
				})),
			)
			.onConflictDoNothing();
	} catch (error) {
		console.error("[auth] failed to record legal consent", {
			userId: entry.userId,
			source: entry.source,
			error,
		});
	}
}

// JWKS must be reachable from inside the Node runtime. `authBaseUrl` is the
// publicly-visible URL — under Docker port-mapping or behind a reverse proxy
// it does not loop back to the app process. Override with `BETTER_AUTH_INTERNAL_URL`
// for split deployments or custom servers that bind to a port not exposed via `PORT`.
function resolveInternalBaseUrl(): string {
	const configured = process.env.BETTER_AUTH_INTERNAL_URL?.trim();
	if (configured) {
		return configured.replace(/\/+$/, "");
	}

	const port = process.env.NODE_ENV === "production" ? (process.env.PORT ?? "3000") : String(env.SERVER_PORT);

	return `http://127.0.0.1:${port}`;
}

const internalBaseUrl = resolveInternalBaseUrl();

const oauthAudienceBase = authBaseUrl.replace(/\/$/, "");
// These identify the same account-wide API/MCP resource, not separate permission
// tiers. Protected-resource metadata advertises the root; MCP clients may also
// select the mounted endpoint or normalize either URI with a trailing slash.
const OAUTH_AUDIENCES = [
	oauthAudienceBase,
	`${oauthAudienceBase}/`,
	`${oauthAudienceBase}/mcp`,
	`${oauthAudienceBase}/mcp/`,
];

export function verifyOAuthToken(token: string): Promise<JWTPayload> {
	return verifyBearerToken(token, {
		jwksUrl: `${internalBaseUrl}/api/auth/jwks`,
		verifyOptions: {
			issuer: `${authBaseUrl}/api/auth`,
			audience: OAUTH_AUDIENCES,
		},
	});
}

function isCustomOAuthProviderEnabled() {
	const hasDiscovery = Boolean(env.OAUTH_DISCOVERY_URL);
	const hasManual =
		Boolean(env.OAUTH_AUTHORIZATION_URL) && Boolean(env.OAUTH_TOKEN_URL) && Boolean(env.OAUTH_USER_INFO_URL);

	return Boolean(env.OAUTH_CLIENT_ID) && Boolean(env.OAUTH_CLIENT_SECRET) && (hasDiscovery || hasManual);
}

const TRUSTED_ORIGINS = getTrustedOrigins(env.APP_URL);
const oauthProviderRateLimit = isRateLimitEnabled
	? rateLimitConfig.betterAuth.oauthProvider
	: ({
			register: false,
			authorize: false,
			token: false,
			introspect: false,
			revoke: false,
			userinfo: false,
		} as const);

// Better Auth 1.7 types generic-OAuth profile extras as `unknown`.
function asString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

// `@better-auth/oauth-provider@1.7.1` declares OpenAPI parameter metadata (`schema.items`) in a
// shape that is not `exactOptionalPropertyTypes`-clean, which stops the plugin from structurally
// satisfying `BetterAuthPlugin`. `metadata` only feeds doc generation, so dropping it from the
// endpoint types keeps request/response inference (`auth.api.*`) intact. Remove once upstream ships
// EOPT-compatible endpoint types.
type WithoutEndpointMetadata<TPlugin> = TPlugin extends { endpoints: infer TEndpoints }
	? Omit<TPlugin, "endpoints"> & {
			endpoints: {
				[K in keyof TEndpoints]: TEndpoints[K] extends {
					(...args: infer TArgs): infer TResult;
					options: infer TOptions;
					path: infer TPath;
				}
					? {
							(...args: TArgs): TResult;
							options: Omit<TOptions, "metadata">;
							path: TPath;
						}
					: TEndpoints[K];
			};
		}
	: TPlugin;

const getAuthConfig = () => {
	const authConfigs: GenericOAuthConfig[] = [];

	if (isCustomOAuthProviderEnabled()) {
		authConfigs.push({
			providerId: "custom",
			disableSignUp: env.FLAG_DISABLE_SIGNUPS,
			clientId: env.OAUTH_CLIENT_ID as string,
			clientSecret: env.OAUTH_CLIENT_SECRET as string,
			discoveryUrl: env.OAUTH_DISCOVERY_URL,
			authorizationUrl: env.OAUTH_AUTHORIZATION_URL,
			tokenUrl: env.OAUTH_TOKEN_URL,
			userInfoUrl: env.OAUTH_USER_INFO_URL,
			scopes: env.OAUTH_SCOPES,
			// Better Auth 1.7 folds generic OAuth providers into `socialProviders`, so the callback
			// is served by `/callback/:id` — the old `/oauth2/callback/:id` route no longer exists.
			redirectURI: `${authBaseUrl}/api/auth/callback/custom`,
			mapProfileToUser: createProfileMapper<GenericOAuthUserInfo>({
				providerName: "OAuth Provider",
				getPreferredUsername: (profile, context) => asString(profile.preferred_username) ?? context.emailLocalPart,
				getName: (profile, context) =>
					asString(profile.name) ?? asString(profile.preferred_username) ?? context.emailLocalPart,
				getImage: (profile) => asString(profile.image) ?? asString(profile.picture) ?? asString(profile.avatar_url),
			}),
		} satisfies GenericOAuthConfig);
	}

	return betterAuth({
		appName: "Reactive Resume",
		baseURL: authBaseUrl,
		secret: env.AUTH_SECRET,

		database: drizzleAdapter(db, { schema, provider: "pg" }),

		telemetry: { enabled: false },
		trustedOrigins: TRUSTED_ORIGINS,
		rateLimit: {
			...rateLimitConfig.betterAuth.global,
			enabled: isRateLimitEnabled,
		},

		hooks: {
			before: createAuthMiddleware(async (ctx) => {
				// `emailAndPassword.enabled` below is frozen at boot from the environment.
				// An administrator toggling the flag at runtime has to be enforced here,
				// otherwise the switch would only hide buttons in the web app while the
				// endpoints stayed open.
				if (isEmailAuthPath(ctx.path) && (await isEmailAuthDisabled())) {
					throw new APIError("FORBIDDEN", { message: "Email and password authentication is disabled." });
				}

				// Creating an account has to carry explicit consent to the current privacy
				// policy and terms. The other email paths are left alone on purpose: anyone
				// signing in or resetting a password consented when they registered, and
				// gating those would lock existing users out of their accounts.
				if (ctx.path.includes("/sign-up/email")) {
					const body = ctx.body as { legalConsent?: unknown } | undefined;
					const consent = legalConsentSchema.safeParse(body?.legalConsent);

					if (!consent.success) {
						throw new APIError("FORBIDDEN", {
							message: "You must accept the privacy policy and terms of service to create an account.",
						});
					}

					if (consent.data.version !== legalDocumentVersion) {
						throw new APIError("FORBIDDEN", {
							message:
								"The privacy policy and terms of service have changed. Please review and accept the current versions.",
						});
					}
				}

				if (!ctx.path.includes("/oauth2/register")) return;

				const body = ctx.body as { redirect_uris?: unknown } | undefined;
				const redirectUris = Array.isArray(body?.redirect_uris) ? body.redirect_uris : [];

				for (const uri of redirectUris) {
					if (typeof uri !== "string") {
						throw new APIError("BAD_REQUEST", { message: "redirect_uris entries must be strings" });
					}
					if (
						!isAllowedOAuthRedirectUri(uri, TRUSTED_ORIGINS, {
							allowUnsafe: env.FLAG_ALLOW_UNSAFE_OAUTH_REDIRECT_URI,
						})
					) {
						throw new APIError("BAD_REQUEST", {
							message: "redirect_uri is not allowed for dynamic client registration",
						});
					}
				}
			}),

			/**
			 * Runs after the endpoint handler with the same context, so it sees both
			 * `newSession` (set by `setSessionCookie` on every account-creating path)
			 * and the incoming request. `newSession.user` is the account that was just
			 * created, and `newSession.session` already carries the IP and user agent
			 * Better Auth resolved from `advanced.ipAddress.ipAddressHeaders` — so
			 * nothing here has to re-parse trusted-proxy headers.
			 *
			 * `databaseHooks.user.create.after` would be the tighter trigger, but it is
			 * queued after the transaction and only receives the endpoint context
			 * opportunistically; this hook reliably has both the new user and the
			 * request. `consentSourceFor` narrows it to the gated sign-up path, so a
			 * null source means "no consent was collected" and nothing is inserted —
			 * an account simply ends up with zero consent rows rather than one
			 * asserting an acceptance it cannot evidence.
			 */
			after: createAuthMiddleware(async (ctx) => {
				const source = consentSourceFor(ctx.path);
				const newSession = ctx.context.newSession;

				if (!source || !newSession) return;

				const { ipAddress, userAgent } = newSession.session;

				await recordConsent({
					userId: newSession.user.id,
					source,
					metadata: {
						...(ipAddress ? { ip: ipAddress } : {}),
						...(userAgent ? { userAgent: userAgent } : {}),
					},
				});
			}),
		},

		/**
		 * The single choke point for account creation.
		 *
		 * `emailAndPassword.disableSignUp` (and the per-provider equivalents on the
		 * social plugins) are read once at boot, so they cannot express a runtime
		 * override. Email sign-up, username sign-up, social sign-in and the OAuth
		 * flows all end up inserting a `user` row, so the runtime check lives here
		 * rather than in a list of route paths that would drift.
		 */
		databaseHooks: {
			user: {
				create: {
					before: async (newUser) => {
						if (await isSignupDisabled()) {
							throw new APIError("FORBIDDEN", { message: "New signups are disabled on this instance." });
						}
						return { data: newUser };
					},
				},
			},
		},

		// Without this, OAuth callback failures land on Better Auth's built-in `/api/auth/error`
		// page. It also backs the `oauthProvider` plugin's authorization errors that happen before
		// `redirect_uri` is validated and so cannot be returned to the requesting client.
		onAPIError: { errorURL: "/auth/error" },

		advanced: {
			database: { generateId },
			useSecureCookies: authBaseUrl.startsWith("https://"),
			ipAddress: { ipAddressHeaders: TRUSTED_IP_HEADERS },
		},

		emailAndPassword: {
			enabled: !env.FLAG_DISABLE_EMAIL_AUTH,
			autoSignIn: true,
			minPasswordLength: 8,
			maxPasswordLength: 64,
			requireEmailVerification: false,
			disableSignUp: env.FLAG_DISABLE_SIGNUPS || env.FLAG_DISABLE_EMAIL_AUTH,
			sendResetPassword: async ({ user, url }) => {
				await sendEmail({
					to: user.email,
					subject: "Reset your password",
					react: createElement(ResetPasswordEmail, { url }),
				});
			},
			password: {
				hash: (password) => hash(password, 10),
				verify: ({ password, hash }) => compare(password, hash),
			},
		},

		emailVerification: {
			sendOnSignUp: true,
			autoSignInAfterVerification: true,
			sendVerificationEmail: async ({ user, url }) => {
				await sendEmail({
					to: user.email,
					subject: "Verify your email",
					react: createElement(VerifyEmail, { url }),
				});
			},
		},

		user: {
			changeEmail: {
				enabled: true,
				sendChangeEmailConfirmation: async ({ user, newEmail, url }) => {
					await sendEmail({
						to: newEmail,
						subject: "Verify your new email",
						react: createElement(VerifyEmailChange, { url, previousEmail: user.email, newEmail }),
					});
				},
			},
			additionalFields: {
				username: {
					type: "string",
					required: true,
				},
			},
		},

		// Better Auth gates `/unlink-account` (and `/list-sessions`) behind a "fresh"
		// session, which defaults to one day old. Sessions here live for a week and
		// there is no re-authentication flow to refresh that timestamp, so disconnecting
		// a provider failed with `SESSION_NOT_FRESH` for anyone who signed in yesterday.
		session: { freshAge: 0 },

		account: {
			accountLinking: {
				enabled: true,
				trustedProviders: ["google", "github", "linkedin"],
			},
		},

		socialProviders: {
			google: {
				enabled: !!env.GOOGLE_CLIENT_ID && !!env.GOOGLE_CLIENT_SECRET,
				disableSignUp: env.FLAG_DISABLE_SIGNUPS,
				clientId: env.GOOGLE_CLIENT_ID ?? "",
				clientSecret: env.GOOGLE_CLIENT_SECRET ?? "",
				mapProfileToUser: createProfileMapper({
					providerName: "Google",
					getName: (profile, context) => profile.name ?? context.emailLocalPart,
					getImage: (profile) => profile.picture,
				}),
			},

			github: {
				enabled: !!env.GITHUB_CLIENT_ID && !!env.GITHUB_CLIENT_SECRET,
				disableSignUp: env.FLAG_DISABLE_SIGNUPS,
				clientId: env.GITHUB_CLIENT_ID ?? "",
				clientSecret: env.GITHUB_CLIENT_SECRET ?? "",
				mapProfileToUser: createGithubProfileMapper(),
			},

			linkedin: {
				enabled: !!env.LINKEDIN_CLIENT_ID && !!env.LINKEDIN_CLIENT_SECRET,
				disableSignUp: env.FLAG_DISABLE_SIGNUPS,
				clientId: env.LINKEDIN_CLIENT_ID ?? "",
				clientSecret: env.LINKEDIN_CLIENT_SECRET ?? "",
				mapProfileToUser: createProfileMapper({
					providerName: "LinkedIn",
					getName: (profile, context) => profile.name ?? context.emailLocalPart,
					getImage: (profile) => profile.picture,
				}),
			},
		},

		plugins: [
			jwt(),
			admin(),
			passkey(),
			genericOAuth({ config: authConfigs }),
			twoFactor({ issuer: "Reactive Resume" }),
			oauthProvider({
				loginPage: "/api/auth/oauth",
				consentPage: "/auth/consent",
				resources: OAUTH_AUDIENCES,
				clientRegistrationDefaultResources: OAUTH_AUDIENCES,
				allowDynamicClientRegistration: true,
				// Required for MCP client onboarding (RFC 7591). Redirect URI validation
				// and explicit user consent protect access by dynamically registered clients.
				allowUnauthenticatedClientRegistration: true,
				rateLimit: oauthProviderRateLimit,
				silenceWarnings: { oauthAuthServerConfig: true },
			}) as WithoutEndpointMetadata<ReturnType<typeof oauthProvider>>,
			username({
				minUsernameLength: 3,
				maxUsernameLength: 64,
				usernameNormalization: (value) => toUsername(value),
				displayUsernameNormalization: (value) => toUsername(value),
				usernameValidator: (username) => /^[a-z0-9._-]+$/.test(username),
				validationOrder: { username: "post-normalization", displayUsername: "post-normalization" },
			}),
			...(env.BETTER_AUTH_API_KEY
				? [dash({ apiKey: env.BETTER_AUTH_API_KEY, activityTracking: { enabled: true } })]
				: []),
		],
	});
};

export const auth = getAuthConfig();
