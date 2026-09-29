import { smsSendTestSchema } from "@reactive-resume/schema/sms";
import { adminProcedure } from "../../context";
import { smsService } from "./service";

/**
 * Tagged `Internal` like the rest of the `/admin` surface, which the OpenAPI
 * generator filters out — these endpoints must not appear in the public API docs.
 *
 * `sendTest` is the only procedure here. Reading the vendor configuration is a
 * diagnosis, not an action, so it lives with the other diagnostics under
 * `admin.diagnostics.get` — one feature, one entry point.
 */
export const smsRouter = {
	sendTest: adminProcedure
		.route({
			method: "POST",
			path: "/admin/sms/test",
			tags: ["Internal"],
			operationId: "adminSendTestSms",
			summary: "Send a test SMS",
			description:
				"Sends one test message to the given number through the configured vendor. The request goes through the same rate limits and the same send log as a verification code, so the result is what a real user would get. Administrator access required.",
			successDescription: "The vendor's own result, including its error code when delivery failed.",
		})
		.input(smsSendTestSchema)
		.handler(({ context, input }) =>
			smsService.sendTest({ phoneNumber: input.phoneNumber, headers: context.reqHeaders }),
		),
};
