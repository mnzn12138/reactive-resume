import type { SmsErrorCode, SmsSendFailure, SmsVendor } from "./types";

export type SmsErrorOptions = {
	code: SmsErrorCode;
	vendorCode: string;
	message: string;
	vendor?: SmsVendor | undefined;
	cause?: unknown;
};

/**
 * Thrown by `sendOTP` (auth side) so that failures carry both the vendor-neutral category and the
 * vendor's own code. Drivers themselves return {@link SmsSendFailure}; this class is the throwable
 * form consumed by better-auth hooks and the admin procedure.
 */
export class SmsError extends Error {
	readonly code: SmsErrorCode;
	readonly vendorCode: string;
	readonly vendor: SmsVendor | undefined;

	constructor(options: SmsErrorOptions) {
		super(options.message, options.cause === undefined ? {} : { cause: options.cause });

		this.name = "SmsError";
		this.code = options.code;
		this.vendorCode = options.vendorCode;
		this.vendor = options.vendor;
	}

	toResult(): SmsSendFailure {
		return { ok: false, code: this.code, vendorCode: this.vendorCode, message: this.message };
	}
}

export const isSmsError = (error: unknown): error is SmsError => error instanceof SmsError;

/** Normalises anything thrown while sending into a failure result, so no request crashes. */
export const toSmsFailure = (error: unknown): SmsSendFailure => {
	if (isSmsError(error)) return error.toResult();

	const detail = error instanceof Error ? error.message : String(error);

	return { ok: false, code: "UNKNOWN", vendorCode: "unknown_error", message: `短信发送失败:${detail}` };
};
