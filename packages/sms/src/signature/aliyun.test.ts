import { describe, expect, it } from "vitest";
import {
	buildStringToSign,
	canonicalizeQueryString,
	formatAliyunTimestamp,
	hmacSha1Base64,
	percentEncode,
	signAliyunRequest,
} from "./aliyun";

/**
 * 官方示例向量:阿里云《签名机制》(以 ECS DescribeRegions 为例)。
 * AccessKeyId = testid、AccessKeySecret = testsecret。
 * https://help.aliyun.com/zh/ocr/developer-reference/signature-method
 */
const OFFICIAL_PARAMS = {
	Timestamp: "2016-02-23T12:46:24Z",
	Format: "XML",
	AccessKeyId: "testid",
	Action: "DescribeRegions",
	SignatureMethod: "HMAC-SHA1",
	SignatureNonce: "3ee8c1b8-83d3-44af-a94f-4e0ad82fd6cf",
	Version: "2014-05-26",
	SignatureVersion: "1.0",
} as const;

const OFFICIAL_CANONICAL =
	"AccessKeyId=testid&Action=DescribeRegions&Format=XML&SignatureMethod=HMAC-SHA1&SignatureNonce=3ee8c1b8-83d3-44af-a94f-4e0ad82fd6cf&SignatureVersion=1.0&Timestamp=2016-02-23T12%3A46%3A24Z&Version=2014-05-26";

const OFFICIAL_STRING_TO_SIGN =
	"GET&%2F&AccessKeyId%3Dtestid%26Action%3DDescribeRegions%26Format%3DXML%26SignatureMethod%3DHMAC-SHA1%26SignatureNonce%3D3ee8c1b8-83d3-44af-a94f-4e0ad82fd6cf%26SignatureVersion%3D1.0%26Timestamp%3D2016-02-23T12%253A46%253A24Z%26Version%3D2014-05-26";

const OFFICIAL_SIGNATURE = "OLeaidS1JvxuMvnyHOwuJ+uX5qY=";
const OFFICIAL_ENCODED_SIGNATURE = "OLeaidS1JvxuMvnyHOwuJ%2BuX5qY%3D";

describe("percentEncode (RFC 3986)", () => {
	it("保留 unreserved 字符", () => {
		expect(percentEncode("AZaz09-_.~")).toBe("AZaz09-_.~");
	});

	it("编码斜杠、冒号、等号、与号", () => {
		expect(percentEncode("/")).toBe("%2F");
		expect(percentEncode("2016-02-23T12:46:24Z")).toBe("2016-02-23T12%3A46%3A24Z");
		expect(percentEncode("a=b&c")).toBe("a%3Db%26c");
	});

	it("空格编码成 %20 而不是 +", () => {
		expect(percentEncode("a b")).toBe("a%20b");
	});

	it("加号与星号按 RFC3986 编码(与 encodeURIComponent 的差异点)", () => {
		expect(percentEncode("+8613800138000")).toBe("%2B8613800138000");
		expect(percentEncode("a*b")).toBe("a%2Ab");
		expect(percentEncode("*")).toBe("%2A");
	});

	it("编码 ! ' ( )", () => {
		expect(percentEncode("!'()")).toBe("%21%27%28%29");
	});

	it("UTF-8 中文按字节编码", () => {
		expect(percentEncode("阿里云")).toBe("%E9%98%BF%E9%87%8C%E4%BA%91");
	});

	it("官方示例的签名值编码结果", () => {
		expect(percentEncode(OFFICIAL_SIGNATURE)).toBe(OFFICIAL_ENCODED_SIGNATURE);
	});
});

describe("canonicalizeQueryString", () => {
	it("按参数名字典序排序(输入顺序故意打乱)", () => {
		expect(canonicalizeQueryString(OFFICIAL_PARAMS)).toBe(OFFICIAL_CANONICAL);
	});

	it("键与值分别编码", () => {
		expect(canonicalizeQueryString({ "a b": "c/d", e: "f" })).toBe("a%20b=c%2Fd&e=f");
	});
});

describe("buildStringToSign", () => {
	it("官方示例向量", () => {
		expect(buildStringToSign("GET", OFFICIAL_CANONICAL)).toBe(OFFICIAL_STRING_TO_SIGN);
	});

	it("方法名统一大写", () => {
		expect(buildStringToSign("post", "a=b")).toBe("POST&%2F&a%3Db");
	});
});

describe("hmacSha1Base64", () => {
	it("Wikipedia HMAC-SHA1 示例向量(key / The quick brown fox ...)", () => {
		expect(hmacSha1Base64("key", "The quick brown fox jumps over the lazy dog")).toBe("3nybhbi3iqa8ino29wqQcBydtNk=");
	});
});

describe("signAliyunRequest", () => {
	it("官方示例端到端:规范化串 → 待签串 → 签名 → 编码签名", () => {
		const signed = signAliyunRequest({
			endpoint: "http://ecs.aliyuncs.com",
			params: OFFICIAL_PARAMS,
			accessKeySecret: "testsecret",
		});

		expect(signed.canonicalizedQueryString).toBe(OFFICIAL_CANONICAL);
		expect(signed.stringToSign).toBe(OFFICIAL_STRING_TO_SIGN);
		expect(signed.signature).toBe(OFFICIAL_SIGNATURE);
		expect(signed.encodedSignature).toBe(OFFICIAL_ENCODED_SIGNATURE);
	});

	it("把编码后的 Signature 作为最后一个查询参数拼进 URL", () => {
		const signed = signAliyunRequest({
			endpoint: "http://ecs.aliyuncs.com/",
			params: OFFICIAL_PARAMS,
			accessKeySecret: "testsecret",
		});

		expect(signed.url).toBe(`http://ecs.aliyuncs.com/?${OFFICIAL_CANONICAL}&Signature=${OFFICIAL_ENCODED_SIGNATURE}`);
	});

	it("Signature 不参与签名", () => {
		const signed = signAliyunRequest({
			endpoint: "https://dysmsapi.aliyuncs.com",
			params: { ...OFFICIAL_PARAMS, Signature: "should-not-be-signed" },
			accessKeySecret: "testsecret",
		});

		expect(signed.stringToSign).toContain("Signature%3Dshould-not-be-signed");
		expect(signed.url).toContain(`&Signature=${signed.encodedSignature}`);
	});

	it("SendSms 参数集:手机号与模板参数按 RFC3986 编码", () => {
		const signed = signAliyunRequest({
			endpoint: "https://dysmsapi.aliyuncs.com",
			params: {
				AccessKeyId: "testid",
				Action: "SendSms",
				Format: "JSON",
				PhoneNumbers: "+8613800138000",
				SignName: "阿里云",
				SignatureMethod: "HMAC-SHA1",
				SignatureNonce: "nonce",
				SignatureVersion: "1.0",
				TemplateCode: "SMS_123456789",
				TemplateParam: '{"code":"123456"}',
				Timestamp: "2026-09-28T00:00:00Z",
				Version: "2017-05-25",
			},
			accessKeySecret: "testsecret",
		});

		expect(signed.canonicalizedQueryString).toContain("PhoneNumbers=%2B8613800138000");
		expect(signed.canonicalizedQueryString).toContain("TemplateParam=%7B%22code%22%3A%22123456%22%7D");
		expect(signed.canonicalizedQueryString).toContain("SignName=%E9%98%BF%E9%87%8C%E4%BA%91");
		expect(signed.url.startsWith("https://dysmsapi.aliyuncs.com/?AccessKeyId=testid")).toBe(true);
	});
});

describe("formatAliyunTimestamp", () => {
	it("输出 GMT 的 yyyy-MM-ddTHH:mm:ssZ(不含毫秒)", () => {
		expect(formatAliyunTimestamp(new Date("2016-02-23T12:46:24.123Z"))).toBe("2016-02-23T12:46:24Z");
		expect(formatAliyunTimestamp(new Date("2026-09-28T08:00:00.000Z"))).toBe("2026-09-28T08:00:00Z");
	});
});
