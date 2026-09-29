import z from "zod";
import { resolveInstanceSettings } from "@reactive-resume/auth/instance-settings";
import { env } from "@reactive-resume/env/server";
import { publicProcedure } from "../../context";

export type FeatureFlags = {
	disableSignups: boolean;
	disableEmailAuth: boolean;
	smtpEnabled: boolean;
	recruitmentBoardEnabled: boolean;
};

// Mirrors isSmtpEnabled() in packages/email/src/transport.ts (kept local to avoid an api -> email dependency).
// Exported so the admin settings screen reports the same value the public flags endpoint does.
export const isSmtpEnabled = () => Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS && env.SMTP_FROM);

export const flagsRouter = {
	get: publicProcedure
		.route({
			method: "GET",
			path: "/flags",
			tags: ["Feature Flags"],
			operationId: "getFeatureFlags",
			summary: "Get feature flags",
			description:
				"Returns the current feature flags for this Reactive Resume instance. Feature flags control instance-wide settings such as whether new user signups or email-based authentication are disabled, and whether the campus recruitment board is available. No authentication required.",
			successDescription: "The current feature flags for this instance.",
		})
		.output(
			z.object({
				disableSignups: z.boolean().describe("Whether new user signups are disabled on this instance."),
				disableEmailAuth: z.boolean().describe("Whether email-based authentication is disabled on this instance."),
				smtpEnabled: z.boolean().describe("Whether outbound email (SMTP) is configured on this instance."),
				recruitmentBoardEnabled: z
					.boolean()
					.describe("Whether the campus recruitment board is available on this instance."),
			}),
		)
		.handler(async (): Promise<FeatureFlags> => {
			// Resolved through the same three-tier lookup the console writes to
			// (database > environment > default), so toggling a flag in the admin UI takes
			// effect on the next page load without a restart.
			const settings = await resolveInstanceSettings();

			return {
				disableSignups: settings.disableSignups.value,
				disableEmailAuth: settings.disableEmailAuth.value,
				smtpEnabled: isSmtpEnabled(),
				recruitmentBoardEnabled: settings.recruitmentBoardEnabled.value,
			};
		}),
};
