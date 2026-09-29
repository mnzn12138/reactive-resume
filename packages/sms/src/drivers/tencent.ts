import type { SmsDiagnostics, SmsDriver, SmsSendInput, SmsSendResult } from "../types";
import { randomUUID } from "node:crypto";
import { isVendorSuccessCode, mapVendorError } from "../errors-mapping";
import { parseJsonObject } from "../json";
import { maskSecret } from "../mask";
import { normalizePhoneNumber } from "../phone";
import { signTencentRequest } from "../signature/tencent";

const TENCENT_SMS_ENDPOINT = "https://sms.tencentcloudapi.com";
const TENCENT_SMS_SERVICE = "sms";
const TENCENT_SMS_ACTION = "SendSms";
export const TENCENT_SMS_VERSION = "2021-01-11";
const TENCENT_SMS_DEFAULT_REGION = "ap-guangzhou";
export const TENCENT_SMS_CONTENT_TYPE = "application/json; charset=utf-8";

export type TencentSmsConfig = {
	secretId: string;
	secretKey: string;
	/** 短信应用 SdkAppId,形如 `1400006666`。 */
	sdkAppId: string;
	/** 已审核通过的签名内容(不是签名 ID)。 */
	signName: string;
	/** 已审核通过的模板 ID,形如 `1110`。 */
	templateId: string;
	region?: string;
	endpoint?: string;
	/** 模板变量的取值顺序,必须与模板中变量的顺序一致。 */
	templateParamKeys?: string[];
	fetchImpl?: typeof globalThis.fetch;
	now?: () => Date;
	nonce?: () => string;
	timeoutMs?: number;
};

type TencentSendStatus = {
	Code?: string;
	Message?: string;
	SerialNo?: string;
	PhoneNumber?: string;
	Fee?: number;
};

type TencentSendSmsResponse = {
	Response?: {
		SendStatusSet?: TencentSendStatus[];
		RequestId?: string;
		Error?: { Code?: string; Message?: string };
	};
};

/** 腾讯云的 TemplateParamSet 是数组,顺序必须与模板变量一致。 */
const selectTemplateValues = (
	templateParams: Readonly<Record<string, string>>,
	templateParamKeys?: string[],
): string[] => {
	const keys = templateParamKeys ?? Object.keys(templateParams);

	return keys.map((key) => templateParams[key] ?? "");
};

/**
 * 腾讯云短信 `SendSms`(2021-01-11)驱动,签名使用 TC3-HMAC-SHA256(见 `signature/tencent.ts`)。
 *
 * 与阿里云不同,腾讯云把鉴权放在请求头里:`Authorization` / `X-TC-Action` / `X-TC-Version` /
 * `X-TC-Timestamp` / `X-TC-Region`,业务参数放在 JSON body 中。参与签名的头固定为
 * `content-type`、`host`、`x-tc-action`。
 */
export class TencentSmsDriver implements SmsDriver {
	readonly vendor = "tencent" as const;

	private readonly secretId: string;
	private readonly secretKey: string;
	private readonly sdkAppId: string;
	private readonly signName: string;
	private readonly templateId: string;
	private readonly region: string;
	private readonly endpoint: string;
	private readonly templateParamKeys: string[] | undefined;
	private readonly timeoutMs: number;
	private readonly fetchImpl: typeof globalThis.fetch;
	private readonly clock: () => Date;
	private readonly nonceFactory: () => string;

	constructor(config: TencentSmsConfig) {
		this.secretId = config.secretId;
		this.secretKey = config.secretKey;
		this.sdkAppId = config.sdkAppId;
		this.signName = config.signName;
		this.templateId = config.templateId;
		this.region = config.region ?? TENCENT_SMS_DEFAULT_REGION;
		this.endpoint = config.endpoint ?? TENCENT_SMS_ENDPOINT;
		this.templateParamKeys = config.templateParamKeys;
		this.timeoutMs = config.timeoutMs ?? 10_000;
		this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
		this.clock = config.now ?? (() => new Date());
		this.nonceFactory = config.nonce ?? (() => randomUUID());
	}

	async send(input: SmsSendInput): Promise<SmsSendResult> {
		const phoneNumber = normalizePhoneNumber(input.phoneNumber);

		if (!phoneNumber) {
			const mapped = mapVendorError("tencent", "InvalidParameterValue.IncorrectPhoneNumber");

			return {
				ok: false,
				code: mapped.code,
				vendorCode: "InvalidParameterValue.IncorrectPhoneNumber",
				message: mapped.message,
			};
		}

		const payload = JSON.stringify({
			PhoneNumberSet: [phoneNumber],
			SmsSdkAppId: this.sdkAppId,
			SignName: this.signName,
			TemplateId: this.templateId,
			TemplateParamSet: selectTemplateValues(input.templateParams, this.templateParamKeys),
		});

		const timestamp = Math.floor(this.clock().getTime() / 1000);
		const host = new URL(this.endpoint).host;

		const signed = signTencentRequest({
			secretId: this.secretId,
			secretKey: this.secretKey,
			service: TENCENT_SMS_SERVICE,
			host,
			action: TENCENT_SMS_ACTION,
			payload,
			timestamp,
			contentType: TENCENT_SMS_CONTENT_TYPE,
		});

		let response: Response;
		let body: string;

		try {
			response = await this.fetchImpl(this.endpoint, {
				method: "POST",
				headers: {
					"content-type": TENCENT_SMS_CONTENT_TYPE,
					authorization: signed.authorization,
					"x-tc-action": TENCENT_SMS_ACTION,
					"x-tc-version": TENCENT_SMS_VERSION,
					"x-tc-region": this.region,
					"x-tc-timestamp": String(signed.timestamp),
					"x-tc-nonce": this.nonceFactory(),
					accept: "application/json",
				},
				body: payload,
				signal: AbortSignal.timeout(this.timeoutMs),
			});
			body = await response.text();
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);

			return {
				ok: false,
				code: "NETWORK_ERROR",
				vendorCode: "TransportError",
				message: `无法连接腾讯云短信服务(网络错误或超时):${detail}`,
			};
		}

		const parsed = parseJsonObject(body) as TencentSendSmsResponse | undefined;
		const envelope = parsed?.Response;
		const errorCode = envelope?.Error?.Code;

		if (errorCode !== undefined) {
			const mapped = mapVendorError("tencent", errorCode, envelope?.Error?.Message);

			return { ok: false, code: mapped.code, vendorCode: errorCode, message: mapped.message };
		}

		const requestId = envelope?.RequestId ?? "";
		const status = envelope?.SendStatusSet?.[0];
		const statusCode = status?.Code;

		if (statusCode !== undefined && isVendorSuccessCode("tencent", statusCode)) {
			return {
				ok: true,
				vendorMessageId: status?.SerialNo === undefined || status.SerialNo === "" ? requestId : status.SerialNo,
				vendorRequestId: requestId,
			};
		}

		if (statusCode !== undefined) {
			const mapped = mapVendorError("tencent", statusCode, status?.Message);

			return { ok: false, code: mapped.code, vendorCode: statusCode, message: mapped.message };
		}

		return {
			ok: false,
			code: response.ok ? "VENDOR_ERROR" : "NETWORK_ERROR",
			vendorCode: `HTTP_${response.status}`,
			message: response.ok
				? "腾讯云短信服务未返回发送状态,请稍后重试。"
				: `腾讯云短信服务返回 HTTP ${response.status},请稍后重试。`,
		};
	}

	describe(): SmsDiagnostics {
		return {
			vendor: "tencent",
			configured: true,
			missing: [],
			preview: `腾讯云短信 · SecretId ${maskSecret(this.secretId)} · SdkAppId ${this.sdkAppId} · 签名「${this.signName}」 · 模板 ${this.templateId}`,
		};
	}
}
