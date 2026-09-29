import type { AdminDiagnosticsChannel } from "../../dto/admin";
import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveMock = vi.fn();

vi.mock("@reactive-resume/auth/instance-settings", () => ({
	OVERRIDABLE_SETTING_KEYS: [
		"disableSignups",
		"disableEmailAuth",
		"disableWechatAuth",
		"disableAlipayAuth",
		"disableSmsAuth",
	],
	resolveInstanceSettings: resolveMock,
	invalidateInstanceSettings: vi.fn(),
}));

const { adminDiagnosticsService } = await import("./diagnostics-service");

/** Every switch open — the state an untouched instance is in. */
const noFlags = () => ({
	disableSignups: { key: "disableSignups", value: false, source: "default" as const },
	disableEmailAuth: { key: "disableEmailAuth", value: false, source: "default" as const },
	disableWechatAuth: { key: "disableWechatAuth", value: false, source: "default" as const },
	disableAlipayAuth: { key: "disableAlipayAuth", value: false, source: "default" as const },
	disableSmsAuth: { key: "disableSmsAuth", value: false, source: "default" as const },
});

const closedFlags = () => ({
	...noFlags(),
	disableWechatAuth: { key: "disableWechatAuth", value: true, source: "database" as const },
	disableAlipayAuth: { key: "disableAlipayAuth", value: true, source: "database" as const },
	disableSmsAuth: { key: "disableSmsAuth", value: true, source: "database" as const },
});

const FULL_ENV: Record<string, string> = {
	WECHAT_APP_ID: "wx1234567890abcdef",
	WECHAT_APP_SECRET: "0123456789abcdef0123456789abcdef",
	ALIPAY_APP_ID: "2021000000000000",
	ALIPAY_PRIVATE_KEY: "ali-private-key-value",
	ALIPAY_PUBLIC_KEY: "ali-public-key-value",
	SMS_PROVIDER: "aliyun",
	ALIYUN_ACCESS_KEY_ID: "LTAI000000000000",
	ALIYUN_ACCESS_KEY_SECRET: "aliyun-secret-value",
	ALIYUN_SMS_SIGN_NAME: "简历",
	ALIYUN_SMS_TEMPLATE_CODE: "SMS_000001",
};

const channelOf = (channels: AdminDiagnosticsChannel[], channel: AdminDiagnosticsChannel["channel"]) =>
	channels.find((entry) => entry.channel === channel);

beforeEach(() => {
	resolveMock.mockReset();
	resolveMock.mockResolvedValue(noFlags());
});

describe("get", () => {
	it("reports every channel as unconfigured when nothing is set", async () => {
		const { channels } = await adminDiagnosticsService.get({});

		expect(channels.map((entry) => entry.channel)).toEqual(["wechat", "alipay", "sms"]);
		expect(channels.every((entry) => entry.configured === false)).toBe(true);
		expect(channels.every((entry) => entry.disabledByFlag === false)).toBe(true);

		// The whole point of the screen: name the variable, not just the failure.
		expect(channelOf(channels, "wechat")?.missing).toEqual(["WECHAT_APP_ID", "WECHAT_APP_SECRET"]);
		expect(channelOf(channels, "alipay")?.missing).toEqual([
			"ALIPAY_APP_ID",
			"ALIPAY_PRIVATE_KEY",
			"ALIPAY_PUBLIC_KEY",
		]);
		expect(channelOf(channels, "sms")?.missing).toEqual(["SMS_PROVIDER"]);
	});

	it("names only the half that is missing when a channel is wired up part way", async () => {
		const { channels } = await adminDiagnosticsService.get({
			WECHAT_APP_ID: "wx1234567890abcdef",
			ALIPAY_APP_ID: "2021000000000000",
			ALIPAY_PRIVATE_KEY: "ali-private-key-value",
		});

		const wechat = channelOf(channels, "wechat");
		expect(wechat?.configured).toBe(false);
		expect(wechat?.missing).toEqual(["WECHAT_APP_SECRET"]);

		const alipay = channelOf(channels, "alipay");
		expect(alipay?.configured).toBe(false);
		// The public key is the one half that is easy to forget, and the preview
		// has to point at it by name.
		expect(alipay?.missing).toEqual(["ALIPAY_PUBLIC_KEY"]);
		expect(alipay?.preview).toContain("ALIPAY_PUBLIC_KEY");
	});

	it("keeps credentials masked — only the last four characters survive", async () => {
		const { channels } = await adminDiagnosticsService.get(FULL_ENV);

		const preview = channels.map((entry) => entry.preview).join("\n");

		expect(preview).not.toContain(FULL_ENV.WECHAT_APP_SECRET);
		expect(preview).not.toContain(FULL_ENV.ALIPAY_PRIVATE_KEY);
		expect(preview).not.toContain(FULL_ENV.ALIPAY_PUBLIC_KEY);
		expect(preview).not.toContain(FULL_ENV.ALIYUN_ACCESS_KEY_SECRET);

		// Enough to tell which key is loaded, never enough to use it.
		expect(channelOf(channels, "wechat")?.preview).toContain("cdef");
	});

	it("reports a fully configured but switched-off channel as configured and disabled", async () => {
		resolveMock.mockResolvedValue(closedFlags());

		const { channels } = await adminDiagnosticsService.get(FULL_ENV);

		// The two halves are kept apart so the console can say "nothing is wrong
		// with your credentials, someone closed this on purpose".
		expect(channels.every((entry) => entry.configured === true)).toBe(true);
		expect(channels.every((entry) => entry.disabledByFlag === true)).toBe(true);
		expect(channelOf(channels, "wechat")?.preview).toContain("FLAG_DISABLE_WECHAT_AUTH");
	});

	it("degrades to unconfigured instead of throwing when the flags cannot be read", async () => {
		// Reading the switches needs the database. Without this guard a Postgres
		// outage would turn the one screen an operator opens during an outage
		// into a 500.
		resolveMock.mockRejectedValue(new Error("ECONNREFUSED 127.0.0.1:5432"));

		const { channels } = await adminDiagnosticsService.get(FULL_ENV);

		expect(channels).toHaveLength(3);
		expect(channels.every((entry) => entry.disabledByFlag === false)).toBe(true);
		// The credentials themselves are still readable without the database, so a
		// failed flag lookup must not be reported as "not configured".
		expect(channels.every((entry) => entry.configured === true)).toBe(true);
	});
});
