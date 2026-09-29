import { createHash, createHmac } from "node:crypto";

/**
 * 腾讯云 API 3.0 签名方法 TC3-HMAC-SHA256,用于 `sms.tencentcloudapi.com` 的
 * `SendSms`(版本 2021-01-11)。
 *
 * 规则见《签名方法 v3》:
 *   1. CanonicalRequest = HTTPMethod \n CanonicalURI \n CanonicalQueryString \n
 *      CanonicalHeaders \n SignedHeaders \n HashedRequestPayload;
 *   2. StringToSign = "TC3-HMAC-SHA256" \n Timestamp \n CredentialScope \n HashedCanonicalRequest;
 *   3. SecretDate = HMAC-SHA256("TC3" + SecretKey, Date)
 *      SecretService = HMAC-SHA256(SecretDate, Service)
 *      SecretSigning = HMAC-SHA256(SecretService, "tc3_request")
 *      Signature = Hex(HMAC-SHA256(SecretSigning, StringToSign));
 *   4. Authorization = TC3-HMAC-SHA256 Credential=SecretId/CredentialScope,
 *      SignedHeaders=..., Signature=...
 *
 * 密钥派生被拆成三个可单独调用的函数,这样官方示例中公布的 SecretDate / SecretService /
 * SecretSigning 中间值可以直接作为单测的输入,而不必知道被脱敏的 SecretKey。
 */

const ALGORITHM = "TC3-HMAC-SHA256";

export const sha256Hex = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

export const hmacSha256Hex = (key: Buffer | string, data: string): string =>
	createHmac("sha256", key).update(data, "utf8").digest("hex");

/** SecretDate = HMAC-SHA256("TC3" + SecretKey, Date),返回十六进制字符串。 */
export const deriveSecretDate = (secretKey: string, date: string): string => hmacSha256Hex(`TC3${secretKey}`, date);

/** SecretService = HMAC-SHA256(SecretDate, Service),入参为十六进制字符串形式的 SecretDate。 */
export const deriveSecretService = (secretDateHex: string, service: string): string =>
	hmacSha256Hex(Buffer.from(secretDateHex, "hex"), service);

/** SecretSigning = HMAC-SHA256(SecretService, "tc3_request")。 */
export const deriveSecretSigning = (secretServiceHex: string): string =>
	hmacSha256Hex(Buffer.from(secretServiceHex, "hex"), "tc3_request");

/** Signature = HMAC-SHA256(SecretSigning, StringToSign)。 */
export const signWithSecretSigning = (secretSigningHex: string, stringToSign: string): string =>
	hmacSha256Hex(Buffer.from(secretSigningHex, "hex"), stringToSign);

/** 一次算完整条密钥派生链,返回 SecretSigning 的十六进制形式。 */
export const deriveSigningKey = (input: { secretKey: string; date: string; service: string }): string =>
	deriveSecretSigning(deriveSecretService(deriveSecretDate(input.secretKey, input.date), input.service));

/** CanonicalHeaders:键小写、`key:value\n` 整体按字典序排序。 */
export const buildCanonicalHeaders = (headers: Readonly<Record<string, string>>): string =>
	Object.keys(headers)
		.map((key) => `${key.toLowerCase()}:${(headers[key] ?? "").trim()}\n`)
		.sort()
		.join("");

/** SignedHeaders:参与签名的头名小写后按字典序用 `;` 连接。 */
export const buildSignedHeaders = (headers: Readonly<Record<string, string>>): string =>
	Object.keys(headers)
		.map((key) => key.toLowerCase())
		.sort()
		.join(";");

export const buildCanonicalRequest = (input: {
	httpMethod: string;
	canonicalUri: string;
	canonicalQueryString: string;
	headers: Readonly<Record<string, string>>;
	payload: string;
}): string =>
	[
		input.httpMethod.toUpperCase(),
		input.canonicalUri,
		input.canonicalQueryString,
		buildCanonicalHeaders(input.headers),
		buildSignedHeaders(input.headers),
		sha256Hex(input.payload),
	].join("\n");

export const buildCredentialScope = (input: { date: string; service: string }): string =>
	`${input.date}/${input.service}/tc3_request`;

export const buildStringToSign = (input: {
	timestamp: number;
	credentialScope: string;
	canonicalRequest: string;
}): string => [ALGORITHM, String(input.timestamp), input.credentialScope, sha256Hex(input.canonicalRequest)].join("\n");

export const buildAuthorization = (input: {
	secretId: string;
	credentialScope: string;
	signedHeaders: string;
	signature: string;
}): string =>
	`${ALGORITHM} Credential=${input.secretId}/${input.credentialScope}, SignedHeaders=${input.signedHeaders}, Signature=${input.signature}`;

/** `X-TC-Timestamp` 对应的 UTC 日期(`yyyy-MM-dd`),必须与 Credential 中的 Date 一致。 */
export const formatTc3Date = (timestampSeconds: number): string =>
	new Date(timestampSeconds * 1000).toISOString().slice(0, 10);

export type TencentSignedRequest = {
	authorization: string;
	canonicalRequest: string;
	stringToSign: string;
	signature: string;
	signedHeaders: string;
	credentialScope: string;
	date: string;
	timestamp: number;
};

export type TencentSignInput = {
	secretId: string;
	secretKey: string;
	/** 产品名,取自接口域名前缀:短信为 `sms`。 */
	service: string;
	host: string;
	/** 接口名,`SendSms`;canonical header 中取小写 `sendsms`。 */
	action: string;
	payload: string;
	/** 秒级 Unix 时间戳,即 `X-TC-Timestamp`。 */
	timestamp: number;
	canonicalUri?: string;
	canonicalQueryString?: string;
	contentType?: string;
};

export const signTencentRequest = (input: TencentSignInput): TencentSignedRequest => {
	const canonicalUri = input.canonicalUri ?? "/";
	const canonicalQueryString = input.canonicalQueryString ?? "";
	const contentType = input.contentType ?? "application/json; charset=utf-8";

	const headers = {
		"content-type": contentType,
		host: input.host,
		"x-tc-action": input.action.toLowerCase(),
	};

	const canonicalRequest = buildCanonicalRequest({
		httpMethod: "POST",
		canonicalUri,
		canonicalQueryString,
		headers,
		payload: input.payload,
	});

	const date = formatTc3Date(input.timestamp);
	const credentialScope = buildCredentialScope({ date, service: input.service });
	const stringToSign = buildStringToSign({ timestamp: input.timestamp, credentialScope, canonicalRequest });
	const secretSigning = deriveSigningKey({ secretKey: input.secretKey, date, service: input.service });
	const signature = signWithSecretSigning(secretSigning, stringToSign);
	const signedHeaders = buildSignedHeaders(headers);

	return {
		authorization: buildAuthorization({ secretId: input.secretId, credentialScope, signedHeaders, signature }),
		canonicalRequest,
		stringToSign,
		signature,
		signedHeaders,
		credentialScope,
		date,
		timestamp: input.timestamp,
	};
};
