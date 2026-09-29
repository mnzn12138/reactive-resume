import type { GenericOAuthConfig, GenericOAuthUserInfo } from "better-auth/plugins";
import type { AlipayCredentials } from "./gateway";
import { allocateUniqueUsername } from "../../oauth-profile";
import { buildPlaceholderEmail } from "../placeholder";
import { AlipayGatewayError, callAlipayGateway } from "./gateway";

/**
 * Alipay QR sign-in as a `genericOAuth` provider.
 *
 * Same shape as WeChat: the authorization jump is ordinary enough for
 * `genericOAuth`, and both non-standard calls (a signed POST to the gateway, and
 * a signed profile read) live in `getToken` / `getUserInfo`. RSA2 signing and
 * response verification are handled by `./gateway`, so nothing about Alipay's
 * crypto leaks into Better Auth's configuration.
 *
 * `pkce: false` and `scopes` on the top level are required for the same reasons
 * as WeChat: Alipay rejects PKCE, and `scope` is a reserved parameter that
 * would be dropped from `authorizationUrlParams`.
 */

const AUTHORIZATION_URL = "https://openauth.alipay.com/oauth2/publicAppAuthorize.htm";
const SCOPES = ["auth_user"] as const;

type GenericGetToken = NonNullable<GenericOAuthConfig["getToken"]>;
type OAuthTokens = Awaited<ReturnType<GenericGetToken>>;
type GetTokenInput = Parameters<GenericGetToken>[0];

/** Alipay's account identifier. Present on both the token and the profile response. */
function resolveAlipaySubject(profile: Record<string, unknown>): string {
	const userId = profile.user_id;
	if (typeof userId === "string" && userId) return userId;

	throw new Error("Alipay profile is missing user_id");
}

export type AlipayOAuthConfigOptions = AlipayCredentials & {
	redirectURI: string;
	/** Instance URL used to derive the placeholder email domain. */
	appUrl?: string | undefined;
	/** Mirrors the global signup flag, exactly like the built-in social providers. */
	disableSignUp?: boolean | undefined;
};

export function createAlipayOAuthConfig(options: AlipayOAuthConfigOptions): GenericOAuthConfig {
	const credentials: AlipayCredentials = {
		appId: options.appId,
		privateKey: options.privateKey,
		alipayPublicKey: options.alipayPublicKey,
	};

	return {
		providerId: "alipay",
		name: "Alipay",
		// `genericOAuth` requires a client id; Alipay calls the same value `app_id`,
		// which goes into the authorization parameters below.
		clientId: options.appId,
		authorizationUrl: AUTHORIZATION_URL,
		authorizationUrlParams: { app_id: options.appId },
		scopes: [...SCOPES],
		redirectURI: options.redirectURI,
		pkce: false,
		// Gate G3 — see the WeChat config for the reasoning.
		disableImplicitSignUp: true,
		...(options.disableSignUp === undefined ? {} : { disableSignUp: options.disableSignUp }),

		async getToken({ code }: GetTokenInput): Promise<OAuthTokens> {
			const payload = await callAlipayGateway({
				method: "alipay.system.oauth.token",
				credentials,
				bizContent: { grant_type: "authorization_code", code },
			});

			const accessToken = typeof payload.access_token === "string" ? payload.access_token : "";
			if (!accessToken) {
				throw new AlipayGatewayError("INVALID_RESPONSE", "Alipay token response is missing access_token");
			}

			const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : 1296000;
			const refreshExpiresIn = typeof payload.re_expires_in === "number" ? payload.re_expires_in : undefined;

			return {
				tokenType: "Bearer",
				accessToken,
				...(typeof payload.refresh_token === "string" ? { refreshToken: payload.refresh_token } : {}),
				accessTokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
				...(refreshExpiresIn ? { refreshTokenExpiresAt: new Date(Date.now() + refreshExpiresIn * 1000) } : {}),
				scopes: [...SCOPES],
			};
		},

		async getUserInfo(tokens: OAuthTokens): Promise<GenericOAuthUserInfo | null> {
			const accessToken = tokens.accessToken;
			if (!accessToken) throw new AlipayGatewayError("INVALID_RESPONSE", "Alipay access token is missing");

			// `alipay.user.info.share` takes the token as a top-level `auth_token`
			// parameter rather than in `biz_content`.
			//
			// Every failure is caught and logged, then turned into `null`: the callback
			// route does not catch this call, and `null` redirects with
			// `unable_to_get_user_info` instead of dropping the user on a 500. Nothing
			// is accepted unverified — an invalid signature is a failure like any other.
			let payload: Record<string, unknown>;
			try {
				payload = await callAlipayGateway({
					method: "alipay.user.info.share",
					credentials,
					authToken: accessToken,
				});
			} catch (error) {
				console.error("[auth] alipay profile request failed", error);
				return null;
			}

			return {
				user_id: resolveAlipaySubject(payload),
				...(typeof payload.nick_name === "string" ? { nick_name: payload.nick_name } : {}),
				...(typeof payload.avatar === "string" ? { avatar: payload.avatar } : {}),
				// Alipay asserts nothing about an email; the mapped profile fills in a
				// placeholder one. Required by the profile type, not by the provider.
				emailVerified: false,
			};
		},

		accountSubject: ({ profile }) => resolveAlipaySubject(profile),

		async mapProfileToUser(profile: GenericOAuthUserInfo) {
			const subject = resolveAlipaySubject(profile);
			const email = buildPlaceholderEmail({ channel: "alipay", subject, appUrl: options.appUrl });

			// Both fields are optional in the response: a user who never set a
			// nickname or avatar must still get an account.
			const nickname = typeof profile.nick_name === "string" ? profile.nick_name.trim() : "";
			const avatar = typeof profile.avatar === "string" ? profile.avatar.trim() : "";

			const username = await allocateUniqueUsername(email, nickname);

			return {
				name: nickname || username,
				email,
				username,
				displayUsername: username,
				emailVerified: false,
				...(avatar ? { image: avatar } : {}),
			};
		},
	} satisfies GenericOAuthConfig;
}
