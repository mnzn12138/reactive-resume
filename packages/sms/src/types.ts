/**
 * Shared contracts for the SMS package.
 *
 * Every driver in this package (阿里云 / 腾讯云) implements {@link SmsDriver} so that callers —
 * the `phoneNumber` plugin's `sendOTP` callback and the admin diagnostics procedure — never see
 * vendor specific shapes.
 */

/** Vendor identifier. Kept as a closed union so `switch` statements stay exhaustive. */
export type SmsVendor = "aliyun" | "tencent";

/**
 * Vendor-neutral failure categories. The vendor's own code is always carried alongside as
 * `vendorCode`, because without corporate credentials the vendor code is the only thing an
 * operator can act on.
 */
export type SmsErrorCode =
	| "NOT_CONFIGURED"
	| "INVALID_PHONE_NUMBER"
	| "INVALID_CREDENTIALS"
	| "SIGNATURE_MISMATCH"
	| "RATE_LIMITED"
	| "TEMPLATE_ILLEGAL"
	| "SIGN_NAME_ILLEGAL"
	| "TEMPLATE_PARAMS_ILLEGAL"
	| "CONTENT_ILLEGAL"
	| "BLACKLISTED"
	| "INSUFFICIENT_BALANCE"
	| "SERVICE_SUSPENDED"
	| "PERMISSION_DENIED"
	| "NETWORK_ERROR"
	| "VENDOR_ERROR"
	| "UNKNOWN";

export type SmsSendInput = {
	/** Any format accepted by {@link normalizePhoneNumber}; the driver normalises to E.164. */
	phoneNumber: string;
	/** Template variables, e.g. `{ code: "123456" }`. */
	templateParams: Record<string, string>;
};

export type SmsSendSuccess = {
	ok: true;
	/** Vendor-side message id: 阿里云 `BizId`, 腾讯云 `SerialNo`. */
	vendorMessageId: string;
	/** Vendor-side request id, used when filing a support ticket. */
	vendorRequestId: string;
};

export type SmsSendFailure = {
	ok: false;
	code: SmsErrorCode;
	/** Raw vendor error code, e.g. `isv.BUSINESS_LIMIT_CONTROL`. */
	vendorCode: string;
	/** Chinese message that is safe to surface to an end user or an administrator. */
	message: string;
};

export type SmsSendResult = SmsSendSuccess | SmsSendFailure;

/**
 * Self-check payload exposed to the admin console. Mirrors the "三项齐全才启用" rule: when
 * `configured` is false, `missing` names the exact environment variables that are absent.
 */
export type SmsDiagnostics = {
	vendor: SmsVendor | undefined;
	configured: boolean;
	/** Environment variable names that are missing or empty. */
	missing: string[];
	/** Human readable summary; secrets are masked down to their last four characters. */
	preview: string;
};

export interface SmsDriver {
	readonly vendor: SmsVendor;

	/**
	 * Sends one templated SMS. Never throws for vendor level failures — those come back as
	 * {@link SmsSendFailure} so the caller can decide whether to throw or to degrade gracefully.
	 */
	send(input: SmsSendInput): Promise<SmsSendResult>;

	/** Cheap, side-effect free self description used by the admin diagnostics card. */
	describe(): SmsDiagnostics;
}
