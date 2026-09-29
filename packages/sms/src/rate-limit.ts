import type { SmsErrorCode, SmsSendResult, SmsVendor } from "./types";
import { SmsError } from "./errors";

/**
 * Rate limiting that covers the blind spot of the better-auth `phoneNumber` plugin.
 *
 * The plugin ships a built-in rule for `/phone-number/*` only (60s / 10 requests per window), which
 * misses `/sign-in/phone-number` and does not express "10 per phone per day" or "20 per IP per hour".
 * Those three rules live here and are driven from a `hooks.before` handler in `packages/auth`.
 *
 * Counting is done over `sms_send_log`, which keeps only HMAC hashes of the phone number and the
 * request IP (see `phone.ts`) — the table doubles as the P-9 audit trail.
 */

export type SmsRateLimitPolicy = {
	/** 同一号码两次发送之间的最小间隔(秒)。 */
	cooldownSeconds: number;
	/** 同一号码每个自然日的发送上限。 */
	dailyPerPhone: number;
	/** 同一 IP 每小时的发送上限。 */
	hourlyPerIp: number;
};

export const DEFAULT_SMS_RATE_LIMIT_POLICY: SmsRateLimitPolicy = {
	cooldownSeconds: 60,
	dailyPerPhone: 10,
	hourlyPerIp: 20,
};

export type SmsRateLimitRule = "cooldown" | "daily-phone" | "hourly-ip";

export type SmsRateLimitDecision =
	| { allowed: true }
	| { allowed: false; rule: SmsRateLimitRule; message: string; retryAfterSeconds: number };

/** One row of `sms_send_log`. Column names follow the schema in `packages/db`. */
export type SmsSendLogEntry = {
	phoneHash: string;
	ipHash: string | undefined;
	vendor: SmsVendor | undefined;
	/** 'ok' 或 {@link SmsErrorCode}。 */
	resultCode: string;
	vendorCode: string | undefined;
	createdAt: Date;
};

/**
 * Read side of `sms_send_log`. Implemented against Drizzle by the auth package; this package ships
 * an in-memory implementation so the rules can be exercised without a database.
 */
export interface SmsSendLogStore {
	/** 计数:`phoneHash` 与 `ipHash` 至少提供一个,同时提供时按 AND 计算。 */
	countSince(filter: { phoneHash?: string; ipHash?: string }, since: Date): Promise<number>;
	/** 该号码最近一次发送时间,用于 60s 冷却。 */
	lastSentAt(phoneHash: string): Promise<Date | undefined>;
}

export interface SmsSendLogWriter {
	record(entry: SmsSendLogEntry): Promise<void>;
}

export type InMemorySmsSendLogStore = SmsSendLogStore &
	SmsSendLogWriter & {
		entries: SmsSendLogEntry[];
		reset(): void;
	};

export const createInMemorySmsSendLogStore = (): InMemorySmsSendLogStore => {
	const entries: SmsSendLogEntry[] = [];

	return {
		entries,
		reset: () => {
			entries.length = 0;
		},
		countSince: (filter, since) =>
			Promise.resolve(
				entries.filter((entry) => {
					if (entry.createdAt < since) return false;
					if (filter.phoneHash !== undefined && entry.phoneHash !== filter.phoneHash) return false;
					if (filter.ipHash !== undefined && entry.ipHash !== filter.ipHash) return false;

					return filter.phoneHash !== undefined || filter.ipHash !== undefined;
				}).length,
			),
		lastSentAt: (phoneHash) => {
			let latest: Date | undefined;

			for (const entry of entries) {
				if (entry.phoneHash !== phoneHash) continue;
				if (latest === undefined || entry.createdAt > latest) latest = entry.createdAt;
			}

			return Promise.resolve(latest);
		},
		record: (entry) => {
			entries.push(entry);

			return Promise.resolve();
		},
	};
};

export const startOfUtcDay = (date: Date): Date =>
	new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

export const startOfHour = (date: Date): Date =>
	new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours()));

const secondsUntil = (target: Date, now: Date): number =>
	Math.max(1, Math.ceil((target.getTime() - now.getTime()) / 1000));

export type SmsRateLimitInput = {
	phoneHash: string;
	ipHash?: string | undefined;
	policy?: SmsRateLimitPolicy;
	now?: Date;
};

/**
 * Evaluates the three rules in order (cooldown → per-phone daily → per-IP hourly) and stops at the
 * first hit, so the message tells the user exactly what to wait for.
 */
export const checkSmsRateLimit = async (
	store: SmsSendLogStore,
	input: SmsRateLimitInput,
): Promise<SmsRateLimitDecision> => {
	const policy = input.policy ?? DEFAULT_SMS_RATE_LIMIT_POLICY;
	const now = input.now ?? new Date();

	const lastSentAt = await store.lastSentAt(input.phoneHash);

	if (lastSentAt !== undefined) {
		const elapsedSeconds = Math.floor((now.getTime() - lastSentAt.getTime()) / 1000);

		if (elapsedSeconds < policy.cooldownSeconds) {
			const retryAfterSeconds = policy.cooldownSeconds - elapsedSeconds;

			return {
				allowed: false,
				rule: "cooldown",
				message: `验证码发送过于频繁,请 ${retryAfterSeconds} 秒后再试。`,
				retryAfterSeconds,
			};
		}
	}

	const sentToday = await store.countSince({ phoneHash: input.phoneHash }, startOfUtcDay(now));

	if (sentToday >= policy.dailyPerPhone) {
		const retryAfterSeconds = secondsUntil(new Date(startOfUtcDay(now).getTime() + 24 * 60 * 60 * 1000), now);

		return {
			allowed: false,
			rule: "daily-phone",
			message: `该手机号今日验证码短信已达上限(${policy.dailyPerPhone} 条),请明天再试。`,
			retryAfterSeconds,
		};
	}

	if (input.ipHash !== undefined) {
		const sentThisHour = await store.countSince({ ipHash: input.ipHash }, startOfHour(now));

		if (sentThisHour >= policy.hourlyPerIp) {
			const retryAfterSeconds = secondsUntil(new Date(startOfHour(now).getTime() + 60 * 60 * 1000), now);

			return {
				allowed: false,
				rule: "hourly-ip",
				message: `当前网络发送验证码过于频繁,请 ${Math.ceil(retryAfterSeconds / 60)} 分钟后再试。`,
				retryAfterSeconds,
			};
		}
	}

	return { allowed: true };
};

/**
 * Throwing variant for the `hooks.before` handler: better-auth turns a thrown `APIError` into a
 * 4xx response, and the hook maps this `SmsError` onto one with the message below.
 */
export const assertSmsRateLimit = async (store: SmsSendLogStore, input: SmsRateLimitInput): Promise<void> => {
	const decision = await checkSmsRateLimit(store, input);

	if (decision.allowed) return;

	throw new SmsError({ code: "RATE_LIMITED", vendorCode: decision.rule, message: decision.message });
};

/** Builds the audit row for a completed send attempt. */
export const buildSmsSendLogEntry = (input: {
	phoneHash: string;
	ipHash: string | undefined;
	vendor: SmsVendor | undefined;
	result: SmsSendResult;
	createdAt: Date;
}): SmsSendLogEntry => ({
	phoneHash: input.phoneHash,
	ipHash: input.ipHash,
	vendor: input.vendor,
	resultCode: input.result.ok ? "ok" : input.result.code,
	vendorCode: input.result.ok ? undefined : input.result.vendorCode,
	createdAt: input.createdAt,
});
