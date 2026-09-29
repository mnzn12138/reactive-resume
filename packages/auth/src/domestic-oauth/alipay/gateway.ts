import {
	buildAlipaySignContent,
	extractAlipayResponseContent,
	formatAlipayTimestamp,
	rsa2Sign,
	rsa2Verify,
} from "./signature";

/**
 * One call to Alipay's OpenAPI gateway.
 *
 * Every request is signed and every response is verified before it is parsed.
 * A failure to verify is fatal rather than a warning: the response decides
 * whether an account is created, so a tampered or mis-signed body must never be
 * read as if it were genuine.
 */

const GATEWAY_URL = "https://openapi.alipay.com/gateway.do";

export type AlipayCredentials = {
	appId: string;
	privateKey: string;
	alipayPublicKey: string;
};

export class AlipayGatewayError extends Error {
	readonly vendorCode: string;

	constructor(vendorCode: string, message: string) {
		super(message);
		this.name = "AlipayGatewayError";
		this.vendorCode = vendorCode;
	}
}

/** `alipay.system.oauth.token` → `alipay_system_oauth_token_response`. */
function alipayResponseKey(method: string): string {
	return `${method.replaceAll(".", "_")}_response`;
}

function readString(source: Record<string, unknown>, key: string): string | undefined {
	const value = source[key];
	return typeof value === "string" && value ? value : undefined;
}

/**
 * Posts one signed request and returns the verified response payload.
 *
 * @throws `AlipayGatewayError` on a transport failure, a gateway-level error, a
 * missing or invalid signature — never a partially trusted payload.
 */
export async function callAlipayGateway(input: {
	method: string;
	credentials: AlipayCredentials;
	bizContent?: Record<string, unknown> | undefined;
	authToken?: string | undefined;
}): Promise<Record<string, unknown>> {
	const { credentials } = input;

	const params: Record<string, string> = {
		app_id: credentials.appId,
		method: input.method,
		format: "JSON",
		charset: "utf-8",
		sign_type: "RSA2",
		timestamp: formatAlipayTimestamp(),
		version: "1.0",
		biz_content: JSON.stringify(input.bizContent ?? {}),
		...(input.authToken ? { auth_token: input.authToken } : {}),
	};

	const sign = rsa2Sign(buildAlipaySignContent(params), credentials.privateKey);
	const body = new URLSearchParams({ ...params, sign });

	let raw: string;
	try {
		const response = await fetch(GATEWAY_URL, {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded;charset=utf-8" },
			body,
		});
		raw = await response.text();

		if (!response.ok) {
			throw new AlipayGatewayError(`HTTP_${response.status}`, `Alipay gateway returned HTTP ${response.status}`);
		}
	} catch (error) {
		if (error instanceof AlipayGatewayError) throw error;
		throw new AlipayGatewayError("NETWORK_ERROR", "Could not reach the Alipay gateway");
	}

	const envelope = JSON.parse(raw) as Record<string, unknown>;
	const responseKey = alipayResponseKey(input.method);
	const errorEnvelope = envelope.error_response;

	if (errorEnvelope && typeof errorEnvelope === "object") {
		// Alipay signs error responses too, so the same rule applies: no valid
		// signature means no trustworthy explanation to show the user.
		const errorContent = extractAlipayResponseContent(raw, "error_response");
		verifyOrThrow({ raw, content: errorContent, publicKey: credentials.alipayPublicKey, method: input.method });

		const error = errorEnvelope as Record<string, unknown>;
		const code = readString(error, "code") ?? readString(error, "sub_code") ?? "UNKNOWN_ERROR";
		const message = readString(error, "sub_msg") ?? readString(error, "msg") ?? "Alipay rejected the request";

		throw new AlipayGatewayError(code, message);
	}

	const content = extractAlipayResponseContent(raw, responseKey);
	verifyOrThrow({ raw, content, publicKey: credentials.alipayPublicKey, method: input.method });

	return JSON.parse(content as string) as Record<string, unknown>;
}

function verifyOrThrow(input: { raw: string; content: string | null; publicKey: string; method: string }): void {
	if (!input.content) {
		throw new AlipayGatewayError("INVALID_RESPONSE", `Alipay response for ${input.method} is missing its payload`);
	}

	const envelope = JSON.parse(input.raw) as Record<string, unknown>;
	const sign = readString(envelope, "sign");

	if (!sign) {
		throw new AlipayGatewayError("MISSING_SIGNATURE", `Alipay response for ${input.method} carried no signature`);
	}

	if (!rsa2Verify({ content: input.content, sign, publicKey: input.publicKey })) {
		throw new AlipayGatewayError(
			"INVALID_SIGNATURE",
			`Alipay response for ${input.method} failed signature verification`,
		);
	}
}
