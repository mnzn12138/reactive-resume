import { describe, expect, it } from "vitest";
import { isSmsError, SmsError, toSmsFailure } from "./errors";

describe("SmsError", () => {
	it("携带分类、厂商原始码与中文文案", () => {
		const error = new SmsError({
			code: "RATE_LIMITED",
			vendorCode: "isv.BUSINESS_LIMIT_CONTROL",
			message: "触发短信业务流控,请稍后再试。",
			vendor: "aliyun",
		});

		expect(error).toBeInstanceOf(Error);
		expect(error.name).toBe("SmsError");
		expect(error.code).toBe("RATE_LIMITED");
		expect(error.vendorCode).toBe("isv.BUSINESS_LIMIT_CONTROL");
		expect(error.vendor).toBe("aliyun");
		expect(error.message).toBe("触发短信业务流控,请稍后再试。");
	});

	it("toResult 转成失败结果", () => {
		const error = new SmsError({ code: "NOT_CONFIGURED", vendorCode: "SMS_NOT_CONFIGURED", message: "短信服务未配置" });

		expect(error.toResult()).toEqual({
			ok: false,
			code: "NOT_CONFIGURED",
			vendorCode: "SMS_NOT_CONFIGURED",
			message: "短信服务未配置",
		});
	});

	it("保留 cause", () => {
		const cause = new Error("socket hang up");
		const error = new SmsError({ code: "NETWORK_ERROR", vendorCode: "TransportError", message: "网络错误", cause });

		expect(error.cause).toBe(cause);
	});
});

describe("isSmsError", () => {
	it("只识别 SmsError", () => {
		expect(isSmsError(new SmsError({ code: "UNKNOWN", vendorCode: "x", message: "y" }))).toBe(true);
		expect(isSmsError(new Error("y"))).toBe(false);
		expect(isSmsError(undefined)).toBe(false);
	});
});

describe("toSmsFailure", () => {
	it("原样转换 SmsError", () => {
		const error = new SmsError({
			code: "TEMPLATE_ILLEGAL",
			vendorCode: "isv.SMS_TEMPLATE_ILLEGAL",
			message: "模板不合法",
		});

		expect(toSmsFailure(error)).toEqual({
			ok: false,
			code: "TEMPLATE_ILLEGAL",
			vendorCode: "isv.SMS_TEMPLATE_ILLEGAL",
			message: "模板不合法",
		});
	});

	it("普通 Error 回落成 UNKNOWN 且保留原始信息", () => {
		expect(toSmsFailure(new Error("boom"))).toEqual({
			ok: false,
			code: "UNKNOWN",
			vendorCode: "unknown_error",
			message: "短信发送失败:boom",
		});
	});

	it("非 Error 值也能安全转换", () => {
		expect(toSmsFailure("boom").message).toBe("短信发送失败:boom");
	});
});
