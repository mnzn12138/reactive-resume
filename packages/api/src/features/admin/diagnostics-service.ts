import type { AdminDiagnosticsChannel, AdminDiagnosticsChannelId } from "../../dto/admin";
import { resolveInstanceSettings } from "@reactive-resume/auth/instance-settings";
import { describeSms } from "@reactive-resume/sms/drivers";
import { maskSecret } from "@reactive-resume/sms/mask";

/**
 * Read-only diagnostics for the three China-facing sign-in channels: WeChat QR,
 * Alipay QR, and phone number + SMS code.
 *
 * Two rules shape everything below.
 *
 * 1. **A credential must never leave this file in full.** Every value that goes
 *    into `preview` is passed through {@link maskSecret}, so the console can
 *    confirm *which* key is loaded (last four characters) without ever handing
 *    an operator, a screenshot or a log line the real thing. The same rule
 *    already governs the SMS package, which is why the masker is imported from
 *    there rather than reimplemented with slightly different behaviour.
 *
 * 2. **Diagnostics never throw.** This screen is the thing an administrator
 *    opens when something is already broken; a stack trace instead of a channel
 *    list would be the least useful possible answer. Every read is guarded and
 *    degrades to `configured: false` with a `preview` that says why.
 *
 * The service is read-only by construction: no handler here writes, sends, or
 * mutates anything. `sms.sendTest` is the deliberate exception in this area and
 * lives with the SMS router because it is an action, not a diagnosis.
 */

/** Where the environment is read from. Injectable so tests do not have to mutate `process.env`. */
export type DiagnosticsEnvSource = Readonly<Record<string, string | undefined>>;

/** Credentials WeChat QR sign-in needs. Mirrors what `packages/auth` registers the plugin with. */
const WECHAT_ENV_KEYS = {
	appId: "WECHAT_APP_ID",
	appSecret: "WECHAT_APP_SECRET",
} as const;

/** Credentials Alipay QR sign-in needs. Alipay takes a key *pair* rather than a shared secret. */
const ALIPAY_ENV_KEYS = {
	appId: "ALIPAY_APP_ID",
	privateKey: "ALIPAY_PRIVATE_KEY",
	publicKey: "ALIPAY_PUBLIC_KEY",
} as const;

/**
 * The environment variable behind each channel's runtime switch, quoted in the
 * `preview` so an operator who has never opened this console still gets a
 * pointer to where the value came from.
 */
const FLAG_ENV_NAMES: Record<AdminDiagnosticsChannelId, string> = {
	wechat: "FLAG_DISABLE_WECHAT_AUTH",
	alipay: "FLAG_DISABLE_ALIPAY_AUTH",
	sms: "FLAG_DISABLE_SMS_AUTH",
};

const CHANNEL_LABELS: Record<AdminDiagnosticsChannelId, string> = {
	wechat: "微信扫码登录",
	alipay: "支付宝扫码登录",
	sms: "手机号 + 短信验证码登录",
};

/** Flag values to assume when the settings table cannot be read (see `resolveChannelFlags`). */
const FLAGS_FALLBACK: Record<AdminDiagnosticsChannelId, boolean> = {
	wechat: false,
	alipay: false,
	sms: false,
};

/**
 * `packages/env` treats an empty string as "not provided", and the SMS package
 * trims before testing for emptiness; diagnostics have to agree, otherwise a
 * variable exported as `WECHAT_APP_ID=` would be reported as configured.
 */
const read = (source: DiagnosticsEnvSource, key: string): string => (source[key] ?? "").trim();

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * One line naming the channel, whether it is usable, and every variable that is
 * present — masked, always masked.
 */
function buildPreview(input: {
	label: string;
	keys: readonly string[];
	source: DiagnosticsEnvSource;
	missing: readonly string[];
}): string {
	const present = input.keys
		.filter((key) => !input.missing.includes(key))
		.map((key) => `${key} ${maskSecret(read(input.source, key))}`);

	if (input.missing.length === 0) return `${input.label} · 已启用 · ${present.join("、")}`;

	// Naming what *is* set matters as much as naming what is not: "只配了一半"
	// is the common failure, and seeing which half is there tells the operator
	// whether they edited the right .env file.
	const alreadySet = present.length > 0 ? ` · 已配置 ${present.join("、")}` : "";

	return `${input.label} · 未启用 · 缺少 ${input.missing.join("、")}${alreadySet}`;
}

/** Appends the "closed on purpose" note. A wired-up but switched-off channel is a real state. */
const noteFlag = (preview: string, disabledByFlag: boolean, flagEnvName: string): string =>
	disabledByFlag ? `${preview} · 已被开关关闭(${flagEnvName},或本页的同名设置)` : preview;

/** What to report when reading the environment itself blew up. */
const failurePreview = (label: string, keys: readonly string[], error: unknown): string =>
	`${label} · 未启用 · 读取配置失败:${messageOf(error)};请检查 ${keys.join("、")}`;

/** WeChat and Alipay differ only in which variables they need, so they share one implementation. */
function describeCredentialChannel(input: {
	channel: Extract<AdminDiagnosticsChannelId, "wechat" | "alipay">;
	keys: readonly string[];
	source: DiagnosticsEnvSource;
	disabledByFlag: boolean;
}): AdminDiagnosticsChannel {
	const label = CHANNEL_LABELS[input.channel];

	try {
		const missing = input.keys.filter((key) => read(input.source, key) === "");

		return {
			channel: input.channel,
			configured: missing.length === 0,
			missing,
			preview: noteFlag(
				buildPreview({ label, keys: input.keys, source: input.source, missing }),
				input.disabledByFlag,
				FLAG_ENV_NAMES[input.channel],
			),
			disabledByFlag: input.disabledByFlag,
		};
	} catch (error) {
		// Reading `process.env` cannot realistically throw, but the contract is
		// "never throw", and an environment proxy that does throw must not take
		// the whole diagnostics screen down with it.
		return {
			channel: input.channel,
			configured: false,
			missing: [...input.keys],
			preview: failurePreview(label, input.keys, error),
			disabledByFlag: input.disabledByFlag,
		};
	}
}

/**
 * SMS delegates to the package's own `describeSms`, which already applies the
 * "三项齐全才启用" rule and already masks. Re-deriving the vendor here would
 * only create a second place for that rule to drift.
 */
function describeSmsChannel(input: { source: DiagnosticsEnvSource; disabledByFlag: boolean }): AdminDiagnosticsChannel {
	const label = CHANNEL_LABELS.sms;

	try {
		const diagnostics = describeSms(input.source);

		return {
			channel: "sms",
			configured: diagnostics.configured,
			missing: [...diagnostics.missing],
			preview: noteFlag(diagnostics.preview, input.disabledByFlag, FLAG_ENV_NAMES.sms),
			disabledByFlag: input.disabledByFlag,
		};
	} catch (error) {
		return {
			channel: "sms",
			configured: false,
			missing: ["SMS_PROVIDER"],
			preview: failurePreview(label, ["SMS_PROVIDER"], error),
			disabledByFlag: input.disabledByFlag,
		};
	}
}

/**
 * Runtime switches, resolved DB > environment > default (see
 * `@reactive-resume/auth/instance-settings`).
 *
 * Fail-open: a channel whose switch cannot be read is reported as *not* closed.
 * Nothing here enforces anything — `hooks.before` in Better Auth does that — so
 * over-reporting "closed" would only mislead the operator reading this screen.
 */
async function resolveChannelFlags(): Promise<Record<AdminDiagnosticsChannelId, boolean>> {
	try {
		const settings = await resolveInstanceSettings();

		return {
			wechat: settings.disableWechatAuth.value,
			alipay: settings.disableAlipayAuth.value,
			sms: settings.disableSmsAuth.value,
		};
	} catch (error) {
		console.error("[admin/diagnostics] falling back to no runtime overrides", error);
		return { ...FLAGS_FALLBACK };
	}
}

/** The three channels, in a fixed order so the console layout never shifts. */
async function get(source: DiagnosticsEnvSource = process.env) {
	const flags = await resolveChannelFlags();

	return {
		channels: [
			describeCredentialChannel({
				channel: "wechat",
				keys: Object.values(WECHAT_ENV_KEYS),
				source,
				disabledByFlag: flags.wechat,
			}),
			describeCredentialChannel({
				channel: "alipay",
				keys: Object.values(ALIPAY_ENV_KEYS),
				source,
				disabledByFlag: flags.alipay,
			}),
			describeSmsChannel({ source, disabledByFlag: flags.sms }),
		],
	};
}

export const adminDiagnosticsService = { get };
