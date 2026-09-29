import { APIError } from "better-auth";
import { legalConsentSchema, legalDocumentVersion } from "@reactive-resume/schema/legal";

/**
 * The consent half of the domestic sign-in channels.
 *
 * Compliance asks for *"the user accepted before the account existed"*, not for
 * a particular page. So the checkbox lives on the login page, and by the time
 * the browser leaves for WeChat or Alipay the acceptance has already been
 * turned into a server-minted ticket (`addOAuthServerContext`) that rides inside
 * the encrypted OAuth `state` and comes back on the callback. The account and
 * the `user_consent` row are then written inside that one callback request —
 * there is no window in which a user exists without a consent record, and no
 * orphan account if the user never ticks the box.
 *
 * Everything here is pure so the four gates can be unit-tested without a
 * database. `config.ts` wires them to the request pipeline.
 */

/** The channels that can create an account. `phone` is wired by the SMS channel. */
export type ConsentChannel = "wechat" | "alipay" | "phone";

/**
 * How a consent row was collected, stored verbatim on `user_consent.source`.
 *
 * Every channel shares the one table and is told apart by this value, so a
 * compliance export answers "which text did this user accept, and where" with a
 * single query. `"manual"` stays reserved for a future re-acceptance surface.
 */
export type ConsentSource = "signup-email" | "signup-phone" | "signup-wechat" | "signup-alipay" | "manual";

/** Server-minted proof that the checkbox was ticked for the current version. */
export type ConsentTicket = {
	version: string;
	channel: ConsentChannel;
	issuedAt: number;
};

/** Which provider ids this gate is responsible for. */
export function isDomesticProvider(provider: string | undefined): provider is ConsentChannel {
	return provider === "wechat" || provider === "alipay" || provider === "phone";
}

/**
 * Reads the consent payload a client posted.
 *
 * `hooks.before` runs before Better Auth validates the body, so the raw
 * `legalConsent` field is still on `ctx.body` — nothing here depends on the
 * endpoint schema keeping unknown keys.
 */
function readLegalConsent(
	body: unknown,
): { ok: true; consent: { accepted: true; version: string } } | { ok: false; reason: "missing" | "stale" } {
	const payload = (body as { legalConsent?: unknown } | undefined)?.legalConsent;
	const parsed = legalConsentSchema.safeParse(payload);

	if (!parsed.success) return { ok: false, reason: "missing" };
	if (parsed.data.version !== legalDocumentVersion) return { ok: false, reason: "stale" };

	return { ok: true, consent: parsed.data };
}

/**
 * Gate **G1**. Throws before the endpoint runs, so no authorization URL is
 * issued and — because the user never leaves the site — no user row can be
 * created.
 */
export function assertLegalConsent(body: unknown): { accepted: true; version: string } {
	const consent = readLegalConsent(body);

	if (!consent.ok && consent.reason === "stale") {
		throw new APIError("FORBIDDEN", {
			message: "The privacy policy and terms of service have changed. Please review and accept the current versions.",
		});
	}

	if (!consent.ok) {
		throw new APIError("FORBIDDEN", {
			message: "You must accept the privacy policy and terms of service to create an account.",
		});
	}

	return consent.consent;
}

/**
 * Gate **G2**. The ticket is handed to `addOAuthServerContext`, which embeds it
 * in the encrypted state — a client cannot forge it, and it expires with the
 * state (10 minutes).
 */
export function buildConsentTicket(consent: { version: string }, channel: ConsentChannel): ConsentTicket {
	return { version: consent.version, channel, issuedAt: Date.now() };
}

/**
 * Narrows an untrusted value to a ticket. Only `serverContext` is ever passed
 * here: the state's top-level keys are client-supplied and must never be read
 * as proof of consent.
 */
export function readConsentTicket(value: unknown): ConsentTicket | null {
	if (typeof value !== "object" || value === null) return null;

	const { version, channel, issuedAt } = value as Partial<ConsentTicket>;

	if (typeof version !== "string" || version !== legalDocumentVersion) return null;
	if (!isDomesticProvider(channel)) return null;
	if (typeof issuedAt !== "number" || !Number.isFinite(issuedAt)) return null;

	return { version, channel, issuedAt };
}

/** The callback path Better Auth serves for a domestic provider, if any. */
export function channelFromCallbackPath(path: string): "wechat" | "alipay" | null {
	if (path.includes("/callback/wechat")) return "wechat";
	if (path.includes("/callback/alipay")) return "alipay";
	return null;
}

function consentSourceForChannel(channel: ConsentChannel): ConsentSource {
	if (channel === "wechat") return "signup-wechat";
	if (channel === "alipay") return "signup-alipay";
	return "signup-phone";
}

/**
 * Gate **G4**. Decides whether this request may write a `user_consent` row.
 *
 * A row is legal evidence, so it is only produced when a session was actually
 * created **and** the request carries a valid server-minted ticket for the same
 * channel — with one exception: the phone channel has no redirect, so its consent
 * is validated on the request itself (see `assertPhoneSignUpConsent`) and the
 * request path is proof enough. Anything else returns `null`, which means the
 * account (if any) gets no row rather than one asserting an acceptance it cannot
 * evidence. That is the anti-orphan property: with G3 refusing to create accounts
 * that arrive without `requestSignUp`, "no ticket" can only mean "no new account
 * either".
 */
export function resolveConsentSource(input: {
	path: string;
	/** The whole `serverContext` object read back from the OAuth state. */
	serverContext: unknown;
	hasNewSession: boolean;
}): ConsentSource | null {
	if (!input.hasNewSession) return null;

	// Email sign-up is gated on its own path (see `config.ts`); it needs no ticket
	// because the consent arrives in the same request that creates the account.
	if (input.path.includes("/sign-up/email")) return "signup-email";

	/**
	 * The phone channel is the mirror image of the callbacks below: verifying a
	 * code is what creates the account, and it happens in the same request that
	 * carries the checkbox — there is no redirect and therefore no state to mint a
	 * ticket into. So this branch deliberately does **not** ask for one; the
	 * consent itself is checked up front by `assertPhoneSignUpConsent` in
	 * `config.ts`, and all that is left to decide here is how to attribute the row.
	 *
	 * `/sign-in/phone-number` is listed too so a future password-based phone
	 * sign-in records the same source without another edit.
	 */
	if (input.path.includes("/phone-number/verify") || input.path.includes("/sign-in/phone-number")) {
		return "signup-phone";
	}

	const channel = channelFromCallbackPath(input.path);
	if (!channel) return null;

	// Only the `serverContext` sub-object of the OAuth state is server-minted; the
	// caller passes it whole so the trusted key can be named here rather than at
	// every call site.
	const serverContext =
		typeof input.serverContext === "object" && input.serverContext !== null
			? (input.serverContext as { legalConsent?: unknown }).legalConsent
			: undefined;

	const ticket = readConsentTicket(serverContext);
	if (!ticket || ticket.channel !== channel) return null;

	return consentSourceForChannel(channel);
}
