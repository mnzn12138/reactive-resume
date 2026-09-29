import { describe, expect, it } from "vitest";
import { TENCENT_SMS_CONTENT_TYPE, TENCENT_SMS_VERSION, TencentSmsDriver } from "./tencent";

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
	secretId: "AKIDz8krbsJ5yKBZQpn74WFkmLPx3EXAMPLE",
	secretKey: "unit-test-secret-key",
	sdkAppId: "1400006666",
	signName: "腾讯云",
	templateId: "1110",
	now: () => new Date("2019-02-25T00:00:00.000Z"),
	nonce: () => "123456",
};

const timestampOf = (iso: string): string => String(Math.floor(new Date(iso).getTime() / 1000));

const createDriver = (fetchImpl: typeof globalThis.fetch): TencentSmsDriver =>
	new TencentSmsDriver({ ...CONFIG, fetchImpl });

const headersOf = (call: RecordedCall | undefined): Record<string, string> =>
	(call?.init?.headers ?? {}) as Record<string, string>;

const bodyOf = (call: RecordedCall | undefined): Record<string, unknown> =>
	JSON.parse(String(call?.init?.body ?? "{}")) as Record<string, unknown>;

const successResponse = {
	Response: {
		SendStatusSet: [
			{
				SerialNo: "5000:1045710669157053657849499619",
				PhoneNumber: "+8613800138000",
				Fee: 1,
				Code: "Ok",
				Message: "send success",
				IsoCode: "CN",
			},
		],
		RequestId: "a0aabda6-cf91-4f3e-a81f-9198114a2279",
	},
};

describe("TencentSmsDriver.send 请求构造", () => {
	it("POST 到 sms.tencentcloudapi.com,带上 TC3 鉴权头", async () => {
		const { calls, fetchImpl } = createFetchRecorder(jsonResponse(successResponse));

		const result = await createDriver(fetchImpl).send({
			phoneNumber: "13800138000",
			templateParams: { code: "123456" },
		});

		expect(result.ok).toBe(true);
		expect(calls).toHaveLength(1);

		const headers = headersOf(calls[0]);

		expect(calls[0]?.url).toBe("https://sms.tencentcloudapi.com");
		expect(calls[0]?.init?.method).toBe("POST");
		expect(headers["content-type"]).toBe(TENCENT_SMS_CONTENT_TYPE);
		expect(headers["x-tc-action"]).toBe("SendSms");
		expect(headers["x-tc-version"]).toBe(TENCENT_SMS_VERSION);
		expect(headers["x-tc-region"]).toBe("ap-guangzhou");
		expect(headers["x-tc-timestamp"]).toBe(timestampOf("2019-02-25T00:00:00.000Z"));
		expect(headers["x-tc-nonce"]).toBe("123456");
		expect(headers.authorization).toMatch(
			/^TC3-HMAC-SHA256 Credential=.+\/2019-02-25\/sms\/tc3_request, SignedHeaders=content-type;host;x-tc-action, Signature=[0-9a-f]{64}$/,
		);
	});

	it("body 使用 E.164 号码与 TemplateParamSet 数组", async () => {
		const { calls, fetchImpl } = createFetchRecorder(jsonResponse(successResponse));

		await createDriver(fetchImpl).send({ phoneNumber: "13800138000", templateParams: { code: "123456" } });

		expect(bodyOf(calls[0])).toEqual({
			PhoneNumberSet: ["+8613800138000"],
			SmsSdkAppId: "1400006666",
			SignName: "腾讯云",
			TemplateId: "1110",
			TemplateParamSet: ["123456"],
		});
	});

	it("templateParamKeys 决定 TemplateParamSet 的顺序", async () => {
		const { calls, fetchImpl } = createFetchRecorder(jsonResponse(successResponse));

		const driver = new TencentSmsDriver({ ...CONFIG, templateParamKeys: ["code", "minutes"], fetchImpl });
		await driver.send({ phoneNumber: "13800138000", templateParams: { minutes: "5", code: "123456" } });

		expect(bodyOf(calls[0]).TemplateParamSet).toEqual(["123456", "5"]);
	});

	it("时间戳随 clock 变化", async () => {
		const { calls, fetchImpl } = createFetchRecorder(jsonResponse(successResponse));

		const driver = new TencentSmsDriver({ ...CONFIG, now: () => new Date("2026-09-28T00:00:00.000Z"), fetchImpl });
		await driver.send({ phoneNumber: "13800138000", templateParams: { code: "1" } });

		expect(headersOf(calls[0])["x-tc-timestamp"]).toBe(timestampOf("2026-09-28T00:00:00.000Z"));
		expect(headersOf(calls[0]).authorization).toContain("/2026-09-28/sms/tc3_request");
	});
});

describe("TencentSmsDriver.send 响应处理", () => {
	it("SendStatusSet[0].Code = Ok 视为成功,取 SerialNo 与 RequestId", async () => {
		const { fetchImpl } = createFetchRecorder(jsonResponse(successResponse));

		expect(await createDriver(fetchImpl).send({ phoneNumber: "13800138000", templateParams: { code: "1" } })).toEqual({
			ok: true,
			vendorMessageId: "5000:1045710669157053657849499619",
			vendorRequestId: "a0aabda6-cf91-4f3e-a81f-9198114a2279",
		});
	});

	it("Response.Error 映射成中文 + 原始码", async () => {
		const { fetchImpl } = createFetchRecorder(
			jsonResponse({
				Response: {
					Error: { Code: "AuthFailure.SignatureExpire", Message: "The provided credentials could not be validated." },
					RequestId: "ed93f3cb-f35e-473f-b9f3-0d451b8b79c6",
				},
			}),
		);

		const result = await createDriver(fetchImpl).send({ phoneNumber: "13800138000", templateParams: { code: "1" } });

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.code).toBe("SIGNATURE_MISMATCH");
		expect(result.vendorCode).toBe("AuthFailure.SignatureExpire");
		expect(result.message).toContain("签名已过期");
	});

	it("SendStatusSet 里的失败码同样映射", async () => {
		const { fetchImpl } = createFetchRecorder(
			jsonResponse({
				Response: {
					SendStatusSet: [
						{
							SerialNo: "",
							PhoneNumber: "+8613800138000",
							Fee: 0,
							Code: "LimitExceeded.DeliveryFrequencyLimit",
							Message: "",
						},
					],
					RequestId: "r",
				},
			}),
		);

		const result = await createDriver(fetchImpl).send({ phoneNumber: "13800138000", templateParams: { code: "1" } });

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.code).toBe("RATE_LIMITED");
		expect(result.vendorCode).toBe("LimitExceeded.DeliveryFrequencyLimit");
		expect(result.message).toContain("频率限制");
	});

	it("非法手机号不发请求", async () => {
		const { calls, fetchImpl } = createFetchRecorder(jsonResponse(successResponse));

		const result = await createDriver(fetchImpl).send({ phoneNumber: "123", templateParams: { code: "1" } });

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.code).toBe("INVALID_PHONE_NUMBER");
		expect(result.vendorCode).toBe("InvalidParameterValue.IncorrectPhoneNumber");
		expect(calls).toHaveLength(0);
	});

	it("网络异常转成 NETWORK_ERROR", async () => {
		const fetchImpl = (() => Promise.reject(new Error("ECONNRESET"))) as unknown as typeof globalThis.fetch;

		const result = await createDriver(fetchImpl).send({ phoneNumber: "13800138000", templateParams: { code: "1" } });

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.code).toBe("NETWORK_ERROR");
		expect(result.message).toContain("ECONNRESET");
	});

	it("缺少 SendStatusSet 时按状态码归类", async () => {
		const { fetchImpl } = createFetchRecorder(() => new Response("gateway timeout", { status: 504 }));

		const result = await createDriver(fetchImpl).send({ phoneNumber: "13800138000", templateParams: { code: "1" } });

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.vendorCode).toBe("HTTP_504");
		expect(result.code).toBe("NETWORK_ERROR");
	});
});

describe("TencentSmsDriver.describe", () => {
	it("报告已配置并遮蔽密钥", () => {
		const diagnostics = createDriver(globalThis.fetch).describe();

		expect(diagnostics).toMatchObject({ vendor: "tencent", configured: true, missing: [] });
		expect(diagnostics.preview).toContain("腾讯云短信");
		expect(diagnostics.preview).toContain("****");
		expect(diagnostics.preview).not.toContain("unit-test-secret-key");
	});
});
