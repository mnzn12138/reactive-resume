/**
 * Raw calls to the WeChat Open Platform endpoints used by QR connect.
 *
 * Both endpoints answer HTTP 200 even when they fail, with `errcode` /
 * `errmsg` in the body, so every response has to be checked rather than trusted.
 * Keeping them apart from the provider config makes them easy to stub in tests.
 */

const TOKEN_URL = "https://api.weixin.qq.com/sns/oauth2/access_token";
const USER_INFO_URL = "https://api.weixin.qq.com/sns/userinfo";

/** WeChat reports failures as a numeric code in the body, never as an HTTP status. */
type WechatErrorCode = string | number;

class WechatApiError extends Error {
	readonly code: WechatErrorCode;

	constructor(code: WechatErrorCode, message: string) {
		super(message);
		this.name = "WechatApiError";
		this.code = code;
	}
}

function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function readString(source: Record<string, unknown>, key: string): string | undefined {
	const value = source[key];
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumber(source: Record<string, unknown>, key: string): number | undefined {
	const value = source[key];
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
	return undefined;
}

/**
 * Throws when a WeChat response carries an error code. `0` means success; a
 * missing `errcode` means success too, which is what a successful token or
 * profile response looks like.
 */
function assertNoWechatError(payload: Record<string, unknown>, context: string): void {
	const errcode = payload.errcode;
	if (errcode === undefined || errcode === 0 || errcode === "0") return;

	const errmsg = readString(payload, "errmsg") ?? "unknown WeChat error";
	throw new WechatApiError(
		typeof errcode === "number" || typeof errcode === "string" ? errcode : "unknown",
		`${context}: ${errmsg}`,
	);
}

export type WechatCodeExchange = {
	accessToken: string;
	refreshToken: string;
	accessTokenExpiresAt: Date;
	scopes: string[];
	/** Per-app id. Falls back to this when the open platform account has no `unionid`. */
	openid: string;
	/** Stable across every app of the same open platform account. Absent for some apps. */
	unionid?: string | undefined;
};

/**
 * Exchanges the authorization `code` for tokens.
 *
 * WeChat is not a standard OAuth2 token endpoint: it is a GET with query
 * parameters, it takes `appid` instead of `client_id`, and it returns `openid`
 * (and `unionid`) alongside the tokens — neither of which a standard
 * `OAuth2Tokens` has room for, so they are returned separately and carried
 * through `getUserInfo` by the provider config.
 */
export async function exchangeWechatCode(input: {
	code: string;
	appId: string;
	appSecret: string;
}): Promise<WechatCodeExchange> {
	const url = new URL(TOKEN_URL);
	url.searchParams.set("appid", input.appId);
	url.searchParams.set("secret", input.appSecret);
	url.searchParams.set("code", input.code);
	url.searchParams.set("grant_type", "authorization_code");

	const response = await fetch(url);
	if (!response.ok) {
		throw new WechatApiError(response.status, `WeChat token endpoint returned HTTP ${response.status}`);
	}

	const payload = asRecord(await response.json());
	assertNoWechatError(payload, "WeChat token exchange failed");

	const accessToken = readString(payload, "access_token");
	const openid = readString(payload, "openid");

	if (!accessToken || !openid) {
		throw new WechatApiError("invalid_response", "WeChat token response is missing access_token or openid");
	}

	const expiresIn = readNumber(payload, "expires_in") ?? 7200;

	return {
		accessToken,
		refreshToken: readString(payload, "refresh_token") ?? "",
		accessTokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
		scopes: (readString(payload, "scope") ?? "snsapi_login").split(",").filter(Boolean),
		openid,
		...(readString(payload, "unionid") ? { unionid: readString(payload, "unionid") as string } : {}),
	};
}

export type WechatUserProfile = {
	openid: string;
	unionid?: string | undefined;
	nickname?: string | undefined;
	headimgurl?: string | undefined;
};

/**
 * Reads the profile behind an access token. WeChat needs **both** the token and
 * the `openid` — unlike an RFC 6749 userinfo endpoint, which takes only the
 * token.
 */
export async function fetchWechatUserProfile(input: {
	accessToken: string;
	openid: string;
}): Promise<WechatUserProfile> {
	const url = new URL(USER_INFO_URL);
	url.searchParams.set("access_token", input.accessToken);
	url.searchParams.set("openid", input.openid);
	url.searchParams.set("lang", "zh_CN");

	const response = await fetch(url);
	if (!response.ok) {
		throw new WechatApiError(response.status, `WeChat user info endpoint returned HTTP ${response.status}`);
	}

	const payload = asRecord(await response.json());
	assertNoWechatError(payload, "WeChat profile request failed");

	return {
		openid: readString(payload, "openid") ?? input.openid,
		...(readString(payload, "unionid") ? { unionid: readString(payload, "unionid") as string } : {}),
		...(readString(payload, "nickname") ? { nickname: readString(payload, "nickname") as string } : {}),
		...(readString(payload, "headimgurl") ? { headimgurl: readString(payload, "headimgurl") as string } : {}),
	};
}
