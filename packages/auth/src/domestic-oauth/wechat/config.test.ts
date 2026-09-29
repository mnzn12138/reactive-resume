import { describe, expect, it } from "vitest";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { createWechatOAuthConfig, resolveWechatSubject } from "./config";

/**
 * Builds the authorization URL the way the real plugin does, by running
 * `genericOAuth`'s own init and asking the provider it produced.
 *
 * These assertions exist because WeChat's authorization endpoint fails without
 * warning when the URL is subtly wrong, and there is no way to find that out
 * without an approved app — so the shape is locked here instead.
 */
async function buildAuthorizationUrl(redirectURI: string): Promise<URL> {
	const plugin = genericOAuth({
		config: [
			createWechatOAuthConfig({
				clientId: "wx-client-id",
				clientSecret: "wx-client-secret",
				redirectURI,
				appUrl: "https://resume.example.com",
			}),
		],
	});

	const fakeContext = {
		// Only `logger` and `socialProviders` are touched while a provider without a
		// discovery URL is registered.
		logger: { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} },
		socialProviders: [],
		baseURL: "https://resume.example.com",
	};

	const { context } = await plugin.init(fakeContext as unknown as Parameters<typeof plugin.init>[0]);
	const provider = context.socialProviders.find((candidate) => candidate.id === "wechat");

	if (!provider) throw new Error("the WeChat provider was not registered");

	return await provider.createAuthorizationURL({
		state: "state-value",
		codeVerifier: "code-verifier-value",
		redirectURI,
	});
}

describe("createWechatOAuthConfig", () => {
	it("disables PKCE and refuses to create an account unless the server asked for one", () => {
		const config = createWechatOAuthConfig({
			clientId: "wx-client-id",
			clientSecret: "wx-client-secret",
			redirectURI: "https://resume.example.com/api/auth/callback/wechat",
		});

		expect(config.pkce).toBe(false);
		expect(config.disableImplicitSignUp).toBe(true);
		expect(config.scopes).toEqual(["snsapi_login"]);
	});

	it("keeps #wechat_redirect as a fragment and never moves it into the query", async () => {
		const url = await buildAuthorizationUrl("https://resume.example.com/api/auth/callback/wechat");

		expect(url.hash).toBe("#wechat_redirect");
		expect(url.toString().endsWith("#wechat_redirect")).toBe(true);
		// A `#` inside the query would mean the fragment had been escaped or appended
		// to a parameter, and WeChat would reject the request.
		expect(url.search.includes("#")).toBe(false);
		expect(url.pathname).toBe("/connect/qrconnect");
	});

	it("omits the PKCE parameters even though the framework generated a verifier", async () => {
		const url = await buildAuthorizationUrl("https://resume.example.com/api/auth/callback/wechat");
		const query = url.searchParams;

		expect(query.has("code_challenge")).toBe(false);
		expect(query.has("code_challenge_method")).toBe(false);
		expect(url.toString()).not.toContain("code_challenge");
	});

	it("keeps the scope, which authorizationUrlParams would silently drop", async () => {
		const url = await buildAuthorizationUrl("https://resume.example.com/api/auth/callback/wechat");

		expect(url.searchParams.get("scope")).toBe("snsapi_login");
	});

	/**
	 * UNVERIFIED ASSUMPTION: WeChat needs `appid`, while the framework always
	 * writes `client_id`. Both are sent and we assume WeChat ignores the extra
	 * one — the same assumption the design document records. It cannot be
	 * confirmed without an approved app.
	 */
	it("sends appid and client_id together", async () => {
		const url = await buildAuthorizationUrl("https://resume.example.com/api/auth/callback/wechat");

		expect(url.searchParams.get("appid")).toBe("wx-client-id");
		expect(url.searchParams.get("client_id")).toBe("wx-client-id");
		expect(url.searchParams.get("redirect_uri")).toBe("https://resume.example.com/api/auth/callback/wechat");
		expect(url.searchParams.get("response_type")).toBe("code");
	});
});

describe("resolveWechatSubject", () => {
	it("prefers unionid and falls back to openid", () => {
		expect(resolveWechatSubject({ unionid: "union-1", openid: "open-1" })).toBe("union-1");
		expect(resolveWechatSubject({ openid: "open-1" })).toBe("open-1");
	});

	it("refuses a profile with neither identifier", () => {
		expect(() => resolveWechatSubject({})).toThrow(/unionid and openid/);
	});
});
