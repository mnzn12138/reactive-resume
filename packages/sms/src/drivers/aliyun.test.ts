import { describe, expect, it } from "vitest";
import { AliyunSmsDriver } from "./aliyun";

type RecordedCall = { url: string; init: RequestInit | undefined };

const createFetchRecorder = (
	respond: () => Response,
): { calls: RecordedCall[]; fetchImpl: typeof globalThis.fetch } => {
	const calls: RecordedCall[] = [];

	const fetchImpl = ((input: string | URL, init?: RequestInit) => {
		calls.push({ url: String(input), init });

		return Promise.resolve(respond());
	}) as unknown as typeof globalThis.fetch;

	return { calls, fetchImpl };
};

const jsonResponse =
	(body: unknown, status = 200): (() => Response) =>
	() =>
		new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const CONFIG = {
	accessKeyId: "testid",
	accessKeySecret: "testsecret",
	signName: "阿里云短信测试",
	templateCode: "SMS_123456789",
	now: () => new Date("2016-02-23T12:46:24.000Z"),
	nonce: () => "3ee8c1b8-83d3-44af-a94f-4e0ad82fd6cf",
};

const createDriver = (fetchImpl: typeof globalThis.fetch): AliyunSmsDriver =>
	new AliyunSmsDriver({ ...CONFIG, fetchImpl });

describe("AliyunSmsDriver.send 请求构造", () => {
	it("GET 到 dysmsapi,带上 Action / Version / 公共签名参数", async () => {
		const { calls, fetchImpl } = createFetchRecorder(
			jsonResponse({ Code: "OK", Message: "OK", RequestId: "req-1", BizId: "biz-1" }),
		);

		const result = await createDriver(fetchImpl).send({
			phoneNumber: "13800138000",
			templateParams: { code: "123456" },
		});

		expect(result.ok).toBe(true);
		expect(calls).toHaveLength(1);

		const url = new URL(calls[0]?.url ?? "");

		expect(url.origin + url.pathname).toBe("https://dysmsapi.aliyuncs.com/");
		expect(url.searchParams.get("Action")).toBe("SendSms");
		expect(url.searchParams.get("Version")).toBe("2017-05-25");
		expect(url.searchParams.get("Format")).toBe("JSON");
		expect(url.searchParams.get("SignatureMethod")).toBe("HMAC-SHA1");
		expect(url.searchParams.get("SignatureVersion")).toBe("1.0");
		expect(url.searchParams.get("SignatureNonce")).toBe("3ee8c1b8-83d3-44af-a94f-4e0ad82fd6cf");
		expect(url.searchParams.get("Timestamp")).toBe("2016-02-23T12:46:24Z");
		expect(url.searchParams.get("AccessKeyId")).toBe("testid");
		expect(url.searchParams.get("SignName")).toBe("阿里云短信测试");
		expect(url.searchParams.get("TemplateCode")).toBe("SMS_123456789");
		expect(url.searchParams.get("PhoneNumbers")).toBe("+8613800138000");
		expect(url.searchParams.get("TemplateParam")).toBe('{"code":"123456"}');

		expect(calls[0]?.init?.method).toBe("GET");
	});

	it("Signature 是 HMAC-SHA1 Base64(20 字节),且随 nonce 变化", async () => {
		const first = createFetchRecorder(jsonResponse({ Code: "OK", RequestId: "r" }));
		await createDriver(first.fetchImpl).send({ phoneNumber: "+8613800138000", templateParams: {} });

		const signature = new URL(first.calls[0]?.url ?? "").searchParams.get("Signature") ?? "";

		// SHA-1 摘要 20 字节 → 28 个 Base64 字符,末尾一个 `=`。
		expect(signature).toMatch(/^[A-Za-z0-9+/]{27}=$/);

		const second = createFetchRecorder(jsonResponse({ Code: "OK", RequestId: "r" }));
		const driver = new AliyunSmsDriver({ ...CONFIG, nonce: () => "another-nonce", fetchImpl: second.fetchImpl });
		await driver.send({ phoneNumber: "+8613800138000", templateParams: {} });

		expect(new URL(second.calls[0]?.url ?? "").searchParams.get("Signature")).not.toBe(signature);
	});

	it("模板变量按 templateParamKeys 的顺序序列化", async () => {
		const { calls, fetchImpl } = createFetchRecorder(jsonResponse({ Code: "OK", RequestId: "r" }));

		const driver = new AliyunSmsDriver({
			...CONFIG,
			templateParamKeys: ["code", "minutes"],
			fetchImpl,
		});

		await driver.send({ phoneNumber: "13800138000", templateParams: { minutes: "5", code: "123456" } });

		expect(new URL(calls[0]?.url ?? "").searchParams.get("TemplateParam")).toBe('{"code":"123456","minutes":"5"}');
	});
});

describe("AliyunSmsDriver.send 响应处理", () => {
	it("Code = OK 视为成功,取 BizId 与 RequestId", async () => {
		const { fetchImpl } = createFetchRecorder(
			jsonResponse({ Code: "OK", Message: "OK", RequestId: "req-1", BizId: "123456^7890" }),
		);

		expect(await createDriver(fetchImpl).send({ phoneNumber: "13800138000", templateParams: { code: "1" } })).toEqual({
			ok: true,
			vendorMessageId: "123456^7890",
			vendorRequestId: "req-1",
		});
	});

	it("业务错误码映射成中文 + 原始码", async () => {
		const { fetchImpl } = createFetchRecorder(
			jsonResponse({ Code: "isv.BUSINESS_LIMIT_CONTROL", Message: "触发云通信流控限制", RequestId: "req-2" }),
		);

		const result = await createDriver(fetchImpl).send({ phoneNumber: "13800138000", templateParams: { code: "1" } });

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.code).toBe("RATE_LIMITED");
		expect(result.vendorCode).toBe("isv.BUSINESS_LIMIT_CONTROL");
		expect(result.message).toContain("流控");
	});

	it("网关级错误(如 InvalidAccessKeyId.NotFound)同样给出可读中文", async () => {
		const { fetchImpl } = createFetchRecorder(
			jsonResponse(
				{ Code: "InvalidAccessKeyId.NotFound", Message: "Specified access key is not found.", RequestId: "r" },
				400,
			),
		);

		const result = await createDriver(fetchImpl).send({ phoneNumber: "13800138000", templateParams: { code: "1" } });

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.code).toBe("INVALID_CREDENTIALS");
		expect(result.message).toContain("AccessKey ID 不存在");
	});

	it("非法手机号不发请求,直接返回可读错误", async () => {
		const { calls, fetchImpl } = createFetchRecorder(jsonResponse({ Code: "OK", RequestId: "r" }));

		const result = await createDriver(fetchImpl).send({ phoneNumber: "not-a-number", templateParams: { code: "1" } });

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.code).toBe("INVALID_PHONE_NUMBER");
		expect(result.vendorCode).toBe("isv.MOBILE_NUMBER_ILLEGAL");
		expect(calls).toHaveLength(0);
	});

	it("网络异常转成 NETWORK_ERROR 而不是抛出", async () => {
		const fetchImpl = (() => Promise.reject(new Error("socket hang up"))) as unknown as typeof globalThis.fetch;

		const result = await createDriver(fetchImpl).send({ phoneNumber: "13800138000", templateParams: { code: "1" } });

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.code).toBe("NETWORK_ERROR");
		expect(result.message).toContain("socket hang up");
	});

	it("非 JSON 响应按状态码归类", async () => {
		const { fetchImpl } = createFetchRecorder(() => new Response("<html>502</html>", { status: 502 }));

		const result = await createDriver(fetchImpl).send({ phoneNumber: "13800138000", templateParams: { code: "1" } });

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.code).toBe("NETWORK_ERROR");
		expect(result.vendorCode).toBe("HTTP_502");
	});
});

describe("AliyunSmsDriver.describe", () => {
	it("报告已配置并遮蔽密钥", () => {
		const diagnostics = createDriver(globalThis.fetch).describe();

		expect(diagnostics).toMatchObject({ vendor: "aliyun", configured: true, missing: [] });
		expect(diagnostics.preview).toContain("阿里云短信");
		expect(diagnostics.preview).toContain("****");
		expect(diagnostics.preview).not.toContain("testsecret");
	});
});
