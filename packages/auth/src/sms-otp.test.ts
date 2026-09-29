import type { SmsSendInput, SmsSendResult } from "@reactive-resume/sms/types";
import type { PhoneNumberOptions } from "better-auth/plugins/phone-number";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createInMemorySmsSendLogStore } from "@reactive-resume/sms/rate-limit";
import { createSmsOtpOptions, resolveRequestIp } from "./sms-otp";

/**
 * The SMS half of `sendOTP`, with the two collaborators swapped out.
 *
 * The rules exercised here are the ones the `phoneNumber` plugin does not cover
 * (60s cooldown, 10 per number per day, 20 per IP per hour) plus the two
 * behaviours that decide whether an unconfigured instance stays up: a missing
 * vendor is a clean failure with no log row, and a vendor refusal is a clean
 * failure *with* one.
 *
 * Nothing here touches Postgres — the log is the in-memory implementation that
 * ships with `@reactive-resume/sms`, and the driver is a stub.
 */

/** A clock the tests drive by hand, so the policy windows can be walked through. */
const createClock = (start = Date.UTC(2026, 0, 1, 0, 0, 0)) => {
	let current = start;

	return {
		now: () => new Date(current),
		advance: (seconds: number) => {
			current += seconds * 1000;
		},
	};
};

type FakeDriver = {
	vendor: "aliyun";
	calls: SmsSendInput[];
	send: (input: SmsSendInput) => Promise<SmsSendResult>;
	describe: () => { vendor: "aliyun"; configured: true; missing: string[]; preview: string };
};

const createFakeDriver = (send?: (input: SmsSendInput) => Promise<SmsSendResult>): FakeDriver => {
	const calls: SmsSendInput[] = [];

	return {
		vendor: "aliyun",
		calls,
		send: (input) => {
			calls.push(input);

			return send ? send(input) : Promise.resolve({ ok: true, vendorMessageId: "biz-1", vendorRequestId: "req-1" });
		},
		describe: () => ({ vendor: "aliyun", configured: true, missing: [], preview: "aliyun" }),
	};
};

/** A stand-in for a better-auth endpoint context. Only the headers are read. */
const contextWithIp = (ip: string) => ({ headers: new Headers({ "X-Real-IP": ip }) }) as never;

const sendCode = (options: PhoneNumberOptions, phoneNumber: string, ctx?: unknown) =>
	options.sendOTP({ phoneNumber, code: "123456" }, ctx as never);

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("sendOTP", () => {
	it("normalises a mainland number to E.164 before it reaches the driver", async () => {
		const store = createInMemorySmsSendLogStore();
		const driver = createFakeDriver();
		const options = createSmsOtpOptions({ store, driver, now: createClock().now });

		await sendCode(options, "13800138000");

		// The vendor only accepts E.164, and everything downstream — the rate-limit
		// bucket, the temp email, the audit row — has to agree on one spelling.
		expect(driver.calls).toHaveLength(1);
		expect(driver.calls[0]?.phoneNumber).toBe("+8613800138000");
		expect(driver.calls[0]?.templateParams).toEqual({ code: "123456" });
	});

	it("rejects a number it cannot normalise", async () => {
		const store = createInMemorySmsSendLogStore();
		const driver = createFakeDriver();
		const options = createSmsOtpOptions({ store, driver, now: createClock().now });

		await expect(sendCode(options, "not-a-number")).rejects.toMatchObject({
			statusCode: 400,
			message: "Invalid phone number.",
		});

		expect(driver.calls).toHaveLength(0);
		expect(store.entries).toHaveLength(0);
	});

	it("validates numbers the same way the driver will receive them", () => {
		const options = createSmsOtpOptions({ store: createInMemorySmsSendLogStore(), driver: createFakeDriver() });

		expect(options.phoneNumberValidator?.("13800138000")).toBe(true);
		expect(options.phoneNumberValidator?.("+8613800138000")).toBe(true);
		expect(options.phoneNumberValidator?.("123")).toBe(false);
		expect(options.phoneNumberValidator?.("")).toBe(false);
	});

	/**
	 * Without corporate credentials there is no vendor to talk to. The point of
	 * this case is that the instance stays up: the request fails with a message
	 * the user can read, nothing is written to the log, and the environment is
	 * never described back to the browser.
	 */
	it("refuses to send when no vendor is configured, and writes nothing to the log", async () => {
		vi.stubEnv("SMS_PROVIDER", "");

		const store = createInMemorySmsSendLogStore();
		const options = createSmsOtpOptions({ store, now: createClock().now });

		await expect(sendCode(options, "13800138000")).rejects.toMatchObject({
			statusCode: 400,
			message: "Failed to send the verification code. Please try again later.",
		});

		expect(store.entries).toHaveLength(0);
	});

	it("rejects a second code inside the 60s cooldown, with the wait in the message", async () => {
		const store = createInMemorySmsSendLogStore();
		const driver = createFakeDriver();
		const clock = createClock();
		const options = createSmsOtpOptions({ store, driver, now: clock.now });

		await sendCode(options, "13800138000");

		clock.advance(30);

		await expect(sendCode(options, "13800138000")).rejects.toMatchObject({
			statusCode: 429,
			message: expect.stringContaining("30 秒"),
		});

		// Rejected before the send, so the vendor is never called twice.
		expect(driver.calls).toHaveLength(1);
		expect(store.entries).toHaveLength(1);
	});

	it("allows a second code once the cooldown has elapsed", async () => {
		const store = createInMemorySmsSendLogStore();
		const driver = createFakeDriver();
		const clock = createClock();
		const options = createSmsOtpOptions({ store, driver, now: clock.now });

		await sendCode(options, "13800138000");

		clock.advance(60);

		await expect(sendCode(options, "13800138000")).resolves.toBeUndefined();
		expect(driver.calls).toHaveLength(2);
	});

	it("stops at 10 codes per number per day", async () => {
		const store = createInMemorySmsSendLogStore();
		const driver = createFakeDriver();
		const clock = createClock();
		const options = createSmsOtpOptions({ store, driver, now: clock.now });

		for (let attempt = 0; attempt < 10; attempt += 1) {
			await sendCode(options, "13800138000");
			clock.advance(61);
		}

		expect(store.entries).toHaveLength(10);

		await expect(sendCode(options, "13800138000")).rejects.toMatchObject({
			statusCode: 429,
			message: expect.stringContaining("今日验证码短信已达上限(10 条)"),
		});

		expect(store.entries).toHaveLength(10);
	});

	it("stops at 20 codes per IP per hour", async () => {
		const store = createInMemorySmsSendLogStore();
		const driver = createFakeDriver();
		const clock = createClock();
		const options = createSmsOtpOptions({ store, driver, now: clock.now });

		// Twenty different numbers from one address: the per-number rules never
		// fire, so only the per-IP window can reject the twenty-first.
		for (let attempt = 0; attempt < 20; attempt += 1) {
			await sendCode(options, `+8613800138${String(attempt).padStart(3, "0")}`, contextWithIp("1.2.3.4"));
			clock.advance(61);
		}

		expect(store.entries).toHaveLength(20);

		await expect(sendCode(options, "+8613800138020", contextWithIp("1.2.3.4"))).rejects.toMatchObject({
			statusCode: 429,
		});

		expect(store.entries).toHaveLength(20);
	});

	/**
	 * A failure still costs a slot. If the row were skipped, aiming at numbers the
	 * vendor rejects would make both the daily and the hourly window free.
	 */
	it("records a row even when the vendor refuses the message", async () => {
		const store = createInMemorySmsSendLogStore();
		const driver = createFakeDriver(() =>
			Promise.resolve({
				ok: false,
				code: "TEMPLATE_ILLEGAL",
				vendorCode: "isv.SMS_TEMPLATE_ILLEGAL",
				message: "模板不合法",
			}),
		);
		const options = createSmsOtpOptions({ store, driver, now: createClock().now });

		await expect(sendCode(options, "13800138000")).rejects.toMatchObject({
			statusCode: 400,
			message: "Failed to send the verification code. Please try again later.",
		});

		expect(store.entries).toHaveLength(1);
		expect(store.entries[0]).toMatchObject({
			vendor: "aliyun",
			resultCode: "TEMPLATE_ILLEGAL",
			vendorCode: "isv.SMS_TEMPLATE_ILLEGAL",
		});
	});

	it("collapses ::ffff:1.2.3.4 and 1.2.3.4 into one IP bucket", async () => {
		const store = createInMemorySmsSendLogStore();
		const driver = createFakeDriver();
		const clock = createClock();
		const options = createSmsOtpOptions({ store, driver, now: clock.now });

		await sendCode(options, "+8613800138000", contextWithIp("::ffff:1.2.3.4"));
		clock.advance(61);
		await sendCode(options, "+8613800138001", contextWithIp("1.2.3.4"));

		const ipHashes = new Set(store.entries.map((entry) => entry.ipHash));

		// Two different textual addresses, one client: if these landed in separate
		// buckets the per-IP limit would be trivially doubled.
		expect(store.entries).toHaveLength(2);
		expect(ipHashes.size).toBe(1);
	});
});

describe("resolveRequestIp", () => {
	it("reads the first trusted header that carries a value", () => {
		expect(resolveRequestIp({ headers: new Headers({ "X-Real-IP": "1.2.3.4" }) })).toBe("1.2.3.4");
		expect(resolveRequestIp(new Headers({ "CF-Connecting-IP": "5.6.7.8" }))).toBe("5.6.7.8");
	});

	it("takes the left-most hop of an X-Forwarded-For chain", () => {
		expect(resolveRequestIp({ headers: new Headers({ "X-Forwarded-For": "1.2.3.4, 10.0.0.1" }) })).toBe("1.2.3.4");
	});

	it("returns undefined when nothing usable is present", () => {
		expect(resolveRequestIp(undefined)).toBeUndefined();
		expect(resolveRequestIp({ headers: new Headers() })).toBeUndefined();
		expect(resolveRequestIp({ request: { headers: new Headers() } })).toBeUndefined();
	});
});

describe("signUpOnVerification", () => {
	const options = createSmsOtpOptions({ store: createInMemorySmsSendLogStore(), driver: createFakeDriver() });

	/**
	 * `.invalid` is reserved by RFC 2606, so the placeholder can never receive
	 * mail. The digits are the whole E.164 number minus its `+`, which makes the
	 * address as unique as `user.phone_number` is.
	 */
	it("derives an unroutable placeholder email from the digits", () => {
		expect(options.signUpOnVerification?.getTempEmail("13800138000")).toBe("8613800138000@phone.invalid");
		expect(options.signUpOnVerification?.getTempEmail("+8613800138000")).toBe("8613800138000@phone.invalid");
	});

	/** The name is shown in the UI, so it carries the masked number (P-9). */
	it("uses the masked number as the display name", () => {
		expect(options.signUpOnVerification?.getTempName?.("13800138000")).toBe("138****8000");
		expect(options.signUpOnVerification?.getTempName?.("+8613800138000")).toBe("138****8000");
	});
});
