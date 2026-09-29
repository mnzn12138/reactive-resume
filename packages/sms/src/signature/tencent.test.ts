import { describe, expect, it } from "vitest";
import {
	buildAuthorization,
	buildCanonicalHeaders,
	buildCanonicalRequest,
	buildCredentialScope,
	buildSignedHeaders,
	buildStringToSign,
	deriveSecretDate,
	deriveSecretService,
	deriveSecretSigning,
	deriveSigningKey,
	formatTc3Date,
	hmacSha256Hex,
	sha256Hex,
	signTencentRequest,
	signWithSecretSigning,
} from "./tencent";

/**
 * 官方示例向量:腾讯云《签名方法 v3》(TC3-HMAC-SHA256),以 CVM DescribeInstances 为例。
 * 文档把 SecretId / SecretKey 做了脱敏,但公布了 payload 哈希、规范请求串哈希、待签串、
 * 以及 SecretDate / SecretService / SecretSigning / Signature 全部中间值 —— 这些足以端到端
 * 校验实现,只需把密钥派生链拆开、直接喂入官方公布的中间密钥。
 * https://cloud.tencent.com/document/api/213/30654
 */
const OFFICIAL = {
	timestamp: 1551113065,
	date: "2019-02-25",
	service: "cvm",
	host: "cvm.tencentcloudapi.com",
	secretId: "AKID********************************",
	contentType: "application/json; charset=utf-8",
	payload: '{"Limit": 1, "Filters": [{"Values": ["\\u672a\\u547d\\u540d"], "Name": "instance-name"}]}',
	canonicalHeaders:
		"content-type:application/json; charset=utf-8\nhost:cvm.tencentcloudapi.com\nx-tc-action:describeinstances\n",
	signedHeaders: "content-type;host;x-tc-action",
	hashedPayload: "35e9c5b0e3ae67532d3c9f17ead6c90222632e5b1ff7f6e89887f1398934f064",
	hashedCanonicalRequest: "7019a55be8395899b900fb5564e4200d984910f34794a27cb3fb7d10ff6a1e84",
	secretDate: "da98fb70dcf6b112dc21038d1eeeb3a95c74b4dcb12c1131f864f6066bd02be0",
	secretService: "8d70cbefb03939f929db64d32dc2ba89b1095620119fe3e050e2b18c5bd2752f",
	secretSigning: "b596b923aad85185e2d1f6659d2a062e0a86731226e021e61bfe06f7ed05f5af",
	signature: "10b1a37a7301a02ca19a647ad722d5e43b4b3cff309d421d85b46093f6ab6c4f",
} as const;

const OFFICIAL_HEADERS = {
	"content-type": OFFICIAL.contentType,
	host: OFFICIAL.host,
	"x-tc-action": "describeinstances",
};

describe("sha256Hex / hmacSha256Hex 基准向量", () => {
	it("SHA-256 空串与 abc", () => {
		expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
		expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
	});

	it("RFC 4231 HMAC-SHA256 测试用例 1 / 2", () => {
		expect(hmacSha256Hex(Buffer.alloc(20, 0x0b), "Hi There")).toBe(
			"b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7",
		);
		expect(hmacSha256Hex("Jefe", "what do ya want for nothing?")).toBe(
			"5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
		);
	});
});

describe("官方 DescribeInstances 向量", () => {
	it("payload 哈希", () => {
		expect(sha256Hex(OFFICIAL.payload)).toBe(OFFICIAL.hashedPayload);
	});

	it("CanonicalHeaders 与 SignedHeaders", () => {
		expect(buildCanonicalHeaders(OFFICIAL_HEADERS)).toBe(OFFICIAL.canonicalHeaders);
		expect(buildSignedHeaders(OFFICIAL_HEADERS)).toBe(OFFICIAL.signedHeaders);
	});

	it("规范请求串哈希", () => {
		const canonicalRequest = buildCanonicalRequest({
			httpMethod: "POST",
			canonicalUri: "/",
			canonicalQueryString: "",
			headers: OFFICIAL_HEADERS,
			payload: OFFICIAL.payload,
		});

		expect(sha256Hex(canonicalRequest)).toBe(OFFICIAL.hashedCanonicalRequest);
	});

	it("CredentialScope 与待签串", () => {
		const credentialScope = buildCredentialScope({ date: OFFICIAL.date, service: OFFICIAL.service });
		expect(credentialScope).toBe("2019-02-25/cvm/tc3_request");

		const canonicalRequest = buildCanonicalRequest({
			httpMethod: "POST",
			canonicalUri: "/",
			canonicalQueryString: "",
			headers: OFFICIAL_HEADERS,
			payload: OFFICIAL.payload,
		});

		expect(buildStringToSign({ timestamp: OFFICIAL.timestamp, credentialScope, canonicalRequest })).toBe(
			["TC3-HMAC-SHA256", "1551113065", "2019-02-25/cvm/tc3_request", OFFICIAL.hashedCanonicalRequest].join("\n"),
		);
	});

	it("密钥派生链:官方 SecretDate → SecretService → SecretSigning → Signature", () => {
		expect(deriveSecretService(OFFICIAL.secretDate, OFFICIAL.service)).toBe(OFFICIAL.secretService);
		expect(deriveSecretSigning(OFFICIAL.secretService)).toBe(OFFICIAL.secretSigning);

		const credentialScope = buildCredentialScope({ date: OFFICIAL.date, service: OFFICIAL.service });
		const canonicalRequest = buildCanonicalRequest({
			httpMethod: "POST",
			canonicalUri: "/",
			canonicalQueryString: "",
			headers: OFFICIAL_HEADERS,
			payload: OFFICIAL.payload,
		});
		const stringToSign = buildStringToSign({
			timestamp: OFFICIAL.timestamp,
			credentialScope,
			canonicalRequest,
		});

		expect(signWithSecretSigning(OFFICIAL.secretSigning, stringToSign)).toBe(OFFICIAL.signature);
	});

	it("Authorization 头拼接", () => {
		const credentialScope = buildCredentialScope({ date: OFFICIAL.date, service: OFFICIAL.service });

		expect(
			buildAuthorization({
				secretId: OFFICIAL.secretId,
				credentialScope,
				signedHeaders: OFFICIAL.signedHeaders,
				signature: OFFICIAL.signature,
			}),
		).toBe(
			`TC3-HMAC-SHA256 Credential=${OFFICIAL.secretId}/2019-02-25/cvm/tc3_request, SignedHeaders=content-type;host;x-tc-action, Signature=${OFFICIAL.signature}`,
		);
	});

	it("formatTc3Date 与 X-TC-Timestamp 一致", () => {
		expect(formatTc3Date(OFFICIAL.timestamp)).toBe(OFFICIAL.date);
	});
});

describe("密钥派生链", () => {
	it("deriveSecretDate 以 TC3 前缀作为密钥", () => {
		expect(deriveSecretDate("secret", "2019-02-25")).toBe(hmacSha256Hex("TC3secret", "2019-02-25"));
	});

	it("deriveSigningKey 等价于逐级派生", () => {
		const date = "2019-02-25";
		const service = "sms";
		const secretKey = "unit-test-secret";

		expect(deriveSigningKey({ secretKey, date, service })).toBe(
			deriveSecretSigning(deriveSecretService(deriveSecretDate(secretKey, date), service)),
		);
	});
});

describe("signTencentRequest(腾讯云短信)", () => {
	const base = {
		secretId: "AKIDxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
		secretKey: "unit-test-secret-key",
		service: "sms",
		host: "sms.tencentcloudapi.com",
		action: "SendSms",
		payload: JSON.stringify({
			PhoneNumberSet: ["+8613800138000"],
			SmsSdkAppId: "1400006666",
			SignName: "腾讯云",
			TemplateId: "1110",
			TemplateParamSet: ["123456"],
		}),
		timestamp: 1759000000,
	};

	it("生成符合官方格式的 Authorization 头", () => {
		const signed = signTencentRequest(base);

		expect(signed.signedHeaders).toBe("content-type;host;x-tc-action");
		expect(signed.credentialScope).toBe(`${signed.date}/sms/tc3_request`);
		expect(signed.authorization).toBe(
			`TC3-HMAC-SHA256 Credential=${base.secretId}/${signed.credentialScope}, SignedHeaders=content-type;host;x-tc-action, Signature=${signed.signature}`,
		);
		expect(signed.signature).toMatch(/^[0-9a-f]{64}$/);
	});

	it("规范请求串包含小写化的 x-tc-action", () => {
		const signed = signTencentRequest(base);

		expect(signed.canonicalRequest).toContain("host:sms.tencentcloudapi.com");
		expect(signed.canonicalRequest).toContain("x-tc-action:sendsms");
		expect(signed.canonicalRequest.startsWith("POST\n/\n\n")).toBe(true);
	});

	it("参与签名的头按字典序排列,与传入顺序无关", () => {
		const signed = signTencentRequest(base);

		expect(signed.canonicalRequest).toContain(
			"content-type:application/json; charset=utf-8\nhost:sms.tencentcloudapi.com\nx-tc-action:sendsms\n",
		);
	});

	it("相同输入得到相同签名;payload 变化则签名变化", () => {
		const first = signTencentRequest(base);
		const second = signTencentRequest(base);
		const changed = signTencentRequest({
			...base,
			payload: JSON.stringify({ ...JSON.parse(base.payload), TemplateParamSet: ["654321"] }),
		});

		expect(first.signature).toBe(second.signature);
		expect(changed.signature).not.toBe(first.signature);
	});

	it("时间戳变化会同时改变待签串与签名", () => {
		const first = signTencentRequest(base);
		const later = signTencentRequest({ ...base, timestamp: base.timestamp + 1 });

		expect(later.stringToSign).not.toBe(first.stringToSign);
		expect(later.signature).not.toBe(first.signature);
	});
});
