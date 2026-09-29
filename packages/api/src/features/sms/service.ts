import type { SmsSendResult } from "@reactive-resume/sms/types";
import { ORPCError } from "@orpc/client";
import { deliverSmsCode, resolveRequestIp } from "@reactive-resume/auth/sms-otp";

/**
 * The admin-facing half of the SMS channel.
 *
 * The procedure is administrator-only (see `adminProcedure` in `../../context`):
 * `sendTest` spends real money at the vendor, which is not a capability an
 * ordinary account should have.
 *
 * Reading the vendor configuration is *not* here — it is a diagnosis, and every
 * diagnosis is served by `admin.diagnostics.get` so the console has one place to
 * look. Splitting it across both would leave two endpoints that can drift.
 *
 * Everything that actually talks to a vendor lives in
 * `@reactive-resume/auth/sms-otp`, which is the same code path a verification
 * code takes. That is deliberate: a test message must land in the same
 * `sms_send_log` and obey the same windows as a real one, otherwise the button
 * would be a way around the rate limits it is supposed to be checking.
 */

const TEST_CODE_LENGTH = 6;

/**
 * A six-digit code, generated rather than fixed so a test message is not
 * replayable as a real one and is recognisable in the vendor's delivery report.
 */
function randomTestCode(): string {
	let code = "";

	for (let index = 0; index < TEST_CODE_LENGTH; index += 1) {
		code += String(Math.floor(Math.random() * 10));
	}

	return code;
}

export const smsService = {
	sendTest: async (input: { phoneNumber: string; headers: Headers }): Promise<SmsSendResult> => {
		const delivery = await deliverSmsCode({
			phoneNumber: input.phoneNumber,
			code: randomTestCode(),
			ipAddress: resolveRequestIp(input.headers),
		});

		// A vendor refusal is returned rather than thrown: the whole point of the
		// button is to find out *why* delivery fails, and `vendorCode` is the only
		// thing an operator can look up in the vendor's console.
		if (delivery.status === "sent" || delivery.status === "failed") return delivery.result;

		// The message is `@reactive-resume/sms`'s own wording and already carries
		// the wait ("请 42 秒后再试"), so it is passed through untouched.
		if (delivery.status === "rate-limited") throw new ORPCError("TOO_MANY_REQUESTS", { message: delivery.message });

		if (delivery.status === "not-configured") {
			throw new ORPCError("BAD_REQUEST", { message: "SMS is not configured on this instance." });
		}

		throw new ORPCError("BAD_REQUEST", { message: "Invalid phone number." });
	},
};
