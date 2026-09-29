import { describe, expect, it } from "vitest";
import { isVendorSuccessCode, mapVendorError, VENDOR_SUCCESS_CODES } from "./errors-mapping";

describe("阿里云错误码映射", () => {
	const cases: Array<[string, string, string]> = [
		["isv.BUSINESS_LIMIT_CONTROL", "RATE_LIMITED", "触发短信业务流控"],
		["isv.SMS_TEMPLATE_ILLEGAL", "TEMPLATE_ILLEGAL", "短信模板不合法"],
		["isv.SMS_SIGNATURE_ILLEGAL", "SIGN_NAME_ILLEGAL", "短信签名不合法"],
		["isv.AMOUNT_NOT_ENOUGH", "INSUFFICIENT_BALANCE", "账户余额不足"],
		["isv.MOBILE_NUMBER_ILLEGAL", "INVALID_PHONE_NUMBER", "手机号码格式错误"],
		["isp.RAM_PERMISSION_DENY", "PERMISSION_DENIED", "RAM 权限不足"],
		["isv.OUT_OF_SERVICE", "SERVICE_SUSPENDED", "业务已停机"],
		["SignatureDoesNotMatch", "SIGNATURE_MISMATCH", "请求签名校验失败"],
		["InvalidAccessKeyId.NotFound", "INVALID_CREDENTIALS", "AccessKey ID 不存在"],
		["isv.BLACK_KEY_CONTROL_LIMIT", "BLACKLISTED", "黑名单管控"],
		["isv.SMS_CONTENT_ILLEGAL", "CONTENT_ILLEGAL", "短信内容包含禁止发送的内容"],
		["isv.TEMPLATE_MISSING_PARAMETERS", "TEMPLATE_PARAMS_ILLEGAL", "模板变量存在未赋值的变量"],
	];

	it.each(cases)("%s → %s", (vendorCode, code, fragment) => {
		const mapped = mapVendorError("aliyun", vendorCode);

		expect(mapped.code).toBe(code);
		expect(mapped.message).toContain(fragment);
	});

	it("返回中文文案,不含英文占位", () => {
		const mapped = mapVendorError("aliyun", "isv.AMOUNT_NOT_ENOUGH");

		expect(mapped.message).not.toMatch(/^\s*$/);
		expect(/[一-龥]/.test(mapped.message)).toBe(true);
	});
});

describe("腾讯云错误码映射", () => {
	const cases: Array<[string, string, string]> = [
		["AuthFailure.SignatureExpire", "SIGNATURE_MISMATCH", "签名已过期"],
		["AuthFailure.SecretIdNotFound", "INVALID_CREDENTIALS", "密钥不存在"],
		["AuthFailure.SignatureFailure", "SIGNATURE_MISMATCH", "签名校验失败"],
		["LimitExceeded.DeliveryFrequencyLimit", "RATE_LIMITED", "频率限制"],
		["InvalidParameterValue.IncorrectPhoneNumber", "INVALID_PHONE_NUMBER", "E.164"],
		["FailedOperation.TemplateIncorrectOrUnapproved", "TEMPLATE_ILLEGAL", "模板未审批"],
		["FailedOperation.SignatureIncorrectOrUnapproved", "SIGN_NAME_ILLEGAL", "签名未审批"],
		["FailedOperation.PhoneNumberInBlacklist", "BLACKLISTED", "免打扰名单"],
		["UnauthorizedOperation.ServiceSuspendDueToArrears", "SERVICE_SUSPENDED", "欠费"],
		["FailedOperation.InsufficientBalanceInSmsPackage", "INSUFFICIENT_BALANCE", "套餐包余量不足"],
		["UnauthorizedOperation.RequestIpNotInWhitelist", "PERMISSION_DENIED", "白名单"],
		["FailedOperation.ContainSensitiveWord", "CONTENT_ILLEGAL", "敏感词"],
	];

	it.each(cases)("%s → %s", (vendorCode, code, fragment) => {
		const mapped = mapVendorError("tencent", vendorCode);

		expect(mapped.code).toBe(code);
		expect(mapped.message).toContain(fragment);
	});
});

describe("未收录错误码的兜底", () => {
	it("阿里云:按 isv. 前缀归类并保留厂商原始错误码", () => {
		const mapped = mapVendorError("aliyun", "isv.SOME_FUTURE_CODE");

		expect(mapped.code).toBe("VENDOR_ERROR");
		expect(mapped.message).toContain("isv.SOME_FUTURE_CODE");
		expect(mapped.message).toContain("阿里云");
	});

	it("腾讯云:按 FailedOperation. 前缀归类并保留厂商原始错误码", () => {
		const mapped = mapVendorError("tencent", "FailedOperation.SomethingNew", "some english detail");

		expect(mapped.code).toBe("VENDOR_ERROR");
		expect(mapped.message).toContain("FailedOperation.SomethingNew");
		expect(mapped.message).toContain("some english detail");
		expect(mapped.message).toContain("腾讯云");
	});

	it("完全陌生的错误码仍然返回带厂商码的中文提示", () => {
		const mapped = mapVendorError("tencent", "Totally.New.Code");

		expect(mapped.code).toBe("VENDOR_ERROR");
		expect(mapped.message).toContain("Totally.New.Code");
		expect(/[一-龥]/.test(mapped.message)).toBe(true);
	});

	it("空错误码不会崩溃", () => {
		const mapped = mapVendorError("aliyun", "");

		expect(mapped.code).toBe("VENDOR_ERROR");
		expect(mapped.message).toContain("未提供");
	});
});

describe("成功码判定", () => {
	it("阿里云 OK / 腾讯云 Ok", () => {
		expect(VENDOR_SUCCESS_CODES.aliyun).toBe("OK");
		expect(VENDOR_SUCCESS_CODES.tencent).toBe("Ok");
	});

	it("大小写敏感:阿里云 OK 与腾讯云 Ok 不能互换", () => {
		expect(isVendorSuccessCode("aliyun", "OK")).toBe(true);
		expect(isVendorSuccessCode("aliyun", "Ok")).toBe(false);
		expect(isVendorSuccessCode("tencent", "Ok")).toBe(true);
		expect(isVendorSuccessCode("tencent", "OK")).toBe(false);
	});

	it("undefined 不视为成功", () => {
		expect(isVendorSuccessCode("aliyun", undefined)).toBe(false);
		expect(isVendorSuccessCode("tencent", undefined)).toBe(false);
	});
});
