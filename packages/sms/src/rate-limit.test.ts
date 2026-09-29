import { describe, expect, it } from "vitest";
import { SmsError } from "./errors";
import {
	assertSmsRateLimit,
	buildSmsSendLogEntry,
	checkSmsRateLimit,
	createInMemorySmsSendLogStore,
	DEFAULT_SMS_RATE_LIMIT_POLICY,
	startOfHour,
	startOfUtcDay,
} from "./rate-limit";

const NO_COOLDOWN = { ...DEFAULT_SMS_RATE_LIMIT_POLICY, cooldownSeconds: 0 } as const;

const BASE = new Date("2026-09-28T12:00:00.000Z");
const at = (offsetSeconds: number): Date => new Date(BASE.getTime() + offsetSeconds * 1000);

const PHONE_A = "a".repeat(64);
const PHONE_B = "b".repeat(64);
const IP_A = "c".repeat(64);

const record = async (
	store: ReturnType<typeof createInMemorySmsSendLogStore>,
	options: { phoneHash: string; ipHash?: string; createdAt?: Date },
): Promise<void> => {
	await store.record({
		phoneHash: options.phoneHash,
		ipHash: options.ipHash,
		vendor: "aliyun",
		resultCode: "ok",
		vendorCode: undefined,
		createdAt: options.createdAt ?? BASE,
	});
};

describe("默认策略", () => {
	it("60s 冷却 / 单号每日 10 条 / 单 IP 每小时 20 条", () => {
		expect(DEFAULT_SMS_RATE_LIMIT_POLICY).toEqual({ cooldownSeconds: 60, dailyPerPhone: 10, hourlyPerIp: 20 });
	});
});

describe("单号 60s 冷却", () => {
	it("冷却窗口内拒绝,并给出剩余秒数", async () => {
		const store = createInMemorySmsSendLogStore();
		await record(store, { phoneHash: PHONE_A, ipHash: IP_A });

		const decision = await checkSmsRateLimit(store, { phoneHash: PHONE_A, ipHash: IP_A, now: at(59) });

		expect(decision.allowed).toBe(false);
		if (decision.allowed) return;
		expect(decision.rule).toBe("cooldown");
		expect(decision.retryAfterSeconds).toBe(1);
		expect(decision.message).toContain("请 1 秒后再试");
	});

	it("刚好满 60s 放行", async () => {
		const store = createInMemorySmsSendLogStore();
		await record(store, { phoneHash: PHONE_A, ipHash: IP_A });

		expect(await checkSmsRateLimit(store, { phoneHash: PHONE_A, ipHash: IP_A, now: at(60) })).toEqual({
			allowed: true,
		});
	});

	it("不同号码互不影响", async () => {
		const store = createInMemorySmsSendLogStore();
		await record(store, { phoneHash: PHONE_A, ipHash: IP_A });

		expect(await checkSmsRateLimit(store, { phoneHash: PHONE_B, ipHash: IP_A, now: at(10) })).toEqual({
			allowed: true,
		});
	});
});

describe("单号每日 10 条", () => {
	it("第 10 条仍放行,第 11 条拒绝", async () => {
		const store = createInMemorySmsSendLogStore();

		for (let index = 0; index < 9; index += 1) {
			await record(store, { phoneHash: PHONE_A, ipHash: IP_A, createdAt: at(index) });
		}

		expect(
			await checkSmsRateLimit(store, { phoneHash: PHONE_A, ipHash: IP_A, policy: NO_COOLDOWN, now: at(10) }),
		).toEqual({ allowed: true });

		await record(store, { phoneHash: PHONE_A, ipHash: IP_A, createdAt: at(10) });

		const decision = await checkSmsRateLimit(store, {
			phoneHash: PHONE_A,
			ipHash: IP_A,
			policy: NO_COOLDOWN,
			now: at(11),
		});

		expect(decision.allowed).toBe(false);
		if (decision.allowed) return;
		expect(decision.rule).toBe("daily-phone");
		expect(decision.message).toContain("已达上限(10 条)");
	});

	it("跨自然日重新计数", async () => {
		const store = createInMemorySmsSendLogStore();

		for (let index = 0; index < 10; index += 1) {
			await record(store, { phoneHash: PHONE_A, ipHash: IP_A, createdAt: at(index) });
		}

		const nextDay = new Date(startOfUtcDay(BASE).getTime() + 24 * 60 * 60 * 1000);

		expect(
			await checkSmsRateLimit(store, { phoneHash: PHONE_A, ipHash: IP_A, policy: NO_COOLDOWN, now: nextDay }),
		).toEqual({ allowed: true });
	});
});

describe("单 IP 每小时 20 条", () => {
	it("同一小时内第 21 条拒绝", async () => {
		const store = createInMemorySmsSendLogStore();

		for (let index = 0; index < 20; index += 1) {
			await record(store, { phoneHash: `phone-${index}`, ipHash: IP_A, createdAt: at(index) });
		}

		const decision = await checkSmsRateLimit(store, {
			phoneHash: PHONE_B,
			ipHash: IP_A,
			policy: NO_COOLDOWN,
			now: at(21),
		});

		expect(decision.allowed).toBe(false);
		if (decision.allowed) return;
		expect(decision.rule).toBe("hourly-ip");
		expect(decision.message).toContain("过于频繁");
	});

	it("换一个小时后重新计数", async () => {
		const store = createInMemorySmsSendLogStore();

		for (let index = 0; index < 20; index += 1) {
			await record(store, { phoneHash: `phone-${index}`, ipHash: IP_A, createdAt: at(index) });
		}

		const nextHour = new Date(startOfHour(BASE).getTime() + 60 * 60 * 1000);

		expect(
			await checkSmsRateLimit(store, { phoneHash: PHONE_B, ipHash: IP_A, policy: NO_COOLDOWN, now: nextHour }),
		).toEqual({ allowed: true });
	});

	it("IP 未知时跳过该规则", async () => {
		const store = createInMemorySmsSendLogStore();

		for (let index = 0; index < 20; index += 1) {
			await record(store, { phoneHash: `phone-${index}`, ipHash: IP_A, createdAt: at(index) });
		}

		expect(await checkSmsRateLimit(store, { phoneHash: PHONE_B, policy: NO_COOLDOWN, now: at(21) })).toEqual({
			allowed: true,
		});
	});
});

describe("assertSmsRateLimit", () => {
	it("放行时不抛错", async () => {
		const store = createInMemorySmsSendLogStore();

		await expect(assertSmsRateLimit(store, { phoneHash: PHONE_A, ipHash: IP_A, now: BASE })).resolves.toBeUndefined();
	});

	it("超限时抛出带 RATE_LIMITED 的 SmsError", async () => {
		const store = createInMemorySmsSendLogStore();
		await record(store, { phoneHash: PHONE_A, ipHash: IP_A });

		await expect(assertSmsRateLimit(store, { phoneHash: PHONE_A, ipHash: IP_A, now: at(5) })).rejects.toBeInstanceOf(
			SmsError,
		);

		await assertSmsRateLimit(store, { phoneHash: PHONE_A, ipHash: IP_A, now: at(5) }).catch((error: unknown) => {
			expect(error).toBeInstanceOf(SmsError);
			if (!(error instanceof SmsError)) return;
			expect(error.code).toBe("RATE_LIMITED");
			expect(error.vendorCode).toBe("cooldown");
			expect(error.message).toContain("请 55 秒后再试");
		});
	});
});

describe("buildSmsSendLogEntry", () => {
	it("成功时记录 ok 且不带厂商码", () => {
		const entry = buildSmsSendLogEntry({
			phoneHash: PHONE_A,
			ipHash: IP_A,
			vendor: "aliyun",
			result: { ok: true, vendorMessageId: "biz", vendorRequestId: "req" },
			createdAt: BASE,
		});

		expect(entry).toEqual({
			phoneHash: PHONE_A,
			ipHash: IP_A,
			vendor: "aliyun",
			resultCode: "ok",
			vendorCode: undefined,
			createdAt: BASE,
		});
	});

	it("失败时记录分类与厂商原始码", () => {
		const entry = buildSmsSendLogEntry({
			phoneHash: PHONE_A,
			ipHash: undefined,
			vendor: "tencent",
			result: { ok: false, code: "RATE_LIMITED", vendorCode: "LimitExceeded.DeliveryFrequencyLimit", message: "x" },
			createdAt: BASE,
		});

		expect(entry.resultCode).toBe("RATE_LIMITED");
		expect(entry.vendorCode).toBe("LimitExceeded.DeliveryFrequencyLimit");
		expect(entry.ipHash).toBeUndefined();
	});
});

describe("startOfUtcDay / startOfHour", () => {
	it("按 UTC 截断,不受本地时区影响", () => {
		expect(startOfUtcDay(new Date("2026-09-28T23:59:59.000Z")).toISOString()).toBe("2026-09-28T00:00:00.000Z");
		expect(startOfHour(new Date("2026-09-28T12:34:56.000Z")).toISOString()).toBe("2026-09-28T12:00:00.000Z");
	});
});

describe("createInMemorySmsSendLogStore", () => {
	it("同时给出 phoneHash 与 ipHash 时按 AND 计数", async () => {
		const store = createInMemorySmsSendLogStore();

		await record(store, { phoneHash: PHONE_A, ipHash: IP_A });
		await record(store, { phoneHash: PHONE_A, ipHash: "other-ip" });
		await record(store, { phoneHash: PHONE_B, ipHash: IP_A });

		expect(await store.countSince({ phoneHash: PHONE_A }, startOfUtcDay(BASE))).toBe(2);
		expect(await store.countSince({ ipHash: IP_A }, startOfUtcDay(BASE))).toBe(2);
		expect(await store.countSince({ phoneHash: PHONE_A, ipHash: IP_A }, startOfUtcDay(BASE))).toBe(1);
		expect(await store.countSince({}, startOfUtcDay(BASE))).toBe(0);
	});

	it("reset 清空计数", async () => {
		const store = createInMemorySmsSendLogStore();
		await record(store, { phoneHash: PHONE_A, ipHash: IP_A });

		store.reset();

		expect(store.entries).toHaveLength(0);
	});
});
