import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createAlipayOAuthConfig } from "./config";
import {
	buildAlipaySignContent,
	extractAlipayResponseContent,
	formatAlipayTimestamp,
	rsa2Sign,
	rsa2Verify,
} from "./signature";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
	modulusLength: 2048,
	publicKeyEncoding: { type: "spki", format: "pem" },
	privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

/** Alipay's key generator hands out bare base64 with no PEM armour. */
const bareKey = (pem: string) => pem.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");

describe("buildAlipaySignContent", () => {
	it("sorts by ASCII key and joins as key=value", () => {
		const content = buildAlipaySignContent({
			version: "1.0",
			app_id: "2021000000000000",
			method: "alipay.system.oauth.token",
		});

		expect(content).toBe("app_id=2021000000000000&method=alipay.system.oauth.token&version=1.0");
	});

	it("drops sign and empty values but keeps sign_type", () => {
		// Alipay's own documentation shows `sign_type` inside the pre-sign string, so
		// it must survive while `sign` never does.
		const content = buildAlipaySignContent({
			sign_type: "RSA2",
			sign: "should-not-appear",
			empty: "",
			missing: undefined,
			biz_content: "{}",
		});

		expect(content).toBe("biz_content={}&sign_type=RSA2");
		expect(content).not.toContain("sign=should-not-appear");
	});
});

describe("rsa2 signing", () => {
	it("signs with a PEM key and verifies with the matching public key", () => {
		const content = "app_id=2021000000000000&method=alipay.system.oauth.token&sign_type=RSA2";
		const sign = rsa2Sign(content, privateKey);

		expect(sign).toMatch(/^[A-Za-z0-9+/=]+$/);
		expect(rsa2Verify({ content, sign, publicKey })).toBe(true);
	});

	it("accepts the bare base64 key form Alipay's generator emits", () => {
		const content = "biz_content={}&sign_type=RSA2";
		const sign = rsa2Sign(content, bareKey(privateKey));

		expect(rsa2Verify({ content, sign, publicKey: bareKey(publicKey) })).toBe(true);
	});

	it("rejects a signature over different content", () => {
		const sign = rsa2Sign('biz_content={"a":1}&sign_type=RSA2', privateKey);

		expect(rsa2Verify({ content: 'biz_content={"a":2}&sign_type=RSA2', sign, publicKey })).toBe(false);
	});

	it("rejects a signature made with a different key", () => {
		const other = generateKeyPairSync("rsa", {
			modulusLength: 2048,
			publicKeyEncoding: { type: "spki", format: "pem" },
			privateKeyEncoding: { type: "pkcs8", format: "pem" },
		});

		const content = "app_id=1&sign_type=RSA2";
		const sign = rsa2Sign(content, other.privateKey);

		expect(rsa2Verify({ content, sign, publicKey })).toBe(false);
	});

	it("throws on a private key that is not usable", () => {
		expect(() => rsa2Sign("content", "not-a-key")).toThrow(/not a usable RSA private key/);
	});
});

describe("extractAlipayResponseContent", () => {
	it("cuts the raw payload out of an envelope", () => {
		const raw = '{"alipay_system_oauth_token_response":{"access_token":"t","user_id":"2088"},"sign":"abc"}';

		expect(extractAlipayResponseContent(raw, "alipay_system_oauth_token_response")).toBe(
			'{"access_token":"t","user_id":"2088"}',
		);
	});

	it("is not fooled by braces inside a string value", () => {
		// A naive `indexOf("}")` would stop at the brace inside the string.
		const raw = '{"alipay_user_info_share_response":{"nick_name":"a}b","user_id":"2088"},"sign":"abc"}';

		expect(extractAlipayResponseContent(raw, "alipay_user_info_share_response")).toBe(
			'{"nick_name":"a}b","user_id":"2088"}',
		);
	});

	it("returns null when the key or payload is missing", () => {
		expect(extractAlipayResponseContent('{"sign":"abc"}', "alipay_system_oauth_token_response")).toBeNull();
		expect(
			extractAlipayResponseContent(
				'{"alipay_system_oauth_token_response":"nope"}',
				"alipay_system_oauth_token_response",
			),
		).toBeNull();
	});
});

describe("formatAlipayTimestamp", () => {
	it("formats Beijing time, which has no daylight saving", () => {
		// 2026-09-29T00:30:00Z is 08:30 the same day in Beijing.
		expect(formatAlipayTimestamp(new Date("2026-09-29T00:30:00Z"))).toBe("2026-09-29 08:30:00");
	});
});

describe("createAlipayOAuthConfig", () => {
	it("registers a non-PKCE provider that will not create accounts implicitly", () => {
		const config = createAlipayOAuthConfig({
			appId: "2021000000000000",
			privateKey: "unused-for-this-assertion",
			alipayPublicKey: "unused-for-this-assertion",
			redirectURI: "https://resume.example.com/api/auth/callback/alipay",
		});

		expect(config.providerId).toBe("alipay");
		expect(config.pkce).toBe(false);
		expect(config.scopes).toEqual(["auth_user"]);
		expect(config.disableImplicitSignUp).toBe(true);
		expect(config.authorizationUrlParams).toEqual({ app_id: "2021000000000000" });
	});
});
