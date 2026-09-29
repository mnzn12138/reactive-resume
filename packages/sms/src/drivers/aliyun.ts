import type { SmsDiagnostics, SmsDriver, SmsSendInput, SmsSendResult } from "../types";
import { randomUUID } from "node:crypto";
import { isVendorSuccessCode, mapVendorError } from "../errors-mapping";
import { parseJsonObject } from "../json";
import { maskSecret } from "../mask";
import { normalizePhoneNumber } from "../phone";
import { formatAliyunTimestamp, signAliyunRequest } from "../signature/aliyun";

const ALIYUN_SMS_ENDPOINT = "https://dysmsapi.aliyuncs.com";
const ALIYUN_SMS_VERSION = "2017-05-25";
const ALIYUN_SMS_DEFAULT_REGION_ID = "cn-hangzhou";

export type AliyunSmsConfig = {
	accessKeyId: string;
	accessKeySecret: string;
	/** 已审核通过的短信签名名称(不是签名 ID)。 */
	signName: string;
	/** 已审核通过的模板 CODE,形如 `SMS_123456789`。 */
	templateCode: string;
	regionId?: string;
	endpoint?: string;
	/**
	 * 模板变量的取值顺序。阿里云的 TemplateParam 是 JSON 对象,顺序不影响结果,
	 * 腾讯云是数组、顺序必须与模板一致,所以这里显式给出键名顺序以避免依赖对象遍历顺序。
	 */
	templateParamKeys?: string[];
	/** 注入点:单测用桩替换,生产用 `globalThis.fetch`。 */
	fetchImpl?: typeof globalThis.fetch;
	now?: () => Date;
	nonce?: () => string;
	timeoutMs?: number;
};

type AliyunSendSmsResponse = {
	Code?: string;
	Message?: string;
	RequestId?: string;
	BizId?: string;
};

/** 按给定键名顺序取模板变量;未指定键名时沿用传入对象的键顺序。 */
const selectTemplateEntries = (
	templateParams: Readonly<Record<string, string>>,
	templateParamKeys?: string[],
): Array<readonly [string, string]> => {
	const keys = templateParamKeys ?? Object.keys(templateParams);

	return keys.map((key) => [key, templateParams[key] ?? ""] as const);
};

/**
 * 阿里云短信服务 `SendSms`(Dysmsapi 2017-05-25)驱动。
 *
 * 请求为 GET + 查询参数,签名使用 HMAC-SHA1 的 POP 公共参数签名(见 `signature/aliyun.ts`)。
 * 业务失败(如 `isv.BUSINESS_LIMIT_CONTROL`)会随 HTTP 200 一并返回,因此必须读 body 的
 * `Code` 字段判定成败,不能只看状态码。
 */
export class AliyunSmsDriver implements SmsDriver {
	readonly vendor = "aliyun" as const;

	private readonly accessKeyId: string;
	private readonly accessKeySecret: string;
	private readonly signName: string;
	private readonly templateCode: string;
	private readonly regionId: string;
	private readonly endpoint: string;
	private readonly templateParamKeys: string[] | undefined;
	private readonly timeoutMs: number;
	private readonly fetchImpl: typeof globalThis.fetch;
	private readonly clock: () => Date;
	private readonly nonceFactory: () => string;

	constructor(config: AliyunSmsConfig) {
		this.accessKeyId = config.accessKeyId;
		this.accessKeySecret = config.accessKeySecret;
		this.signName = config.signName;
		this.templateCode = config.templateCode;
		this.regionId = config.regionId ?? ALIYUN_SMS_DEFAULT_REGION_ID;
		this.endpoint = config.endpoint ?? ALIYUN_SMS_ENDPOINT;
		this.templateParamKeys = config.templateParamKeys;
		this.timeoutMs = config.timeoutMs ?? 10_000;
		this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
		this.clock = config.now ?? (() => new Date());
		this.nonceFactory = config.nonce ?? (() => randomUUID());
	}

	async send(input: SmsSendInput): Promise<SmsSendResult> {
		const phoneNumber = normalizePhoneNumber(input.phoneNumber);

		if (!phoneNumber) {
			const mapped = mapVendorError("aliyun", "isv.MOBILE_NUMBER_ILLEGAL");

			return { ok: false, code: mapped.code, vendorCode: "isv.MOBILE_NUMBER_ILLEGAL", message: mapped.message };
		}

		const templateParam = JSON.stringify(
			Object.fromEntries(selectTemplateEntries(input.templateParams, this.templateParamKeys)),
		);

		const params: Record<string, string> = {
			AccessKeyId: this.accessKeyId,
			Action: "SendSms",
			Format: "JSON",
			PhoneNumbers: phoneNumber,
			RegionId: this.regionId,
			SignName: this.signName,
			SignatureMethod: "HMAC-SHA1",
			SignatureNonce: this.nonceFactory(),
			SignatureVersion: "1.0",
			TemplateCode: this.templateCode,
			TemplateParam: templateParam,
			Timestamp: formatAliyunTimestamp(this.clock()),
			Version: ALIYUN_SMS_VERSION,
		};

		const signed = signAliyunRequest({
			httpMethod: "GET",
			endpoint: this.endpoint,
			params,
			accessKeySecret: this.accessKeySecret,
		});

		let response: Response;
		let body: string;

		try {
			response = await this.fetchImpl(signed.url, {
				method: "GET",
				headers: { accept: "application/json" },
				signal: AbortSignal.timeout(this.timeoutMs),
			});
			body = await response.text();
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);

			return {
				ok: false,
				code: "NETWORK_ERROR",
				vendorCode: "TransportError",
				message: `无法连接阿里云短信服务(网络错误或超时):${detail}`,
			};
		}

		const payload = parseJsonObject(body) as AliyunSendSmsResponse | undefined;
		const vendorCode = payload?.Code;

		if (vendorCode !== undefined) {
			if (isVendorSuccessCode("aliyun", vendorCode)) {
				const requestId = payload?.RequestId ?? "";

				return {
					ok: true,
					vendorMessageId: payload?.BizId ?? requestId,
					vendorRequestId: requestId,
				};
			}

			const mapped = mapVendorError("aliyun", vendorCode, payload?.Message);

			return { ok: false, code: mapped.code, vendorCode, message: mapped.message };
		}

		return {
			ok: false,
			code: response.ok ? "VENDOR_ERROR" : "NETWORK_ERROR",
			vendorCode: `HTTP_${response.status}`,
			message: response.ok
				? "阿里云短信服务返回了无法解析的响应体,请稍后重试。"
				: `阿里云短信服务返回 HTTP ${response.status},请稍后重试。`,
		};
	}

	describe(): SmsDiagnostics {
		return {
			vendor: "aliyun",
			configured: true,
			missing: [],
			preview: `阿里云短信 · AccessKeyId ${maskSecret(this.accessKeyId)} · 签名「${this.signName}」 · 模板 ${this.templateCode}`,
		};
	}
}
