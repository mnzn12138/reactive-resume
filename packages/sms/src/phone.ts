import { createHmac } from "node:crypto";

/**
 * Phone number handling for the SMS channel.
 *
 * Two rules drive this module:
 *  - Vendors want E.164, users type whatever they like, so normalisation happens here (and only
 *    here) before a number reaches a driver.
 *  - The rate-limit log must never store a plaintext number (设计文档 §3.3 / P-9), so callers work
 *    with an HMAC of the number rather than the number itself.
 */

/** E.164:`+` 加 7~15 位数字,首位非 0。 */
const E164_PATTERN = /^\+[1-9]\d{6,14}$/;

const SEPARATORS = /[\s\-()]/g;

/**
 * Normalises a user-supplied number to E.164.
 *
 * Accepts `13800138000`(默认补 +86)、`8613800138000`、`008613800138000`、`+8613800138000`
 * 以及任意国家码的 `+xx...` 号码。无法识别时返回 `undefined`,由调用方决定报错还是跳过。
 */
export const normalizePhoneNumber = (input: string): string | undefined => {
	if (typeof input !== "string") return undefined;

	const cleaned = input.replace(SEPARATORS, "");
	if (cleaned === "") return undefined;

	let candidate = cleaned;

	if (!candidate.startsWith("+")) {
		if (candidate.startsWith("00")) {
			candidate = `+${candidate.slice(2)}`;
		} else if (/^86\d{11}$/.test(candidate)) {
			candidate = `+${candidate}`;
		} else if (/^1[3-9]\d{9}$/.test(candidate)) {
			candidate = `+86${candidate}`;
		} else {
			candidate = `+${candidate}`;
		}
	}

	return E164_PATTERN.test(candidate) ? candidate : undefined;
};

/**
 * Renders a number safe for UI display, e.g. `+8613800138000` → `138****8000`.
 * Unrecognised input degrades to `***` instead of throwing.
 */
export const maskPhoneNumber = (phoneNumber: string): string => {
	const normalized = normalizePhoneNumber(phoneNumber);
	if (!normalized) return "***";

	const national = normalized.startsWith("+86") && normalized.length === 14 ? normalized.slice(3) : normalized.slice(1);
	if (national.length < 8) return "***";

	return `${national.slice(0, 3)}****${national.slice(-4)}`;
};

const hashIdentifier = (pepper: string, scope: string, value: string): string => {
	if (pepper === "") {
		throw new Error("hashIdentifier requires a non-empty pepper (use AUTH_SECRET) so hashes are not reversible.");
	}

	return createHmac("sha256", pepper).update(`${scope}:${value}`, "utf8").digest("hex");
};

/**
 * Stable key for `sms_send_log.phone_hash`. Normalisation happens first so `13800138000` and
 * `+8613800138000` collapse to the same bucket.
 */
export const hashPhoneNumber = (phoneNumber: string, pepper: string): string =>
	hashIdentifier(pepper, "sms.phone", normalizePhoneNumber(phoneNumber) ?? phoneNumber.trim());

/**
 * Stable key for `sms_send_log.ip_hash`. Returns `undefined` when the request IP is unknown
 * (the column is nullable) — an unknown IP simply skips the per-IP rule.
 */
export const hashIpAddress = (ipAddress: string | undefined, pepper: string): string | undefined => {
	if (ipAddress === undefined) return undefined;

	const normalized = ipAddress.trim().toLowerCase();
	if (normalized === "") return undefined;

	// `::ffff:203.0.113.7` 这类 IPv4-mapped 地址收敛到 IPv4 文本,避免同一来源被算成两个。
	const collapsed = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(normalized)?.[1] ?? normalized;

	return hashIdentifier(pepper, "sms.ip", collapsed);
};
