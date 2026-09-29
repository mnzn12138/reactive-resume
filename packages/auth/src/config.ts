import type { GenericOAuthConfig, GenericOAuthUserInfo } from "better-auth/plugins";
import type { JWTPayload } from "jose";
import type { ConsentSource } from "./consent";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { dash } from "@better-auth/infra";
import { oauthProvider } from "@better-auth/oauth-provider";
import { passkey } from "@better-auth/passkey";
import { compare, hash } from "bcrypt";
import { APIError, betterAuth } from "better-auth";
import { addOAuthServerContext, createAuthMiddleware, getOAuthState, getSessionFromCtx } from "better-auth/api";
import { verifyBearerToken } from "better-auth/oauth2";
import { admin, jwt } from "better-auth/plugins";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { phoneNumber } from "better-auth/plugins/phone-number";
import { twoFactor } from "better-auth/plugins/two-factor";
import { username } from "better-auth/plugins/username";
import { eq, inArray } from "drizzle-orm";
import { createElement } from "react";
import { db } from "@reactive-resume/db/client";
import * as schema from "@reactive-resume/db/schema";
import { ResetPasswordEmail, VerifyEmail, VerifyEmailChange } from "@reactive-resume/email/templates/auth";
import { sendEmail } from "@reactive-resume/email/transport";
import { env } from "@reactive-resume/env/server";
import { legalConsentSchema, legalDocuments, legalDocumentVersion } from "@reactive-resume/schema/legal";
import { resolveSmsConfig } from "@reactive-resume/sms/drivers";
import { normalizePhoneNumber } from "@reactive-resume/sms/phone";
import { rateLimitConfig, TRUSTED_IP_HEADERS } from "@reactive-resume/utils/rate-limit";
import { generateId, toUsername } from "@reactive-resume/utils/string";
import { isAllowedOAuthRedirectUri } from "@reactive-resume/utils/url-security.node";
import {
	assertLegalConsent,
	buildConsentTicket,
	channelFromCallbackPath,
	isDomesticProvider,
	resolveConsentSource,
} from "./consent";
import { createAlipayOAuthConfig } from "./domestic-oauth/alipay/config";
import { createWechatOAuthConfig } from "./domestic-oauth/wechat/config";
import {
	isAlipayAuthDisabled,
	isEmailAuthDisabled,
	isSignupDisabled,
	isSmsAuthDisabled,
	isWechatAuthDisabled,
} from "./instance-settings";
import { createGithubProfileMapper, createProfileMapper } from "./oauth-profile";
import { createSmsOtpOptions } from "./sms-otp";
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
 * Every route the `phoneNumber` plugin exposes, plus the sign-in shortcut it
 * adds. Kept as prefixes so a future route on the same plugin is covered without
 * editing this list by hand.
 */
const SMS_AUTH_PATH_PREFIXES = ["/phone-number", "/sign-in/phone-number"] as const;

const isSmsAuthPath = (path: string) => SMS_AUTH_PATH_PREFIXES.some((candidate) => path.includes(candidate));

/**
 * The one phone route that can create an account, and therefore the one that
 * needs a consent gate. See `assertPhoneSignUpConsent` for why it is not
 * `/phone-number/send-otp`.
 */
const PHONE_VERIFY_PATH = "/phone-number/verify";

/**
 * Per-provider runtime switches for the domestic channels.
 *
 * A provider's credentials are read once, at boot, when `getAuthConfig()` builds
 * the plugin list — so an administrator cannot add or remove a channel at
 * runtime, only close it. Closing happens here, on the endpoint, mirroring how
 * `isEmailAuthDisabled` works above: hiding a button is presentation, dropping
 * the request is enforcement.
 */
const PROVIDER_DISABLED_CHECKS: Record<string, () => Promise<boolean>> = {
	wechat: isWechatAuthDisabled,
	alipay: isAlipayAuthDisabled,
};

/** The request body fields the social endpoints carry. Narrowed locally: Better Auth types bodies loosely. */
const socialProviderFromBody = (body: unknown): string | undefined => {
	const provider = (body as { provider?: unknown } | undefined)?.provider;
	return typeof provider === "string" ? provider : undefined;
};

/**
 * Which social endpoints each domestic gate applies to.
 *
 * The consent gate is scoped to the two new channels on purpose: Google, GitHub
 * and LinkedIn have always been able to create an account without a checkbox,
 * and forcing one on them now would change behaviour for every existing
 * deployment. The new channels get it because they would otherwise add two more
 * ways to create an account with no consent record at all.
 */
const SOCIAL_SIGN_IN_PATH = "/sign-in/social";
const SOCIAL_LINK_PATH = "/link-social";

/**
 * Server-side `requestSignUp`, so the callback can create an account.
 *
 * The provider is registered with `disableImplicitSignUp: true`, which means the
 * callback refuses to create anyone unless this flag is set — and this flag is
 * only ever set here, after the consent gate has passed. A client sending
 * `requestSignUp: true` itself is ignored: the value is overwritten, not read.
 */
function allowAccountCreation(body: unknown): void {
	if (typeof body !== "object" || body === null) return;
	(body as { requestSignUp?: boolean }).requestSignUp = true;
}

/**
 * Binding a domestic provider is only ever allowed for a signed-in user.
 *
 * These two providers are trusted *and* `allowDifferentEmails` is on, because
 * neither returns an email address — without both, linking fails silently. That
 * combination makes the linking branch the interesting attack surface, so it is
 * re-asserted here even though `/link-social` already runs behind
 * `sessionMiddleware`.
 *
 * Fails open on an unexpected error rather than blocking: `sessionMiddleware`
 * still decides, and a broken lookup must not lock anyone out of linking.
 */
async function assertLinkSession(ctx: { context: { session?: unknown } }): Promise<void> {
	const existing = ctx.context.session as { user?: { id?: string } } | null | undefined;
	if (existing?.user?.id) return;

	let resolved: unknown = null;
	try {
		resolved = await getSessionFromCtx(ctx as Parameters<typeof getSessionFromCtx>[0]);
	} catch {
		return;
	}

	if ((resolved as { user?: { id?: string } } | null)?.user?.id) return;

	throw new APIError("FORBIDDEN", { message: "You must be signed in to link a sign-in provider." });
}

/**
 * The fields of an about-to-be-created `user` row this file reads or fills in.
 * Narrowed locally: Better Auth types the hook loosely and the fork adds
 * `username` / `displayUsername` / `phoneNumber` on top of its core `User`.
 */
type PendingUser = {
	username?: string | null;
	displayUsername?: string | null;
	phoneNumber?: string | null;
	email?: string;
	name?: string;
};

/** Mirrors `minUsernameLength` on the `username` plugin below. */
const MIN_USERNAME_LENGTH = 3;

const USERNAME_PATTERN = /^[a-z0-9._-]+$/;

/** The `user` row as better-auth hands it to `databaseHooks.user.create.before`. */
const asPendingUser = (newUser: unknown): PendingUser => (newUser ?? {}) as PendingUser;

const trimmed = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/**
 * What to derive a username from when the caller did not supply one.
 *
 * Email local part first, then the phone number's digits — `toUsername` keeps
 * digits, so `+8613800138000` becomes `8613800138000` — and the display name as
 * a last resort.
 */
function usernameSeed(user: PendingUser): string {
	const localPart = trimmed(user.email).split("@")[0] ?? "";
	if (localPart !== "") return localPart;

	const phoneNumber = trimmed(user.phoneNumber);
	if (phoneNumber !== "") return phoneNumber.replace(/\D/g, "");

	return trimmed(user.name);
}

/**
 * Fills in `username` / `displayUsername` when the caller left them out.
 *
 * This exists because of one upstream detail: `signUpOnVerification` creates the
 * user with `email` and `name` only, while `user.username` and
 * `user.displayUsername` are both `notNull().unique()` in this fork — without a
 * fallback every phone sign-up dies on the constraint before the account is ever
 * written.
 *
 * The guard is `username` being absent, so email and social sign-ups (which
 * already resolve their own through the `username` plugin) are untouched: this
 * only ever runs on a path that would otherwise fail.
 *
 * Returns `undefined` when nothing needs doing.
 */
async function resolveMissingUsername(newUser: unknown): Promise<string | undefined> {
	const pending = asPendingUser(newUser);

	if (trimmed(pending.username) !== "") return undefined;

	const seed = toUsername(usernameSeed(pending));
	const base = USERNAME_PATTERN.test(seed) && seed.length >= MIN_USERNAME_LENGTH ? seed.slice(0, 64) : "user";

	let taken: boolean;

	try {
		const [row] = await db
			.select({ id: schema.user.id })
			.from(schema.user)
			.where(eq(schema.user.username, base))
			.limit(1);

		taken = row !== undefined;
	} catch (error) {
		// The lookup is a nicety, not a gate: a collision costs one extra suffix,
		// while failing the signup costs the user their account. Fall back to the
		// suffixed form, which is unique for any practical collision rate.
		console.error("[auth] username availability check failed; using a suffixed username", { error });
		taken = true;
	}

	return taken ? `${base}-${generateId().slice(0, 6)}`.slice(0, 64) : base;
}

/**
 * Gate **G1** for the phone channel.
 *
 * It is attached to `/phone-number/verify` and not to `/phone-number/send-otp`
 * on purpose: verification is the only request that can create an account, so
 * gating `send-otp` would force every *existing* user to tick the box again
 * before they could even receive a code. Verify is also where it is technically
 * possible — the endpoint's body schema is `z.object({...}).and(z.record(...))`,
 * so the extra `legalConsent` field the client posts survives validation and is
 * still on `ctx.body` when this hook runs.
 *
 * Accounts that already exist are exempt: they accepted when they registered and
 * their `user_consent` rows are already on file.
 */
async function assertPhoneSignUpConsent(body: unknown): Promise<void> {
	const rawPhoneNumber = (body as { phoneNumber?: unknown } | undefined)?.phoneNumber;

	// Not a string means the endpoint's own schema will reject the request; there
	// is nothing here to decide yet.
	if (typeof rawPhoneNumber !== "string") return;

	const normalized = normalizePhoneNumber(rawPhoneNumber);

	// The plugin looks the existing user up by the raw `ctx.body.phoneNumber` it
	// was handed and then writes that same string back to `user.phone_number`, so
	// the column holds whatever the client typed. Both spellings have to be tried
	// or a user who first signed up with `+86…` looks unknown when they type
	// `138…`, and gets asked to re-accept.
	const candidates =
		normalized === undefined || normalized === rawPhoneNumber ? [rawPhoneNumber] : [rawPhoneNumber, normalized];

	let hasAccount = false;

	try {
		const [row] = await db
			.select({ id: schema.user.id })
			.from(schema.user)
			.where(inArray(schema.user.phoneNumber, candidates))
			.limit(1);

		hasAccount = row !== undefined;
	} catch (error) {
		// Fails closed. A wrong "already consented" would create an account with no
		// `user_consent` row at all, which is the single outcome this gate exists to
		// prevent; the cost of being wrong the other way is one retry.
		console.error("[auth] phone-number lookup failed; requiring legal consent", { error });
		hasAccount = false;
	}

	if (hasAccount) return;

	const consent = legalConsentSchema.safeParse((body as { legalConsent?: unknown } | undefined)?.legalConsent);

	if (!consent.success) {
		throw new APIError("FORBIDDEN", {
			message: "You must accept the privacy policy and terms of service to create an account.",
		});
	}

	if (consent.data.version !== legalDocumentVersion) {
		throw new APIError("FORBIDDEN", {
			message: "The privacy policy and terms of service have changed. Please review and accept the current versions.",
		});
	}
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

	if (env.WECHAT_APP_ID && env.WECHAT_APP_SECRET) {
		authConfigs.push(
			createWechatOAuthConfig({
				clientId: env.WECHAT_APP_ID,
				clientSecret: env.WECHAT_APP_SECRET,
				redirectURI: `${authBaseUrl}/api/auth/callback/wechat`,
				appUrl: authBaseUrl,
				disableSignUp: env.FLAG_DISABLE_SIGNUPS,
			}),
		);
	}

	if (env.ALIPAY_APP_ID && env.ALIPAY_PRIVATE_KEY && env.ALIPAY_PUBLIC_KEY) {
		authConfigs.push(
			createAlipayOAuthConfig({
				appId: env.ALIPAY_APP_ID,
				privateKey: env.ALIPAY_PRIVATE_KEY,
				alipayPublicKey: env.ALIPAY_PUBLIC_KEY,
				redirectURI: `${authBaseUrl}/api/auth/callback/alipay`,
				appUrl: authBaseUrl,
				disableSignUp: env.FLAG_DISABLE_SIGNUPS,
			}),
		);
	}

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

				// Same treatment for the domestic channels: the switch has to hold on
				// the request, not just in the login page's markup.
				if (isSmsAuthPath(ctx.path) && (await isSmsAuthDisabled())) {
					throw new APIError("FORBIDDEN", { message: "Phone number sign-in is disabled on this instance." });
				}

				if (ctx.path.includes(SOCIAL_SIGN_IN_PATH) || ctx.path.includes(SOCIAL_LINK_PATH)) {
					const provider = socialProviderFromBody(ctx.body);
					const isDisabled = provider ? PROVIDER_DISABLED_CHECKS[provider] : undefined;

					if (isDisabled && (await isDisabled())) {
						throw new APIError("FORBIDDEN", {
							message: `Sign-in with ${provider} is disabled on this instance.`,
						});
					}
				}

				// Gate G1 + G2 for the domestic providers: validate the checkbox the
				// user ticked on the login page, then freeze it into the OAuth state.
				// Throwing here means the browser never receives an authorization URL,
				// so there is no callback and therefore no account.
				if (ctx.path.includes(SOCIAL_SIGN_IN_PATH)) {
					const provider = socialProviderFromBody(ctx.body);

					if (isDomesticProvider(provider) && provider !== "phone") {
						const consent = assertLegalConsent(ctx.body);

						await addOAuthServerContext({
							legalConsent: buildConsentTicket(consent, provider),
						});
						allowAccountCreation(ctx.body);
					}
				}

				if (ctx.path.includes(SOCIAL_LINK_PATH)) {
					const provider = socialProviderFromBody(ctx.body);

					if (provider === "wechat" || provider === "alipay") await assertLinkSession(ctx);
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

				// Same gate as above, for the phone channel. Only fires when the
				// number has no account yet — see `assertPhoneSignUpConsent`.
				if (ctx.path.includes(PHONE_VERIFY_PATH)) {
					await assertPhoneSignUpConsent(ctx.body);
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
			 * request. `resolveConsentSource` narrows it to the gated paths, so a null
			 * source means "no consent was collected" and nothing is inserted — an
			 * account simply ends up with zero consent rows rather than one asserting
			 * an acceptance it cannot evidence.
			 *
			 * For the domestic callbacks the source additionally requires a
			 * server-minted ticket, read back from the encrypted OAuth state. That is
			 * what keeps a `/callback/:id` request that never went through the consent
			 * gate from producing a row — and, paired with G3, from producing an
			 * account either.
			 */
			after: createAuthMiddleware(async (ctx) => {
				const newSession = ctx.context.newSession;
				if (!newSession) return;

				const serverContext = channelFromCallbackPath(ctx.path) ? (await getOAuthState())?.serverContext : undefined;

				const source = resolveConsentSource({ path: ctx.path, serverContext, hasNewSession: true });
				if (!source) return;

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

						// The phone channel's `signUpOnVerification` supplies no
						// username, and both username columns are `notNull` here.
						// Everything else arrives with one and is left alone.
						const username = await resolveMissingUsername(newUser);
						if (username === undefined) return { data: newUser };

						return {
							data: {
								...newUser,
								username,
								displayUsername: trimmed(asPendingUser(newUser).displayUsername) || username,
							},
						};
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
				/**
				 * Neither WeChat nor Alipay returns an email address, so an account
				 * created through them holds a placeholder one. Without this flag the
				 * linking branch compares it against the signed-in user's real address
				 * and refuses — silently, because the callback only redirects with an
				 * error code.
				 *
				 * The flag only affects the two *linking* branches (starting a link and
				 * finishing one); sign-in and sign-up never compare emails. The
				 * compensating controls are in `hooks.before`: linking a domestic
				 * provider still requires a signed-in session, and only these two
				 * providers are trusted.
				 */
				allowDifferentEmails: true,
				trustedProviders: ["google", "github", "linkedin", "wechat", "alipay"],
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
			/**
			 * The phone channel follows the same rule as `socialProviders`: the
			 * vendor's credentials are read once, here, at boot — so an
			 * administrator can *close* the channel at runtime
			 * (`isSmsAuthDisabled` in `hooks.before`) but can never open one the
			 * environment does not support. Registering the plugin without a driver
			 * would only add a sign-in button that always fails on send.
			 */
			...(resolveSmsConfig().configured ? [phoneNumber(createSmsOtpOptions())] : []),
			...(env.BETTER_AUTH_API_KEY
				? [dash({ apiKey: env.BETTER_AUTH_API_KEY, activityTracking: { enabled: true } })]
				: []),
		],
	});
};

export const auth = getAuthConfig();
