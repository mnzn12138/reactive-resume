import type { GenericOAuthConfig, GenericOAuthUserInfo } from "better-auth/plugins";
import type { WechatUserProfile } from "./api";
import { allocateUniqueUsername } from "../../oauth-profile";
import { buildPlaceholderEmail } from "../placeholder";
import { exchangeWechatCode, fetchWechatUserProfile } from "./api";

/**
 * WeChat QR connect as a `genericOAuth` provider.
 *
 * The built-in `wechat` provider is not used: it only supports the
 * `platformType: "WebsiteApp"` form, cannot change the authorization
 * parameters, cannot replace the token or profile calls, and — fatally — its
 * profile has no email, which Better Auth rejects before a user is created.
 * `genericOAuth` lets every one of those differences be expressed in config, so
 * no adapter route is needed.
 *
 * Three details are easy to get wrong and silently break the flow:
 *
 * - **PKCE must be off.** The framework defaults `pkce` to `true` and WeChat
 *   rejects the resulting `code_challenge`.
 * - **`scope` has to go through the top-level `scopes` array.** `scope` is in
 *   the framework's reserved-parameter list, so writing it into
 *   `authorizationUrlParams` drops it without a warning.
 * - **`#wechat_redirect` belongs on `authorizationUrl`**, not on a parameter:
 *   it is a fragment, and the framework appends the query *before* the
 *   fragment, which is exactly where WeChat wants it.
 *
 * All three are asserted by `config.test.ts` against the URL the real plugin
 * builds.
 */

type GenericGetToken = NonNullable<GenericOAuthConfig["getToken"]>;
type OAuthTokens = Awaited<ReturnType<GenericGetToken>>;
type GetTokenInput = Parameters<GenericGetToken>[0];

/**
 * WeChat's `openid` / `unionid` ride along on the token response.
 *
 * `OAuth2Tokens` has no index signature, so they are attached with a cast and
 * read back with one. The plugin passes the object returned by `getToken`
 * straight into `getUserInfo`, which is what makes this safe at runtime — if a
 * future version starts stripping unknown fields, `getUserInfo` would have to
 * re-fetch the token instead.
 */
type WechatTokenExtras = { openid?: string; unionid?: string };

function readWechatExtras(tokens: OAuthTokens): WechatTokenExtras {
	const extras = tokens as OAuthTokens & WechatTokenExtras;

	return {
		...(typeof extras.openid === "string" && extras.openid ? { openid: extras.openid } : {}),
		...(typeof extras.unionid === "string" && extras.unionid ? { unionid: extras.unionid } : {}),
	};
}

/** `unionid` first: it survives across apps of the same open platform account. */
export function resolveWechatSubject(profile: Record<string, unknown>): string {
	const unionid = profile.unionid;
	const openid = profile.openid;

	if (typeof unionid === "string" && unionid) return unionid;
	if (typeof openid === "string" && openid) return openid;

	throw new Error("WeChat profile is missing both unionid and openid");
}

export type WechatOAuthConfigOptions = {
	clientId: string;
	clientSecret: string;
	redirectURI: string;
	/** Instance URL used to derive the placeholder email domain. */
	appUrl?: string | undefined;
	/** Mirrors the global signup flag, exactly like the built-in social providers. */
	disableSignUp?: boolean | undefined;
};

export function createWechatOAuthConfig(options: WechatOAuthConfigOptions): GenericOAuthConfig {
	const { clientId, clientSecret, redirectURI } = options;

	return {
		providerId: "wechat",
		name: "WeChat",
		clientId,
		clientSecret,
		// The fragment is part of the endpoint URL itself, not a query parameter.
		authorizationUrl: "https://open.weixin.qq.com/connect/qrconnect#wechat_redirect",
		// WeChat names the client id `appid`. The framework's own `client_id` is sent
		// alongside it; WeChat ignores unknown parameters. This assumption is asserted
		// by the tests and listed as unverified against the live endpoint.
		authorizationUrlParams: { appid: clientId },
		// Must sit here, not in `authorizationUrlParams` — see the note above.
		scopes: ["snsapi_login"],
		redirectURI,
		pkce: false,
		// Gate G3: even if the consent gate were bypassed, the callback refuses to
		// create an account unless the server set `requestSignUp` itself.
		disableImplicitSignUp: true,
		...(options.disableSignUp === undefined ? {} : { disableSignUp: options.disableSignUp }),

		async getToken({ code }: GetTokenInput): Promise<OAuthTokens> {
			const exchanged = await exchangeWechatCode({ code, appId: clientId, appSecret: clientSecret });

			// `openid` is persisted on `account.openid`; `unionid` becomes `accountId`
			// through `accountSubject`. Neither survives as a typed field, hence the cast.
			return {
				tokenType: "Bearer",
				accessToken: exchanged.accessToken,
				refreshToken: exchanged.refreshToken,
				accessTokenExpiresAt: exchanged.accessTokenExpiresAt,
				scopes: exchanged.scopes,
				openid: exchanged.openid,
				...(exchanged.unionid ? { unionid: exchanged.unionid } : {}),
			} as unknown as OAuthTokens;
		},

		async getUserInfo(tokens: OAuthTokens): Promise<GenericOAuthUserInfo | null> {
			const { accessToken } = tokens;
			const { openid, unionid } = readWechatExtras(tokens);

			if (!accessToken || !openid) {
				throw new Error("WeChat tokens are missing access_token or openid");
			}

			// A profile failure is not caught by the callback route, so it is turned
			// into `null` here: Better Auth then redirects with
			// `unable_to_get_user_info` instead of leaving the user on a 500. The
			// cause is logged for whoever has to diagnose it.
			let profile: WechatUserProfile;
			try {
				profile = await fetchWechatUserProfile({ accessToken, openid });
			} catch (error) {
				console.error("[auth] wechat profile request failed", error);
				return null;
			}

			return {
				...profile,
				openid: profile.openid ?? openid,
				...(unionid || profile.unionid ? { unionid: unionid ?? profile.unionid } : {}),
				// WeChat asserts nothing about an email; the mapped profile fills in a
				// placeholder one. Required by the profile type, not by the provider.
				emailVerified: false,
			};
		},

		// Better Auth 1.7 resolves provider identity here, never from the mapped user.
		accountSubject: ({ profile }) => resolveWechatSubject(profile),

		async mapProfileToUser(profile: GenericOAuthUserInfo) {
			const subject = resolveWechatSubject(profile);
			const email = buildPlaceholderEmail({ channel: "wechat", subject, appUrl: options.appUrl });
			const nickname = typeof profile.nickname === "string" ? profile.nickname : "";
			const image = typeof profile.headimgurl === "string" && profile.headimgurl ? profile.headimgurl : undefined;

			// Falls back to the email local part (`wechat_<subject>`) when the nickname
			// normalises to nothing — a Chinese or emoji-only nickname would otherwise
			// leave `username` empty and violate NOT NULL.
			const username = await allocateUniqueUsername(email, nickname);

			return {
				name: nickname.trim() || username,
				email,
				username,
				displayUsername: username,
				// WeChat never vouches for an email, and the address is ours anyway.
				emailVerified: false,
				...(image ? { image } : {}),
			};
		},
	} satisfies GenericOAuthConfig;
}
