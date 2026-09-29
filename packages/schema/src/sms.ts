import { z } from "zod";

/**
 * Request shapes for the SMS channel.
 *
 * Kept here, next to `legal.ts`, so the admin console and the server agree on one
 * definition — the same reason every other oRPC input lives in this package.
 */

/**
 * What the admin console posts to send one test message.
 *
 * The number is validated loosely (length only): `normalizePhoneNumber` in
 * `@reactive-resume/sms` is the single place that decides what a real number is,
 * and duplicating its rules here would let the two drift apart.
 */
export const smsSendTestSchema = z.object({
	phoneNumber: z
		.string()
		.trim()
		.min(5)
		.max(32)
		.describe("The number to send the test message to, in any format `normalizePhoneNumber` accepts."),
});

export type SmsSendTest = z.infer<typeof smsSendTestSchema>;
