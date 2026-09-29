import { inArray } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import { instanceSetting } from "@reactive-resume/db/schema";
import { env } from "@reactive-resume/env/server";

/**
 * Runtime overrides for instance-wide feature flags.
 *
 * Effective value resolves as **DB row > environment variable > built-in
 * default**, so an instance whose admin has never touched these behaves exactly
 * as it did before this table existed. That backwards compatibility is the
 * whole point: a self-hosted deployment must not silently change behaviour on
 * upgrade.
 *
 * This lives in `packages/auth` rather than `packages/api` because Better Auth
 * itself has to consult it (see `config.ts`): hiding the signup button in the
 * web app is presentation, not enforcement.
 */

/**
 * Flags an administrator is allowed to override at runtime. `smtpEnabled` is derived, never stored.
 *
 * The last three gate the domestic (China) channels. A provider stays registered
 * in Better Auth whether or not its credentials are present — provider config is
 * frozen at boot — so these switches are what actually close the endpoints.
 *
 * The `recruitment*` keys gate the campus recruitment board. Note the polarity: they
 * are stated positively (`…Enabled`) while the auth switches above are stated as
 * `disable…`, because "board off / submissions off / review on" is the conservative
 * default and reading `recruitmentBoardEnabled: false` in the console is unambiguous.
 */
export const OVERRIDABLE_SETTING_KEYS = [
	"disableSignups",
	"disableEmailAuth",
	"disableWechatAuth",
	"disableAlipayAuth",
	"disableSmsAuth",
	"recruitmentBoardEnabled",
	"recruitmentSubmissionEnabled",
	"recruitmentRequireReview",
] as const;

export type OverridableSettingKey = (typeof OVERRIDABLE_SETTING_KEYS)[number];

/** Where the effective value came from, so the console can explain itself instead of guessing. */
export type SettingSource = "database" | "environment" | "default";

export type ResolvedSetting = {
	key: OverridableSettingKey;
	value: boolean;
	source: SettingSource;
};

export type ResolvedInstanceSettings = Record<OverridableSettingKey, ResolvedSetting>;

/** Mirrors the values Better Auth falls back to when nothing is configured. */
const DEFAULTS: Record<OverridableSettingKey, boolean> = {
	disableSignups: false,
	disableEmailAuth: false,
	disableWechatAuth: false,
	disableAlipayAuth: false,
	disableSmsAuth: false,
	// The board starts off: an instance that never opted in must not grow a public,
	// user-submitted job board just because it upgraded.
	recruitmentBoardEnabled: false,
	recruitmentSubmissionEnabled: false,
	recruitmentRequireReview: true,
};

const ENV_VALUES: Record<OverridableSettingKey, () => boolean> = {
	disableSignups: () => env.FLAG_DISABLE_SIGNUPS,
	disableEmailAuth: () => env.FLAG_DISABLE_EMAIL_AUTH,
	disableWechatAuth: () => env.FLAG_DISABLE_WECHAT_AUTH,
	disableAlipayAuth: () => env.FLAG_DISABLE_ALIPAY_AUTH,
	disableSmsAuth: () => env.FLAG_DISABLE_SMS_AUTH,
	recruitmentBoardEnabled: () => env.FLAG_RECRUITMENT_BOARD_ENABLED,
	recruitmentSubmissionEnabled: () => env.FLAG_RECRUITMENT_SUBMISSION_ENABLED,
	recruitmentRequireReview: () => env.FLAG_RECRUITMENT_REQUIRE_REVIEW,
};

const ENV_NAMES: Record<OverridableSettingKey, string> = {
	disableSignups: "FLAG_DISABLE_SIGNUPS",
	disableEmailAuth: "FLAG_DISABLE_EMAIL_AUTH",
	disableWechatAuth: "FLAG_DISABLE_WECHAT_AUTH",
	disableAlipayAuth: "FLAG_DISABLE_ALIPAY_AUTH",
	disableSmsAuth: "FLAG_DISABLE_SMS_AUTH",
	recruitmentBoardEnabled: "FLAG_RECRUITMENT_BOARD_ENABLED",
	recruitmentSubmissionEnabled: "FLAG_RECRUITMENT_SUBMISSION_ENABLED",
	recruitmentRequireReview: "FLAG_RECRUITMENT_REQUIRE_REVIEW",
};

const isKey = (value: string): value is OverridableSettingKey =>
	(OVERRIDABLE_SETTING_KEYS as readonly string[]).includes(value);

/**
 * Whether the variable is actually present in the environment.
 *
 * `packages/env` parses with `emptyStringAsUndefined`, so an empty string counts
 * as "not provided" here too — otherwise `FLAG_DISABLE_SIGNUPS=` would be
 * reported as an explicit environment value.
 */
const isEnvProvided = (key: OverridableSettingKey) => {
	const raw = process.env[ENV_NAMES[key]];
	return raw !== undefined && raw !== "";
};

/**
 * Short-lived cache in front of the settings table.
 *
 * `flags.get` runs on every page navigation (it feeds the router context), so a
 * query per call would be wasteful for a value that changes a few times in an
 * instance's lifetime. Writes invalidate the cache in the process that made
 * them; other replicas pick the change up within the TTL.
 */
const CACHE_TTL_MS = 5_000;

let cache: { value: ResolvedInstanceSettings; expiresAt: number } | undefined;

/** Drop the cached settings. Called by the admin write path right after a commit. */
export function invalidateInstanceSettings() {
	cache = undefined;
}

async function readOverrides(): Promise<Partial<Record<OverridableSettingKey, boolean>>> {
	try {
		const rows = await db
			.select({ key: instanceSetting.key, value: instanceSetting.value })
			.from(instanceSetting)
			.where(inArray(instanceSetting.key, [...OVERRIDABLE_SETTING_KEYS]));

		const overrides: Partial<Record<OverridableSettingKey, boolean>> = {};
		for (const row of rows) {
			// Rows written by a newer version, or a corrupted value, must not be
			// allowed to break sign-in.
			if (!isKey(row.key) || typeof row.value !== "boolean") continue;
			overrides[row.key] = row.value;
		}

		return overrides;
	} catch (error) {
		// Fail towards today's behaviour rather than locking everyone out of the
		// instance because one query failed. Not cached, so the next call retries.
		console.error("[instance-settings] falling back to environment values", error);
		return {};
	}
}

export async function resolveInstanceSettings(): Promise<ResolvedInstanceSettings> {
	if (cache && cache.expiresAt > Date.now()) return cache.value;

	const overrides = await readOverrides();
	const resolved = {} as ResolvedInstanceSettings;

	for (const key of OVERRIDABLE_SETTING_KEYS) {
		const override = overrides[key];
		if (override !== undefined) {
			resolved[key] = { key, value: override, source: "database" };
		} else if (isEnvProvided(key)) {
			resolved[key] = { key, value: ENV_VALUES[key](), source: "environment" };
		} else {
			resolved[key] = { key, value: DEFAULTS[key], source: "default" };
		}
	}

	cache = { value: resolved, expiresAt: Date.now() + CACHE_TTL_MS };
	return resolved;
}

/** Whether new accounts may be created at all. Consulted by Better Auth, not just the UI. */
export async function isSignupDisabled() {
	return (await resolveInstanceSettings()).disableSignups.value;
}

/** Whether email + password authentication is available. Consulted by Better Auth, not just the UI. */
export async function isEmailAuthDisabled() {
	return (await resolveInstanceSettings()).disableEmailAuth.value;
}

/** Whether WeChat QR sign-in is available. Consulted by Better Auth, not just the UI. */
export async function isWechatAuthDisabled() {
	return (await resolveInstanceSettings()).disableWechatAuth.value;
}

/** Whether Alipay QR sign-in is available. Consulted by Better Auth, not just the UI. */
export async function isAlipayAuthDisabled() {
	return (await resolveInstanceSettings()).disableAlipayAuth.value;
}

/** Whether phone number + SMS code sign-in is available. Consulted by Better Auth, not just the UI. */
export async function isSmsAuthDisabled() {
	return (await resolveInstanceSettings()).disableSmsAuth.value;
}

/**
 * Whether the campus recruitment board exists at all.
 *
 * When this is false the public endpoints answer **404, not 403** — a 403 would confirm
 * that the board exists and is merely closed.
 */
export async function isRecruitmentBoardEnabled() {
	return (await resolveInstanceSettings()).recruitmentBoardEnabled.value;
}

/** Whether ordinary users may submit posts; when false only an administrator can enter them. */
export async function isRecruitmentSubmissionEnabled() {
	return (await resolveInstanceSettings()).recruitmentSubmissionEnabled.value;
}

/** Whether a user submission has to be approved before it becomes publicly visible. */
export async function isRecruitmentReviewRequired() {
	return (await resolveInstanceSettings()).recruitmentRequireReview.value;
}
