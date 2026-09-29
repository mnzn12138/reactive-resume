import type { SmsSendLogStore, SmsSendLogWriter } from "@reactive-resume/sms/rate-limit";
import type { SmsDriver, SmsSendResult } from "@reactive-resume/sms/types";
import type { PhoneNumberOptions } from "better-auth/plugins/phone-number";
import { APIError } from "better-auth";
import { env } from "@reactive-resume/env/server";
import { getSmsDriver, resolveSmsConfig } from "@reactive-resume/sms/drivers";
import { isSmsError, toSmsFailure } from "@reactive-resume/sms/errors";
import { hashIpAddress, hashPhoneNumber, maskPhoneNumber, normalizePhoneNumber } from "@reactive-resume/sms/phone";
import { assertSmsRateLimit, buildSmsSendLogEntry } from "@reactive-resume/sms/rate-limit";
import { TRUSTED_IP_HEADERS } from "@reactive-resume/utils/rate-limit";
import { smsSendLogStore } from "./sms-log-store";

/**
 * The `phoneNumber` plugin's `sendOTP` callback, plus everything it needs to run.
 *
 * Three things are decided here rather than in `config.ts`:
 *
 *  - **Normalisation.** Vendors want E.164, users type whatever they like, and
 *    the rest of the stack (the rate-limit buckets, the temp email, the audit
 *    log) has to agree on one spelling — so `normalizePhoneNumber` runs once,
 *    here, and everything downstream sees `+8613800138000`.
 *  - **Rate limiting.** The plugin's built-in rule only matches paths starting
 *    with `/phone-number` and only counts requests, so it misses
 *    `/sign-in/phone-number` entirely and cannot express "per number per day" or
 *    "per IP per hour". Those live in `@reactive-resume/sms/rate-limit` and are
 *    asserted before anything is sent.
 *  - **Degradation.** Without corporate credentials there is no vendor to talk
 *    to. `getSmsDriver()` then returns `undefined` and this module fails the
 *    request with a generic message instead of crashing, so an instance that has
 *    not qualified for an SMS signature still boots and still serves every other
 *    sign-in channel.
 *
 * Every collaborator is injectable. The rules are the interesting logic and they
 * must be exercisable without a Postgres instance, so the tests pass an in-memory
 * log store and a fake driver.
 */

const OTP_LENGTH = 6;
const OTP_TTL_SECONDS = 300;
const OTP_MAX_ATTEMPTS = 3;

/**
 * Shown for every failure the user cannot act on. Deliberately identical for
 * "not configured" and "vendor rejected it": the vendor's own code goes to the
 * server log only, because it is deployment detail, and for some vendors a hint
 * about which numbers are registered.
 */
const GENERIC_SEND_FAILURE = "Failed to send the verification code. Please try again later.";

const INVALID_PHONE_NUMBER = "Invalid phone number.";

/** Store plus writer: the rate limiter counts, this module records. */
type SmsSendLog = SmsSendLogStore & SmsSendLogWriter;

export type SmsOtpDependencies = {
	/** Defaults to the Drizzle-backed `sms_send_log`. */
	store?: SmsSendLog | undefined;
	/** Defaults to `getSmsDriver()`. */
	driver?: SmsDriver | undefined;
	/** Defaults to `() => new Date()`. */
	now?: (() => Date) | undefined;
};

export type SmsDelivery =
	/** The vendor accepted the message. */
	| { status: "sent"; result: SmsSendResult }
	/** The vendor refused it (`result.ok === false`), or the driver threw. */
	| { status: "failed"; result: SmsSendResult }
	/** `normalizePhoneNumber` could not make sense of the input. */
	| { status: "invalid-phone-number" }
	/** No vendor credentials in the environment. */
	| { status: "not-configured" }
	/** One of the `sms_send_log` windows is full. */
	| { status: "rate-limited"; message: string };

export type SmsDeliveryInput = {
	/** Anything `normalizePhoneNumber` accepts. */
	phoneNumber: string;
	code: string;
	/** Already resolved by the caller; `undefined` skips the per-IP rule. */
	ipAddress?: string | undefined;
	dependencies?: SmsOtpDependencies;
};

/** Pulls a `Headers` out of a better-auth endpoint context, a request, or a bare `Headers`. */
const pickHeaders = (value: unknown): Headers | undefined => {
	if (value instanceof Headers) return value;
	if (typeof value !== "object" || value === null) return undefined;

	const record = value as { headers?: unknown };

	return pickHeaders(record.headers);
};

/**
 * The client IP, read from the same header list the rest of the instance trusts
 * (`advanced.ipAddress` in `config.ts`). The two have to agree — otherwise the
 * per-IP bucket and the `ipAddress` stored on the session describe different
 * clients and neither log is trustworthy.
 *
 * Better Auth only resolves an IP for an existing session, and `sendOTP` runs
 * before any session exists, so the headers are read straight off the context.
 * Returns `undefined` when nothing usable is present (a direct connection, or a
 * proxy that forwarded no header), which simply skips the per-IP rule.
 */
export function resolveRequestIp(source: unknown): string | undefined {
	const headers =
		source instanceof Headers
			? source
			: (pickHeaders((source as { request?: unknown } | null)?.request) ?? pickHeaders(source));

	if (headers === undefined) return undefined;

	for (const name of TRUSTED_IP_HEADERS) {
		const value = headers.get(name);
		if (value === null || value.trim() === "") continue;

		// `X-Forwarded-For` is a chain; the left-most entry is the client that
		// connected to the outermost proxy we trust.
		const first = value.split(",")[0]?.trim();

		if (first !== undefined && first !== "") return first;
	}

	return undefined;
}

/**
 * The placeholder address a phone sign-up is created with.
 *
 * `.invalid` is reserved by RFC 2606 and can never resolve, so the address is
 * unroutable by construction — a "reset your password" mail can never leave the
 * instance for one. Uniqueness follows from the column it is derived from: the
 * digits are the E.164 number minus its `+`, `user.phone_number` is unique, and
 * `user.email` is unique, so the mapping is injective and two numbers can never
 * land on the same placeholder.
 */
export const buildTempEmail = (phoneNumber: string): string => {
	const normalized = normalizePhoneNumber(phoneNumber) ?? phoneNumber;

	return `${normalized.replace(/\D/g, "")}@phone.invalid`;
};

/**
 * Normalises, rate-limits, sends, and records — in that order. Returns a
 * structured outcome instead of throwing so that both callers can choose their
 * own transport error: `sendOTP` needs better-auth `APIError`s, the admin
 * console needs oRPC ones.
 *
 * The windows in `assertSmsRateLimit` are checked before the send and the row is
 * written after it, so there is a round trip in which a burst of concurrent
 * requests can all pass the check. Closing it would mean a transaction around a
 * network call; instead the vendor's own throttling is what catches that case,
 * and the row written afterwards is what makes the *next* attempt countable.
 */
export async function deliverSmsCode(input: SmsDeliveryInput): Promise<SmsDelivery> {
	const store = input.dependencies?.store ?? smsSendLogStore;
	const now = input.dependencies?.now ?? (() => new Date());
	const driver = input.dependencies?.driver ?? getSmsDriver();

	const e164 = normalizePhoneNumber(input.phoneNumber);
	if (e164 === undefined) return { status: "invalid-phone-number" };

	if (driver === undefined) {
		// Logged, never surfaced: naming the missing environment variable to a
		// browser would hand an attacker the deployment's configuration state.
		const resolution = resolveSmsConfig();

		console.error("[auth][sms] no SMS driver configured; refusing to send a verification code", {
			vendor: resolution.vendor,
			missing: resolution.missing,
		});

		return { status: "not-configured" };
	}

	// `AUTH_SECRET` doubles as the HMAC pepper: it is per-instance and never
	// leaves the process, so the hashes in `sms_send_log` are not replayable
	// against another deployment's log.
	const pepper = env.AUTH_SECRET;
	const sentAt = now();
	const phoneHash = hashPhoneNumber(e164, pepper);
	const ipHash = hashIpAddress(input.ipAddress, pepper);

	try {
		await assertSmsRateLimit(store, { phoneHash, ipHash, now: sentAt });
	} catch (error) {
		if (!isSmsError(error)) throw error;

		return { status: "rate-limited", message: error.message };
	}

	let result: SmsSendResult;

	try {
		result = await driver.send({ phoneNumber: e164, templateParams: { code: input.code } });
	} catch (error) {
		// Drivers return vendor failures rather than throwing, but a network fault
		// still can — and the row below is what makes the next attempt countable,
		// so it has to be written either way.
		result = toSmsFailure(error);
	}

	await store.record(
		buildSmsSendLogEntry({
			phoneHash,
			ipHash,
			vendor: driver.vendor,
			result,
			createdAt: sentAt,
		}),
	);

	if (!result.ok) {
		console.error("[auth][sms] the vendor rejected the verification code", {
			vendor: driver.vendor,
			resultCode: result.code,
			vendorCode: result.vendorCode,
		});

		return { status: "failed", result };
	}

	return { status: "sent", result };
}

/**
 * Builds the options for `phoneNumber(...)`.
 *
 * `dependencies` exists so the suite can run the rules against an in-memory log
 * and a fake driver; production leaves it empty and gets Postgres plus whatever
 * vendor the environment describes.
 */
export function createSmsOtpOptions(dependencies: SmsOtpDependencies = {}): PhoneNumberOptions {
	const store = dependencies.store ?? smsSendLogStore;
	const now = dependencies.now ?? (() => new Date());

	// Resolved per call rather than once: `getSmsDriver()` caches internally but
	// still has to be consulted lazily, because reading it at import time would
	// make a misconfigured environment throw while `config.ts` is being loaded.
	const resolveDriver = (): SmsDriver | undefined => dependencies.driver ?? getSmsDriver();

	return {
		otpLength: OTP_LENGTH,
		expiresIn: OTP_TTL_SECONDS,
		allowedAttempts: OTP_MAX_ATTEMPTS,

		phoneNumberValidator: (value) => normalizePhoneNumber(value) !== undefined,

		signUpOnVerification: {
			getTempEmail: (phoneNumber) => buildTempEmail(phoneNumber),
			// Masked rather than the number itself: the name is what the UI shows
			// in the avatar menu and on shared resumes (隐私要求 P-9).
			getTempName: (phoneNumber) => maskPhoneNumber(phoneNumber),
		},

		sendOTP: async ({ phoneNumber, code }, ctx) => {
			const delivery = await deliverSmsCode({
				phoneNumber,
				code,
				ipAddress: resolveRequestIp(ctx),
				dependencies: { store, driver: resolveDriver(), now },
			});

			if (delivery.status === "invalid-phone-number") {
				throw new APIError("BAD_REQUEST", { message: INVALID_PHONE_NUMBER });
			}

			if (delivery.status === "not-configured") {
				throw new APIError("BAD_REQUEST", { message: GENERIC_SEND_FAILURE });
			}

			if (delivery.status === "rate-limited") {
				// The message is `@reactive-resume/sms`'s own wording and already
				// carries the concrete wait ("请 42 秒后再试"). Passing it through
				// verbatim is deliberate: the number is the only thing the user can
				// act on, and restating the policy here would let the two drift.
				throw new APIError("TOO_MANY_REQUESTS", { message: delivery.message });
			}

			if (delivery.status === "failed") {
				throw new APIError("BAD_REQUEST", { message: GENERIC_SEND_FAILURE });
			}
		},
	};
}
