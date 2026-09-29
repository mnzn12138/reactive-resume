import { describe, expect, it } from "vitest";
import { AliyunSmsDriver, describeSms, getSmsDriver, resolveSmsConfig, SMS_ENV_KEYS, TencentSmsDriver } from "./index";

const ALIYUN_ENV = {
	[SMS_ENV_KEYS.provider]: "aliyun",
	[SMS_ENV_KEYS.aliyun.accessKeyId]: "LTAI5tTestAccessKeyId",
	[SMS_ENV_KEYS.aliyun.accessKeySecret]: "testAccessKeySecret",
	[SMS_ENV_KEYS.aliyun.signName]: "测试签名",
	[SMS_ENV_KEYS.aliyun.templateCode]: "SMS_123456789",
};

const TENCENT_ENV = {
	[SMS_ENV_KEYS.provider]: "tencent",
	[SMS_ENV_KEYS.tencent.secretId]: "AKIDz8krbsJ5yKBZQpn74WFkmLPx3EXAMPLE",
	[SMS_ENV_KEYS.tencent.secretKey]: "unit-test-secret-key",
	[SMS_ENV_KEYS.tencent.sdkAppId]: "1400006666",
	[SMS_ENV_KEYS.tencent.signName]: "腾讯云",
	[SMS_ENV_KEYS.tencent.templateId]: "1110",
};

describe("resolveSmsConfig", () => {
	it("未设置 SMS_PROVIDER → 未配置", () => {
		expect(resolveSmsConfig({})).toEqual({ configured: false, vendor: undefined, missing: ["SMS_PROVIDER"] });
	});

	it("SMS_PROVIDER 取值不认识 → 未配置", () => {
		expect(resolveSmsConfig({ [SMS_ENV_KEYS.provider]: "twilio" })).toEqual({
			configured: false,
			vendor: undefined,
			missing: ["SMS_PROVIDER"],
		});
	});

	it("provider 大小写不敏感", () => {
		const resolution = resolveSmsConfig({ ...ALIYUN_ENV, [SMS_ENV_KEYS.provider]: "AliYun" });

		expect(resolution.configured).toBe(true);
		expect(resolution.vendor).toBe("aliyun");
	});

	it("阿里云:缺一项即未配置,并列出缺哪个变量", () => {
		const resolution = resolveSmsConfig({
			[SMS_ENV_KEYS.provider]: "aliyun",
			[SMS_ENV_KEYS.aliyun.accessKeyId]: "id",
			[SMS_ENV_KEYS.aliyun.accessKeySecret]: "secret",
		});

		expect(resolution.configured).toBe(false);
		expect(resolution.vendor).toBe("aliyun");
		expect(resolution.missing).toEqual(["ALIYUN_SMS_SIGN_NAME", "ALIYUN_SMS_TEMPLATE_CODE"]);
	});

	it("阿里云:四项齐全才启用", () => {
		const resolution = resolveSmsConfig(ALIYUN_ENV);

		expect(resolution.configured).toBe(true);
		if (!resolution.configured) return;
		expect(resolution.vendor).toBe("aliyun");
		expect(resolution.driverConfig).toEqual({
			accessKeyId: "LTAI5tTestAccessKeyId",
			accessKeySecret: "testAccessKeySecret",
			signName: "测试签名",
			templateCode: "SMS_123456789",
		});
	});

	it("腾讯云:五项齐全才启用", () => {
		const resolution = resolveSmsConfig(TENCENT_ENV);

		expect(resolution.configured).toBe(true);
		if (!resolution.configured) return;
		expect(resolution.vendor).toBe("tencent");
		expect(resolution.driverConfig).toMatchObject({
			secretId: "AKIDz8krbsJ5yKBZQpn74WFkmLPx3EXAMPLE",
			sdkAppId: "1400006666",
			signName: "腾讯云",
			templateId: "1110",
		});
	});

	it("空白字符串视为缺失", () => {
		const resolution = resolveSmsConfig({ ...ALIYUN_ENV, [SMS_ENV_KEYS.aliyun.signName]: "   " });

		expect(resolution.configured).toBe(false);
		expect(resolution.missing).toEqual(["ALIYUN_SMS_SIGN_NAME"]);
	});
});

describe("getSmsDriver", () => {
	it("凭证齐全时返回对应厂商的驱动", () => {
		expect(getSmsDriver(ALIYUN_ENV)).toBeInstanceOf(AliyunSmsDriver);
		expect(getSmsDriver(TENCENT_ENV)).toBeInstanceOf(TencentSmsDriver);
	});

	it("凭证缺失时返回 undefined,而不是抛异常", () => {
		expect(getSmsDriver({})).toBeUndefined();
		expect(getSmsDriver({ [SMS_ENV_KEYS.provider]: "aliyun" })).toBeUndefined();
	});

	it("相同凭证复用同一个实例,换凭证则重建", () => {
		const first = getSmsDriver(ALIYUN_ENV);
		const second = getSmsDriver({ ...ALIYUN_ENV });
		const third = getSmsDriver({ ...ALIYUN_ENV, [SMS_ENV_KEYS.aliyun.templateCode]: "SMS_987654321" });

		expect(first).toBe(second);
		expect(third).not.toBe(first);
		expect(third).toBeInstanceOf(AliyunSmsDriver);
	});
});

describe("describeSms", () => {
	it("未配置时给出中文说明与缺失变量", () => {
		const diagnostics = describeSms({});

		expect(diagnostics.configured).toBe(false);
		expect(diagnostics.vendor).toBeUndefined();
		expect(diagnostics.missing).toEqual(["SMS_PROVIDER"]);
		expect(diagnostics.preview).toContain("未启用短信服务");
	});

	it("配置不全时只展示已填凭证的后四位", () => {
		const diagnostics = describeSms({
			[SMS_ENV_KEYS.provider]: "aliyun",
			[SMS_ENV_KEYS.aliyun.accessKeyId]: "LTAI5tTestAccessKeyId",
			[SMS_ENV_KEYS.aliyun.accessKeySecret]: "testAccessKeySecret",
		});

		expect(diagnostics.configured).toBe(false);
		expect(diagnostics.preview).toContain("缺少 ALIYUN_SMS_SIGN_NAME、ALIYUN_SMS_TEMPLATE_CODE");
		expect(diagnostics.preview).toContain("ALIYUN_ACCESS_KEY_ID ****");
		expect(diagnostics.preview).not.toContain("LTAI5tTestAccessKeyId");
		expect(diagnostics.preview).not.toContain("testAccessKeySecret");
	});

	it("配置齐全时把诊断透传给驱动的 describe()", () => {
		const diagnostics = describeSms(ALIYUN_ENV);

		expect(diagnostics).toMatchObject({ vendor: "aliyun", configured: true, missing: [] });
		expect(diagnostics.preview).toContain("阿里云短信");
	});
});
