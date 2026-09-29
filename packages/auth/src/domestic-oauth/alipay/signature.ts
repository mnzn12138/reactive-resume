import { createSign, createVerify } from "node:crypto";

/**
 * Alipay RSA2 (SHA256withRSA) signing and response verification.
 *
 * Two rules matter and both are easy to get wrong:
 *
 * 1. The **request** sign content is every request parameter except `sign` (and
 *    empty values), sorted by ASCII key, joined as `key=value&…`. Note that
 *    `sign_type` **is** part of it — Alipay's own documentation shows
 *    `…&sign_type=RSA2&…` inside the pre-sign string.
 * 2. The **response** sign covers the raw JSON text of the
 *    `<method>_response` value, *not* a re-serialised object. Re-encoding
 *    changes key order and whitespace and produces a string that never matches,
 *    so the substring is cut out of the body as received.
 *
 * Verification is never optional here: an unsigned or badly signed response is
 * rejected. There is deliberately no "skip verification while developing"
 * switch — a gateway response decides whether an account gets created.
 */

/** Alipay expects `yyyy-MM-dd HH:mm:ss` in Beijing time, which has no DST. */
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

export function formatAlipayTimestamp(date: Date = new Date()): string {
	const beijing = new Date(date.getTime() + BEIJING_OFFSET_MS).toISOString();
	return `${beijing.slice(0, 10)} ${beijing.slice(11, 19)}`;
}

/**
 * Builds the pre-sign string.
 *
 * @param params - Request parameters. `sign`, empty strings and `undefined` are dropped.
 */
export function buildAlipaySignContent(params: Record<string, string | undefined>): string {
	return Object.keys(params)
		.filter((key) => key !== "sign" && params[key] !== undefined && params[key] !== "")
		.sort()
		.map((key) => `${key}=${params[key]}`)
		.join("&");
}

/**
 * Wraps a bare base64 key in PEM armour.
 *
 * Alipay's key generator emits raw base64 without headers, and both PKCS#8
 * (`BEGIN PRIVATE KEY`) and PKCS#1 (`BEGIN RSA PRIVATE KEY`) occur in the wild.
 * Rather than guessing once, every candidate label is tried until one loads.
 */
function toPemVariants(key: string, labels: readonly string[]): string[] {
	const trimmed = key.trim().replace(/\s+/g, "");
	if (trimmed.startsWith("-----BEGIN")) return [key.trim()];

	const body = trimmed.replace(/-----[A-Z ]+-----/g, "");
	const chunked = body.match(/.{1,64}/g)?.join("\n") ?? body;

	return labels.map((label) => `-----BEGIN ${label}-----\n${chunked}\n-----END ${label}-----`);
}

const PRIVATE_KEY_LABELS = ["PRIVATE KEY", "RSA PRIVATE KEY"] as const;
const PUBLIC_KEY_LABELS = ["PUBLIC KEY", "RSA PUBLIC KEY"] as const;

/** Signs a string with the application private key. Result is base64, as Alipay expects. */
export function rsa2Sign(content: string, privateKey: string): string {
	for (const pem of toPemVariants(privateKey, PRIVATE_KEY_LABELS)) {
		try {
			return createSign("RSA-SHA256").update(content, "utf8").sign(pem, "base64");
		} catch {
			// Try the next container format.
		}
	}

	throw new Error("ALIPAY_PRIVATE_KEY is not a usable RSA private key");
}

/** Whether `sign` is a valid RSA2 signature over `content`. */
export function rsa2Verify(input: { content: string; sign: string; publicKey: string }): boolean {
	for (const pem of toPemVariants(input.publicKey, PUBLIC_KEY_LABELS)) {
		try {
			if (createVerify("RSA-SHA256").update(input.content, "utf8").verify(pem, input.sign, "base64")) {
				return true;
			}
		} catch {
			// Try the next container format.
		}
	}

	return false;
}

/**
 * Cuts the raw JSON text of a top-level response value out of the gateway body.
 *
 * Scans braces while respecting string literals and escapes, so a `biz_content`
 * nested inside a string cannot end the scan early.
 */
export function extractAlipayResponseContent(rawBody: string, responseKey: string): string | null {
	const keyIndex = rawBody.indexOf(`"${responseKey}"`);
	if (keyIndex === -1) return null;

	const valueStart = rawBody.indexOf("{", keyIndex);
	if (valueStart === -1) return null;

	let depth = 0;
	let inString = false;
	let escaped = false;

	for (let index = valueStart; index < rawBody.length; index += 1) {
		const char = rawBody[index];

		if (escaped) {
			escaped = false;
			continue;
		}
		if (char === "\\") {
			escaped = true;
			continue;
		}
		if (char === '"') {
			inString = !inString;
			continue;
		}
		if (inString) continue;

		if (char === "{") depth += 1;
		else if (char === "}") {
			depth -= 1;
			if (depth === 0) return rawBody.slice(valueStart, index + 1);
		}
	}

	return null;
}
