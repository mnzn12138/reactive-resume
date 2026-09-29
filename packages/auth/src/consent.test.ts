import { describe, expect, it } from "vitest";
import { legalDocumentVersion } from "@reactive-resume/schema/legal";
import {
	assertLegalConsent,
	buildConsentTicket,
	channelFromCallbackPath,
	readConsentTicket,
	resolveConsentSource,
} from "./consent";

/**
 * The consent gates.
 *
 * A `user_consent` row is legal evidence, so the interesting property is not
 * "a row got written" but "a row is written **only** when the user actually
 * accepted, and an account is created **only** when a row can be written". These
 * tests pin the decision function; the other half of the invariant — that no
 * account exists without a ticket — is provided by `disableImplicitSignUp` on
 * both providers, which the provider configs assert separately.
 */

const accepted = { accepted: true as const, version: legalDocumentVersion };

describe("assertLegalConsent (G1)", () => {
	it("rejects a request with no consent at all", () => {
		// Throwing here stops the request before an authorization URL is issued, so
		// the browser never reaches WeChat and no user row can be created.
		expect(() => assertLegalConsent({})).toThrow(/must accept the privacy policy/);
		expect(() => assertLegalConsent({ legalConsent: null })).toThrow(/must accept the privacy policy/);
		expect(() => assertLegalConsent(undefined)).toThrow(/must accept the privacy policy/);
	});

	it("rejects a consent that was not actually given", () => {
		expect(() => assertLegalConsent({ legalConsent: { accepted: false, version: legalDocumentVersion } })).toThrow(
			/must accept the privacy policy/,
		);
	});

	it("rejects a stale version", () => {
		expect(() => assertLegalConsent({ legalConsent: { accepted: true, version: "2020-01-01" } })).toThrow(
			/have changed/,
		);
	});

	it("returns the consent when it matches the published version", () => {
		expect(assertLegalConsent({ legalConsent: accepted })).toEqual(accepted);
	});

	it("throws with HTTP 403 so the client sees FORBIDDEN", () => {
		expect(() => assertLegalConsent({})).toThrow(expect.objectContaining({ statusCode: 403 }) as unknown as Error);
	});
});

describe("buildConsentTicket (G2)", () => {
	it("carries the version, the channel and an issue time", () => {
		const ticket = buildConsentTicket(accepted, "wechat");

		expect(ticket).toMatchObject({ version: legalDocumentVersion, channel: "wechat" });
		expect(ticket.issuedAt).toBeGreaterThan(0);
	});
});

describe("readConsentTicket", () => {
	it("accepts a well-formed ticket", () => {
		expect(readConsentTicket({ version: legalDocumentVersion, channel: "alipay", issuedAt: 1 })).toEqual({
			version: legalDocumentVersion,
			channel: "alipay",
			issuedAt: 1,
		});
	});

	it("rejects anything that is not a ticket", () => {
		expect(readConsentTicket(undefined)).toBeNull();
		expect(readConsentTicket("legalConsent")).toBeNull();
		expect(readConsentTicket({})).toBeNull();
		expect(readConsentTicket({ version: legalDocumentVersion, channel: "google", issuedAt: 1 })).toBeNull();
		expect(readConsentTicket({ version: "old", channel: "wechat", issuedAt: 1 })).toBeNull();
		expect(readConsentTicket({ version: legalDocumentVersion, channel: "wechat" })).toBeNull();
	});
});

describe("channelFromCallbackPath", () => {
	it("recognises the two domestic callbacks only", () => {
		expect(channelFromCallbackPath("/callback/wechat")).toBe("wechat");
		expect(channelFromCallbackPath("/api/auth/callback/alipay?code=1")).toBe("alipay");
		expect(channelFromCallbackPath("/callback/google")).toBeNull();
		expect(channelFromCallbackPath("/sign-in/social")).toBeNull();
	});
});

describe("resolveConsentSource (G4)", () => {
	const ticket = buildConsentTicket(accepted, "wechat");

	it("records the channel that was used", () => {
		expect(
			resolveConsentSource({
				path: "/callback/wechat",
				serverContext: { legalConsent: ticket },
				hasNewSession: true,
			}),
		).toBe("signup-wechat");

		expect(
			resolveConsentSource({
				path: "/callback/alipay",
				serverContext: { legalConsent: buildConsentTicket(accepted, "alipay") },
				hasNewSession: true,
			}),
		).toBe("signup-alipay");
	});

	it("records nothing when the user did not accept", () => {
		// No ticket means no row at all. Paired with `disableImplicitSignUp`, the
		// callback has also refused to create the account, so there is no moment
		// where a user exists without a consent record.
		expect(
			resolveConsentSource({ path: "/callback/wechat", serverContext: undefined, hasNewSession: true }),
		).toBeNull();
	});

	it("refuses a ticket that came from the other channel", () => {
		expect(
			resolveConsentSource({
				path: "/callback/alipay",
				serverContext: { legalConsent: ticket },
				hasNewSession: true,
			}),
		).toBeNull();
	});

	/**
	 * A client can put anything it likes in the state's `additionalData`, which is
	 * echoed back on the callback. Only `serverContext` is minted by the server and
	 * encrypted, so a forged consent travelling anywhere else must be ignored.
	 */
	it("ignores a client-supplied consent that never went through serverContext", () => {
		// `additionalData` (and anything else a client can put in the state) is echoed
		// back untouched, so it must never be read as proof.
		expect(
			resolveConsentSource({
				path: "/callback/wechat",
				serverContext: undefined,
				hasNewSession: true,
			}),
		).toBeNull();

		// Same for a ticket planted one level too high: only `serverContext.legalConsent`
		// is minted by the server.
		expect(
			resolveConsentSource({ path: "/callback/wechat", serverContext: { ...ticket }, hasNewSession: true }),
		).toBeNull();
	});

	it("records nothing when no session was created", () => {
		expect(
			resolveConsentSource({
				path: "/callback/wechat",
				serverContext: { legalConsent: ticket },
				hasNewSession: false,
			}),
		).toBeNull();
	});

	it("keeps the email gate on its own path", () => {
		expect(resolveConsentSource({ path: "/sign-up/email", serverContext: undefined, hasNewSession: true })).toBe(
			"signup-email",
		);
	});

	/**
	 * The phone channel verifies a code and creates the account in the same
	 * request, so there is no OAuth state to carry a ticket — which is exactly why
	 * it must not be held to the ticket rule the callbacks use. The consent itself
	 * is checked on the request (`assertPhoneSignUpConsent`), so reaching this
	 * branch already means the user accepted.
	 */
	it("records the phone channel without a server-minted ticket", () => {
		expect(resolveConsentSource({ path: "/phone-number/verify", serverContext: undefined, hasNewSession: true })).toBe(
			"signup-phone",
		);

		expect(resolveConsentSource({ path: "/sign-in/phone-number", serverContext: undefined, hasNewSession: true })).toBe(
			"signup-phone",
		);
	});

	it("records nothing for a phone request that created no session", () => {
		// Same rule as every other channel: no session, no evidence to attribute.
		expect(
			resolveConsentSource({ path: "/phone-number/verify", serverContext: undefined, hasNewSession: false }),
		).toBeNull();
	});

	it("does not treat a phone path as an OAuth callback", () => {
		// A forged ticket must not be able to borrow the phone branch, and a phone
		// path must never fall through to the callback branch either.
		expect(
			resolveConsentSource({
				path: "/phone-number/verify",
				serverContext: { legalConsent: buildConsentTicket(accepted, "wechat") },
				hasNewSession: true,
			}),
		).toBe("signup-phone");
	});

	it("records nothing for a callback of a channel that has no gate", () => {
		expect(
			resolveConsentSource({ path: "/callback/google", serverContext: undefined, hasNewSession: true }),
		).toBeNull();
	});
});
