import { createHmac } from "node:crypto";

/**
 * 阿里云 OpenAPI POP 签名(HMAC-SHA1),用于 `SendSms`(Dysmsapi 2017-05-25)。
 *
 * 规则见《签名机制》:
 *   1. 参数按参数名的字典序排序(参与签名的参数不含 `Signature` 本身);
 *   2. 参数名与参数值分别按 RFC3986 做 percentEncode —— 与 `encodeURIComponent` 的差异在于
 *      `!`、`'`、`(`、`)`、`*` 必须编码,而 `-`、`_`、`.`、`~` 必须保留;
 *   3. StringToSign = `HTTPMethod & percentEncode("/") & percentEncode(CanonicalizedQueryString)`;
 *   4. Signature = Base64(HMAC-SHA1(AccessKeySecret + "&", StringToSign));
 *   5. 最终请求中 `Signature` 参数的值同样要按 RFC3986 编码(这一步决定了 `+` → `%2B`、`=` → `%3D`)。
 */

// `encodeURIComponent` 保留的字符里,只有这五个不属于 RFC3986 的 unreserved 集合。
const MUST_ENCODE = /[!'()*]/g;

/** RFC3986 percentEncode:unreserved(A-Z a-z 0-9 - _ . ~)之外的字符一律 %XY 大写十六进制。 */
export const percentEncode = (value: string): string =>
	encodeURIComponent(value).replace(
		MUST_ENCODE,
		(character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
	);

/** 排序 + 编码,构造 CanonicalizedQueryString。 */
export const canonicalizeQueryString = (params: Readonly<Record<string, string>>): string =>
	Object.keys(params)
		.sort()
		.map((key) => `${percentEncode(key)}=${percentEncode(params[key] ?? "")}`)
		.join("&");

/** 构造待签名字符串。阿里云在拼接时不额外引入分隔符,三个部分用 `&` 相连。 */
export const buildStringToSign = (httpMethod: string, canonicalizedQueryString: string): string =>
	`${httpMethod.toUpperCase()}&${percentEncode("/")}&${percentEncode(canonicalizedQueryString)}`;

/** HMAC-SHA1 + Base64,密钥为 `AccessKeySecret + "&"`。 */
export const hmacSha1Base64 = (key: string, data: string): string =>
	createHmac("sha1", key).update(data, "utf8").digest("base64");

export type AliyunSignedRequest = {
	canonicalizedQueryString: string;
	stringToSign: string;
	signature: string;
	encodedSignature: string;
	/** 可直接发起 GET 的完整 URL(query 中已带上 percentEncode 后的 Signature)。 */
	url: string;
};

export type AliyunSignInput = {
	/** 阿里云短信只接受 GET(签名用的方法必须与请求方法一致)。 */
	httpMethod?: string;
	/** 形如 `https://dysmsapi.aliyuncs.com`,结尾的斜杠会被忽略。 */
	endpoint: string;
	params: Readonly<Record<string, string>>;
	accessKeySecret: string;
};

export const signAliyunRequest = (input: AliyunSignInput): AliyunSignedRequest => {
	const canonicalizedQueryString = canonicalizeQueryString(input.params);
	const stringToSign = buildStringToSign(input.httpMethod ?? "GET", canonicalizedQueryString);
	const signature = hmacSha1Base64(`${input.accessKeySecret}&`, stringToSign);
	const encodedSignature = percentEncode(signature);
	const endpoint = input.endpoint.replace(/\/+$/, "");

	return {
		canonicalizedQueryString,
		stringToSign,
		signature,
		encodedSignature,
		url: `${endpoint}/?${canonicalizedQueryString}&Signature=${encodedSignature}`,
	};
};

/** 阿里云要求 GMT/UTC 时间,格式 `yyyy-MM-ddTHH:mm:ssZ`,不含毫秒。 */
export const formatAliyunTimestamp = (date: Date): string => date.toISOString().replace(/\.\d{3}Z$/, "Z");
