import { describe, expect, it } from "vitest";
import { env } from "@reactive-resume/env/server";
import { auth } from "./config";

describe("social provider signup policy", () => {
	it.each(["google", "github", "linkedin"] as const)(
		"allows implicit signup through %s while honoring the global signup restriction",
		(provider) => {
			// Better Auth 1.7 allows a lazy `() => config` form; ours are always static objects.
			const config = auth.options.socialProviders?.[provider];
			if (typeof config === "function") throw new TypeError(`${provider} provider config should be a static object`);

			expect(config).not.toHaveProperty("disableImplicitSignUp");
			expect(config?.disableSignUp).toBe(env.FLAG_DISABLE_SIGNUPS);
		},
	);
});

describe("session freshness", () => {
	it("disables the freshness gate so provider unlinking works for week-old sessions", () => {
		expect(auth.options.session?.freshAge).toBe(0);
	});
});

describe("domestic provider account linking", () => {
	it("allows linking across different email addresses", () => {
		// WeChat and Alipay return no email at all, so their accounts hold a
		// placeholder one. Without this the linking branch compares it against the
		// signed-in user's real address and fails — silently, because the callback
		// only redirects with an error code.
		expect(auth.options.account?.accountLinking?.allowDifferentEmails).toBe(true);
	});

	it("trusts the two domestic providers and leaves the others as they were", () => {
		// Trusted status is what lets a provider be linked without a verified email.
		// It is granted only to the two that cannot deliver one; the compensating
		// control is the session assertion in `hooks.before` on `/link-social`.
		expect(auth.options.account?.accountLinking?.trustedProviders).toEqual([
			"google",
			"github",
			"linkedin",
			"wechat",
			"alipay",
		]);
	});
});
