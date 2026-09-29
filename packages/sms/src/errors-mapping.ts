import type { SmsErrorCode, SmsVendor } from "./types";

export type MappedVendorError = {
	code: SmsErrorCode;
	message: string;
};

/** Display names used in the fallback message. */
export const VENDOR_LABELS: Record<SmsVendor, string> = {
	aliyun: "阿里云",
	tencent: "腾讯云",
};

/**
 * 阿里云短信服务 — 国内消息 API 错误码。
 * 来源:help.aliyun.com《国内消息短信错误码》(SendSms / 2017-05-25)。
 * `isv.*` 为业务侧错误,`isp.*` 为平台侧错误,其余为 OpenAPI 网关的公共错误。
 */
const ALIYUN_ERROR_CODES: Record<string, MappedVendorError> = {
	"isv.SMS_SIGNATURE_ILLEGAL": {
		code: "SIGN_NAME_ILLEGAL",
		message: "短信签名不合法或未通过审核,请确认签名与当前 AccessKey 属于同一账号,且签名中不含空格或特殊符号。",
	},
	"isv.SMS_SIGN_ILLEGAL": {
		code: "SIGN_NAME_ILLEGAL",
		message: "该短信签名被禁止使用,请在短信服务控制台重新申请符合规范的签名。",
	},
	"isv.SIGN_NAME_ILLEGAL": {
		code: "SIGN_NAME_ILLEGAL",
		message: "签名名称不符合规范(仅支持中英文与数字,长度 2~12 个字),请重新申请签名。",
	},
	"isv.SIGN_STATE_ILLEGAL": {
		code: "SIGN_NAME_ILLEGAL",
		message: "短信签名状态为“不可用”,请在控制台查看具体原因并修正后重试。",
	},
	"isv.SMS_SIGNATURE_SCENE_ILLEGAL": {
		code: "TEMPLATE_ILLEGAL",
		message: "短信签名类型与模板类型不一致(验证码签名只能发送验证码模板),请改用通用签名或更换模板。",
	},
	"isv.SMS_TEMPLATE_ILLEGAL": {
		code: "TEMPLATE_ILLEGAL",
		message: "短信模板不合法或未通过审核,请检查模板 CODE 是否正确、模板变量是否与 TemplateParam 一致。",
	},
	"isv.TEMPLATE_MISSING_PARAMETERS": {
		code: "TEMPLATE_PARAMS_ILLEGAL",
		message: '模板变量存在未赋值的变量,请用 JSON 字符串为每个变量赋值,如 {"code":"123456"}。',
	},
	"isv.TEMPLATE_PARAMS_ILLEGAL": {
		code: "TEMPLATE_PARAMS_ILLEGAL",
		message: "模板变量内容与申请模板时选择的属性类型不匹配,请检查变量取值。",
	},
	"isv.INVALID_JSON_PARAM": {
		code: "TEMPLATE_PARAMS_ILLEGAL",
		message: '模板参数不是合法的 JSON 字符串,请传入如 {"code":"123456"} 的格式。',
	},
	"isv.PARAM_LENGTH_LIMIT": {
		code: "TEMPLATE_PARAMS_ILLEGAL",
		message: "模板变量长度超过限制(通知类 1~35 个字符,验证码类 4~6 个字符),请缩短变量取值。",
	},
	"isv.PARAM_NOT_SUPPORT_URL": {
		code: "CONTENT_ILLEGAL",
		message: "模板变量中不允许透传 URL 等受限内容,请检查变量取值。",
	},
	"isv.SMS_CONTENT_ILLEGAL": {
		code: "CONTENT_ILLEGAL",
		message: "短信内容包含禁止发送的内容,请修改文案后重试。",
	},
	"isv.UNSUPPORTED_CONTENT": {
		code: "CONTENT_ILLEGAL",
		message: "短信内容包含不支持的字符(繁体字、emoji 或非常用符号),请修改文案后重试。",
	},
	"isv.SMS_CONTENT_MISMATCH_TEMPLATE_TYPE": {
		code: "CONTENT_ILLEGAL",
		message: "短信内容与模板属性不匹配(通知模板不能发送营销文案),请使用推广短信模板。",
	},
	"isv.MOBILE_NUMBER_ILLEGAL": {
		code: "INVALID_PHONE_NUMBER",
		message: "手机号码格式错误,国内号码请传入 11 位号码或带 +86 前缀的号码。",
	},
	"isv.MOBILE_COUNT_OVER_LIMIT": {
		code: "VENDOR_ERROR",
		message: "单次请求携带的手机号码数量超出限制(SendSms 上限 1000 个)。",
	},
	"isv.BUSINESS_LIMIT_CONTROL": {
		code: "RATE_LIMITED",
		message: "触发短信业务流控(同一号码发送过于频繁),请稍后再试。",
	},
	"isv.DAY_LIMIT_CONTROL": {
		code: "RATE_LIMITED",
		message: "已达到控制台设置的短信日发送量限额,请调整限额或次日再试。",
	},
	"isv.MONTH_LIMIT_CONTROL": {
		code: "RATE_LIMITED",
		message: "已达到控制台设置的短信月发送量限额,请调整限额或次月再试。",
	},
	"isv.BLACK_KEY_CONTROL_LIMIT": {
		code: "BLACKLISTED",
		message: "该号码命中黑名单管控(曾有退订或投诉记录),无法下发该类短信。",
	},
	"isv.CUSTOMER_REFUSED": {
		code: "BLACKLISTED",
		message: "该用户已退订此推广短信,请勿重复下发。",
	},
	"isv.AMOUNT_NOT_ENOUGH": {
		code: "INSUFFICIENT_BALANCE",
		message: "阿里云账户余额不足,请充值后重试。",
	},
	"isv.OUT_OF_SERVICE": {
		code: "SERVICE_SUSPENDED",
		message: "短信业务已停机(通常为余额不足),请充值后重试。",
	},
	"isv.PRODUCT_UN_SUBSCRIPT": {
		code: "SERVICE_SUSPENDED",
		message: "该 AccessKey 所属账号尚未开通云通信短信服务,请先开通短信服务。",
	},
	"isv.PRODUCT_UNSUBSCRIBE": {
		code: "SERVICE_SUSPENDED",
		message: "该 AccessKey 所属账号未开通当前接口对应的产品,请开通后重试。",
	},
	"isv.ACCOUNT_NOT_EXISTS": {
		code: "INVALID_CREDENTIALS",
		message: "账户不存在,请确认 AccessKey 归属账号是否正确。",
	},
	"isv.ACCOUNT_ABNORMAL": {
		code: "INVALID_CREDENTIALS",
		message: "账户状态异常,请联系阿里云短信服务核实计费状态。",
	},
	"isv.INVALID_PARAMETERS": {
		code: "VENDOR_ERROR",
		message: "接口参数格式不正确,请对照 SendSms 接口文档检查参数。",
	},
	"isv.DENY_IP_RANGE": {
		code: "PERMISSION_DENIED",
		message: "来源 IP 所在地区被禁用,发送中国内地短信需使用中国内地 IP 调用。",
	},
	"isp.RAM_PERMISSION_DENY": {
		code: "PERMISSION_DENIED",
		message: "RAM 权限不足,请为当前 AccessKey 对应的 RAM 用户授予 AliyunDysmsFullAccess。",
	},
	"isp.SYSTEM_ERROR": {
		code: "VENDOR_ERROR",
		message: "阿里云短信服务系统繁忙,请稍后重试。",
	},
	"isp.GATEWAY_ERROR": {
		code: "NETWORK_ERROR",
		message: "调用短信发送网关失败,请稍后重试。",
	},
	SignatureDoesNotMatch: {
		code: "SIGNATURE_MISMATCH",
		message: "请求签名校验失败,请检查 AccessKey Secret 是否正确、是否夹带多余空格或换行。",
	},
	"InvalidAccessKeyId.NotFound": {
		code: "INVALID_CREDENTIALS",
		message: "AccessKey ID 不存在、已被禁用或删除,请更换密钥。",
	},
	MissingAccessKeyId: {
		code: "INVALID_CREDENTIALS",
		message: "请求缺少 AccessKeyId,请检查短信服务的密钥配置。",
	},
	"InvalidTimeStamp.Expired": {
		code: "SIGNATURE_MISMATCH",
		message: "请求时间戳已过期,请使用 GMT 时间并确保与服务端相差不超过 15 分钟。",
	},
	SignatureNonceUsed: {
		code: "SIGNATURE_MISMATCH",
		message: "SignatureNonce 已被使用,每次请求请使用不同的随机数。",
	},
	InvalidVersion: {
		code: "VENDOR_ERROR",
		message: "API 版本号错误,阿里云短信服务的版本号应为 2017-05-25。",
	},
	"InvalidAction.NotFound": {
		code: "VENDOR_ERROR",
		message: "未找到指定的 API,请检查 Action 是否为 SendSms。",
	},
	Throttling: {
		code: "RATE_LIMITED",
		message: "请求被阿里云网关限流,请降低调用频率后重试。",
	},
	"Throttling.User": {
		code: "RATE_LIMITED",
		message: "当前账号请求被限流,请降低调用频率后重试。",
	},
	InternalError: {
		code: "VENDOR_ERROR",
		message: "阿里云短信服务内部错误,请稍后重试。",
	},
	// 以下是状态回执中常见的运营商/平台码,调用 QuerySendDetails 或订阅回执时会遇到。
	MOBILE_SEND_LIMIT: {
		code: "RATE_LIMITED",
		message: "该号码已触发日/月发送上限或频繁发送限制,请稍后再试。",
	},
	MOBILE_IN_BLACK: {
		code: "BLACKLISTED",
		message: "该号码位于运营商黑名单中(通常为已退订),无法下发。",
	},
	MOBILE_NOT_ON_SERVICE: {
		code: "INVALID_PHONE_NUMBER",
		message: "该号码状态异常(停机、空号、关机或不在服务区),请核实号码状态。",
	},
	INVALID_NUMBER: {
		code: "INVALID_PHONE_NUMBER",
		message: "号码状态异常或格式错误,请核实号码是否正确。",
	},
	CONTENT_KEYWORD: {
		code: "CONTENT_ILLEGAL",
		message: "短信内容命中运营商关键字拦截,请修改文案后重试。",
	},
	IS_CLOSE: {
		code: "SERVICE_SUSPENDED",
		message: "短信下发通道被关停,请稍后重试或更换通道。",
	},
};

/**
 * 腾讯云短信 — 公共错误码 + 短信业务错误码(SendSms / 2021-01-11)。
 * 来源:cloud.tencent.com《短信 错误码》与《短信发送和回执状态错误码》。
 */
const TENCENT_ERROR_CODES: Record<string, MappedVendorError> = {
	"AuthFailure.SignatureFailure": {
		code: "SIGNATURE_MISMATCH",
		message: "签名校验失败,请检查 SecretId / SecretKey 与签名计算过程。",
	},
	"AuthFailure.SignatureExpire": {
		code: "SIGNATURE_MISMATCH",
		message: "签名已过期,请检查服务器时间是否与标准时间同步(相差不得超过 5 分钟)。",
	},
	"AuthFailure.InvalidSecretId": {
		code: "INVALID_CREDENTIALS",
		message: "密钥非法(不是云 API 密钥类型),请检查 SecretId 是否填写正确。",
	},
	"AuthFailure.SecretIdNotFound": {
		code: "INVALID_CREDENTIALS",
		message: "密钥不存在,请检查 SecretId 是否已被删除或禁用,并确认前后无空格。",
	},
	"AuthFailure.InvalidAuthorization": {
		code: "SIGNATURE_MISMATCH",
		message: "Authorization 请求头不符合腾讯云标准,请检查签名拼接格式。",
	},
	"AuthFailure.MFAFailure": {
		code: "PERMISSION_DENIED",
		message: "MFA 校验失败,请检查账号的安全校验设置。",
	},
	"AuthFailure.TokenFailure": {
		code: "PERMISSION_DENIED",
		message: "临时密钥 token 错误,请检查 X-TC-Token 是否有效。",
	},
	"AuthFailure.UnauthorizedOperation": {
		code: "PERMISSION_DENIED",
		message: "请求未授权,请检查 CAM 策略是否授予短信发送权限。",
	},
	"AuthFailure.RequestLimitExceeded": {
		code: "RATE_LIMITED",
		message: "请求频率超过限制,请降低调用频率后重试。",
	},
	RequestLimitExceeded: {
		code: "RATE_LIMITED",
		message: "请求次数超过频率限制,请降低调用频率后重试。",
	},
	"RequestLimitExceeded.IPLimitExceeded": {
		code: "RATE_LIMITED",
		message: "当前 IP 的请求频率超过限制,请稍后再试。",
	},
	"RequestLimitExceeded.UinLimitExceeded": {
		code: "RATE_LIMITED",
		message: "主账号的请求频率超过限制,请稍后再试。",
	},
	"RequestLimitExceeded.GlobalRegionUinLimitExceeded": {
		code: "RATE_LIMITED",
		message: "主账号在地域维度的请求频率超过限制,请稍后再试。",
	},
	"LimitExceeded.DeliveryFrequencyLimit": {
		code: "RATE_LIMITED",
		message: "下发短信命中频率限制策略,可到控制台调整短信频率限制策略后重试。",
	},
	"LimitExceeded.AppDailyLimit": {
		code: "RATE_LIMITED",
		message: "业务短信日下发条数超过设定上限,请到控制台调整发送总量阈值。",
	},
	"LimitExceeded.AppMainlandChinaDailyLimit": {
		code: "RATE_LIMITED",
		message: "业务短信中国大陆日下发条数超过设定上限,请到控制台调整发送总量阈值。",
	},
	"LimitExceeded.AppGlobalDailyLimit": {
		code: "RATE_LIMITED",
		message: "业务短信国际/港澳台日下发条数超过设定上限,请到控制台调整发送总量阈值。",
	},
	"LimitExceeded.DailyLimit": {
		code: "RATE_LIMITED",
		message: "国际/港澳台短信日下发条数超过设定上限,如需调整请联系腾讯云短信小助手。",
	},
	"LimitExceeded.PhoneNumberThirtySecondLimit": {
		code: "RATE_LIMITED",
		message: "单个手机号 30 秒内下发短信条数超过上限,请稍后再试。",
	},
	"LimitExceeded.PhoneNumberOneHourLimit": {
		code: "RATE_LIMITED",
		message: "单个手机号 1 小时内下发短信条数超过上限,请稍后再试。",
	},
	"LimitExceeded.PhoneNumberDailyLimit": {
		code: "RATE_LIMITED",
		message: "单个手机号日下发条数超过上限,请明天再试。",
	},
	"LimitExceeded.PhoneNumberSameContentDailyLimit": {
		code: "RATE_LIMITED",
		message: "单个手机号下发相同内容的条数超过上限,请更换内容或稍后再试。",
	},
	"LimitExceeded.PhoneNumberCountLimit": {
		code: "VENDOR_ERROR",
		message: "单次提交的手机号个数超过 200 个,请拆分请求。",
	},
	"LimitExceeded.AppCountryOrRegionInBlacklist": {
		code: "BLACKLISTED",
		message: "该国家/地区不在国际港澳台短信发送限制的白名单中,请到控制台调整。",
	},
	"LimitExceeded.AppCountryOrRegionDailyLimit": {
		code: "RATE_LIMITED",
		message: "该国家/地区日下发条数超过上限,请到控制台调整。",
	},
	"LimitExceeded.GlobalSmsSendingRateLimit": {
		code: "RATE_LIMITED",
		message: "国际短信发送速率超限,请降低发送速率后重试。",
	},
	"InvalidParameterValue.IncorrectPhoneNumber": {
		code: "INVALID_PHONE_NUMBER",
		message: "手机号格式错误,请使用 E.164 格式,例如 +8618501234444。",
	},
	"InvalidParameterValue.SdkAppIdNotExist": {
		code: "VENDOR_ERROR",
		message: "SdkAppId 不存在,请检查该应用 ID 是否属于当前账号。",
	},
	"InvalidParameterValue.ContentLengthLimit": {
		code: "CONTENT_ILLEGAL",
		message: "短信内容过长,请参考国内短信内容长度计算规则精简文案。",
	},
	"InvalidParameterValue.TemplateParameterFormatError": {
		code: "TEMPLATE_PARAMS_ILLEGAL",
		message: "验证码模板参数格式错误,模板变量只能传入 0~6 位纯数字。",
	},
	"InvalidParameterValue.TemplateParameterLengthLimit": {
		code: "TEMPLATE_PARAMS_ILLEGAL",
		message: "单个模板变量字符数超过限制,请缩短变量取值。",
	},
	"InvalidParameterValue.ProhibitedUseUrlInTemplateParameter": {
		code: "CONTENT_ILLEGAL",
		message: "禁止在模板变量中使用 URL,请修改变量取值。",
	},
	"FailedOperation.SignatureIncorrectOrUnapproved": {
		code: "SIGN_NAME_ILLEGAL",
		message: "短信签名未审批或格式错误(签名仅支持中英文与数字,长度 2~12 个字),请到控制台检查签名。",
	},
	"FailedOperation.TemplateIncorrectOrUnapproved": {
		code: "TEMPLATE_ILLEGAL",
		message: "短信模板未审批或内容与审核通过的模板不匹配,请到控制台检查模板。",
	},
	"FailedOperation.TemplateUnapprovedOrNotExist": {
		code: "TEMPLATE_ILLEGAL",
		message: "短信模板未审批或不存在,请到控制台检查模板 ID。",
	},
	"FailedOperation.TemplateParamSetNotMatchApprovedTemplate": {
		code: "TEMPLATE_PARAMS_ILLEGAL",
		message: "模板参数个数与审核通过的模板不一致,请检查 TemplateParamSet。",
	},
	"FailedOperation.ContainSensitiveWord": {
		code: "CONTENT_ILLEGAL",
		message: "短信内容中含有敏感词,请修改文案后重试。",
	},
	"FailedOperation.PhoneNumberInBlacklist": {
		code: "BLACKLISTED",
		message: "该手机号位于免打扰名单库中(用户退订或命中运营商免打扰名单),无法下发。",
	},
	"FailedOperation.MarketingSendTimeConstraint": {
		code: "VENDOR_ERROR",
		message: "营销短信仅允许在 8:00~22:00 发送,请调整发送时间。",
	},
	"FailedOperation.InsufficientBalanceInSmsPackage": {
		code: "INSUFFICIENT_BALANCE",
		message: "短信套餐包余量不足,请购买套餐包后重试。",
	},
	"FailedOperation.FailResolvePacket": {
		code: "VENDOR_ERROR",
		message: "请求包解析失败,请检查请求体是否符合 SendSms 接口规范。",
	},
	"FailedOperation.JsonParseFail": {
		code: "VENDOR_ERROR",
		message: "请求包体 JSON 解析失败,请检查请求体格式。",
	},
	"UnauthorizedOperation.SdkAppIdIsDisabled": {
		code: "SERVICE_SUSPENDED",
		message: "此 SdkAppId 已被禁止提供服务,请联系腾讯云短信小助手。",
	},
	"UnauthorizedOperation.ServiceSuspendDueToArrears": {
		code: "SERVICE_SUSPENDED",
		message: "账号欠费,短信服务已停止,请充值后重试。",
	},
	"UnauthorizedOperation.RequestPermissionDeny": {
		code: "PERMISSION_DENIED",
		message: "请求没有权限,请联系腾讯云短信小助手开通短信发送权限。",
	},
	"UnauthorizedOperation.RequestIpNotInWhitelist": {
		code: "PERMISSION_DENIED",
		message: "请求 IP 不在白名单中,请到控制台调整来源 IP 校验配置。",
	},
	"UnauthorizedOperation.IndividualUserMarketingSmsPermissionDeny": {
		code: "PERMISSION_DENIED",
		message: "个人认证用户没有发送营销短信的权限,请完成企业认证。",
	},
	"InternalError.RequestTimeException": {
		code: "SIGNATURE_MISMATCH",
		message: "请求发起时间异常,服务器时间与腾讯云时间相差超过 10 分钟,请校准服务器时间。",
	},
	"InternalError.SigVerificationFail": {
		code: "SIGNATURE_MISMATCH",
		message: "服务端校验签名失败,请检查签名计算过程。",
	},
	"InternalError.SigFieldMissing": {
		code: "SIGNATURE_MISMATCH",
		message: "请求包体缺少签名字段或签名为空,请检查请求头。",
	},
	"InternalError.Timeout": {
		code: "NETWORK_ERROR",
		message: "请求下发短信超时,请稍后重试。",
	},
	"InternalError.SendAndRecvFail": {
		code: "NETWORK_ERROR",
		message: "接口超时或短信收发包超时,请检查网络后重试。",
	},
	"InternalError.RestApiInterfaceNotExist": {
		code: "VENDOR_ERROR",
		message: "不存在该 REST API 接口,请核查接口说明。",
	},
	"InternalError.UnknownError": {
		code: "VENDOR_ERROR",
		message: "腾讯云短信服务返回未知错误,请稍后重试。",
	},
	"InternalError.OtherError": {
		code: "VENDOR_ERROR",
		message: "腾讯云短信服务其他错误,请联系腾讯云短信小助手并提供失败手机号。",
	},
	InvalidAction: {
		code: "VENDOR_ERROR",
		message: "接口不存在,请检查 X-TC-Action 是否为 SendSms。",
	},
	InvalidParameter: {
		code: "VENDOR_ERROR",
		message: "请求参数错误(格式或类型不正确),请对照接口文档检查参数。",
	},
	InvalidParameterValue: {
		code: "VENDOR_ERROR",
		message: "请求参数取值错误,请检查参数取值。",
	},
	MissingParameter: {
		code: "VENDOR_ERROR",
		message: "请求缺少必填参数,请检查 SmsSdkAppId / TemplateId / SignName 等字段。",
	},
	UnknownParameter: {
		code: "VENDOR_ERROR",
		message: "请求包含未定义的参数,请移除多余字段。",
	},
	UnsupportedOperation: {
		code: "VENDOR_ERROR",
		message: "当前操作不支持,请检查请求内容。",
	},
	"UnsupportedOperation.ContainDomesticAndInternationalPhoneNumber": {
		code: "VENDOR_ERROR",
		message: "单次请求中既有中国大陆手机号也有国际/港澳台手机号,请分开发送。",
	},
	"UnsupportedOperation.UnsupportedRegion": {
		code: "VENDOR_ERROR",
		message: "不支持该地区的短信下发,请更换地域或目标号码。",
	},
	"UnsupportedOperation.ChineseMainlandTemplateToGlobalPhone": {
		code: "VENDOR_ERROR",
		message: "国内短信模板不支持发送国际/港澳台手机号,请改用国际/港澳台模板。",
	},
	"UnsupportedOperation.GlobalTemplateToChineseMainlandPhone": {
		code: "VENDOR_ERROR",
		message: "国际/港澳台短信模板不支持发送国内手机号,请改用国内模板。",
	},
	DryRunOperation: {
		code: "VENDOR_ERROR",
		message: "DryRun 校验通过(未真实发送),请移除 DryRun 参数。",
	},
	NoSuchVersion: {
		code: "VENDOR_ERROR",
		message: "接口版本不存在,腾讯云短信的版本应为 2021-01-11。",
	},
	ServiceUnavailable: {
		code: "SERVICE_SUSPENDED",
		message: "腾讯云短信服务当前不可用,请稍后重试。",
	},
	ResourceInsufficient: {
		code: "INSUFFICIENT_BALANCE",
		message: "资源不足(通常为套餐包余量不足),请购买套餐包后重试。",
	},
	IpInBlacklist: {
		code: "PERMISSION_DENIED",
		message: "请求 IP 位于黑名单中,请更换出口 IP 或联系腾讯云。",
	},
	IpNotInWhitelist: {
		code: "PERMISSION_DENIED",
		message: "请求 IP 不在白名单中,请到控制台添加来源 IP。",
	},
};

/**
 * 前缀兜底规则:厂商随时会新增子错误码,精确表命中不了时按前缀归类,
 * 保证"未收录的码也能返回一个有意义的中文类别",而不是落到 UNKNOWN。
 */
const ALIYUN_PREFIX_RULES: ReadonlyArray<readonly [string, SmsErrorCode, string]> = [
	["isv.SMS_SIGN", "SIGN_NAME_ILLEGAL", "短信签名不可用或未通过审核,请到短信服务控制台检查签名状态。"],
	["isv.SIGN", "SIGN_NAME_ILLEGAL", "短信签名不合法,请到短信服务控制台检查签名。"],
	["isv.TEMPLATE", "TEMPLATE_PARAMS_ILLEGAL", "短信模板参数不合法,请检查模板变量与传参是否一致。"],
	["isv.PARAM", "TEMPLATE_PARAMS_ILLEGAL", "短信模板参数不合法,请检查模板变量取值。"],
	["isv.MOBILE", "INVALID_PHONE_NUMBER", "手机号码不合法或超出数量限制,请检查接收号码。"],
	["isv.AMOUNT", "INSUFFICIENT_BALANCE", "账户余额不足,请充值后重试。"],
	["isp.", "VENDOR_ERROR", "阿里云短信服务平台侧错误,请稍后重试。"],
	["isv.", "VENDOR_ERROR", "阿里云短信业务侧错误,请登录短信服务控制台查看发送记录。"],
];

const TENCENT_PREFIX_RULES: ReadonlyArray<readonly [string, SmsErrorCode, string]> = [
	["AuthFailure.", "INVALID_CREDENTIALS", "腾讯云鉴权失败,请检查 SecretId / SecretKey 与服务器时间。"],
	["LimitExceeded.", "RATE_LIMITED", "短信发送触发腾讯云限频或限额策略,请稍后再试。"],
	["RequestLimitExceeded.", "RATE_LIMITED", "请求频率超过腾讯云限制,请降低调用频率后重试。"],
	["InvalidParameterValue.", "VENDOR_ERROR", "腾讯云短信参数取值错误,请检查模板参数与手机号格式。"],
	["InvalidParameter.", "VENDOR_ERROR", "腾讯云短信参数错误,请对照接口文档检查参数。"],
	["FailedOperation.", "VENDOR_ERROR", "腾讯云短信下发失败,请到控制台查看发送记录。"],
	["InternalError.", "VENDOR_ERROR", "腾讯云短信服务内部错误,请稍后重试。"],
	["UnauthorizedOperation.", "PERMISSION_DENIED", "腾讯云短信未授权,请检查 CAM 权限与 IP 白名单。"],
	["UnsupportedOperation.", "VENDOR_ERROR", "腾讯云短信不支持该操作,请检查请求内容。"],
];

const VENDOR_CODES: Record<SmsVendor, Record<string, MappedVendorError>> = {
	aliyun: ALIYUN_ERROR_CODES,
	tencent: TENCENT_ERROR_CODES,
};

const VENDOR_PREFIX_RULES: Record<SmsVendor, ReadonlyArray<readonly [string, SmsErrorCode, string]>> = {
	aliyun: ALIYUN_PREFIX_RULES,
	tencent: TENCENT_PREFIX_RULES,
};

/** Vendor code that means "sent". Anything else on the success path is a failure. */
export const VENDOR_SUCCESS_CODES: Record<SmsVendor, string> = {
	aliyun: "OK",
	tencent: "Ok",
};

export const isVendorSuccessCode = (vendor: SmsVendor, vendorCode: string | undefined): boolean => {
	if (vendorCode === undefined) return false;

	return vendorCode === VENDOR_SUCCESS_CODES[vendor];
};

/** 把厂商返回的英文细节包成附加说明。 */
const describeDetail = (vendorMessage: string | undefined): string =>
	vendorMessage === undefined || vendorMessage === "" ? "" : `(${vendorMessage})`;

/**
 * Maps a vendor error code to a Chinese message plus a vendor-neutral category.
 *
 * Unmapped codes fall back to a Chinese message that still carries the vendor's own code — without
 * an enterprise account, that raw code is the only thing an operator can search the vendor console
 * for, so it must survive the mapping.
 */
export const mapVendorError = (vendor: SmsVendor, vendorCode: string, vendorMessage?: string): MappedVendorError => {
	const label = VENDOR_LABELS[vendor];
	const table = VENDOR_CODES[vendor];
	const prefixRules = VENDOR_PREFIX_RULES[vendor];

	const exact = vendorCode === "" ? undefined : table[vendorCode];
	if (exact) return exact;

	if (vendorCode !== "") {
		for (const [prefix, code, message] of prefixRules) {
			if (vendorCode.startsWith(prefix)) {
				return { code, message: `${message}${describeDetail(vendorMessage)}(错误码:${vendorCode})` };
			}
		}
	}

	return {
		code: "VENDOR_ERROR",
		message: `${label}短信发送失败${describeDetail(vendorMessage)},错误码:${vendorCode || "未提供"}。请登录${label}短信控制台核对签名、模板与账户状态,或联系服务商。`,
	};
};
