import type { AuthProvider } from "@reactive-resume/auth/types";
import { ORPCError } from "@orpc/client";
import { eq } from "drizzle-orm";
import { resolveInstanceSettings } from "@reactive-resume/auth/instance-settings";
import { db } from "@reactive-resume/db/client";
import * as schema from "@reactive-resume/db/schema";
import { env } from "@reactive-resume/env/server";
import { resolveSmsConfig } from "@reactive-resume/sms/drivers";
import { getStorageService } from "../storage/service";

export type ProviderList = Partial<Record<AuthProvider, string>>;

/** Which domestic channels a runtime switch has closed. */
type DisabledFlags = Record<"wechat" | "alipay" | "phone", boolean>;

/**
 * Nothing here enforces anything: the switch that actually closes an endpoint is
 * `hooks.before` inside Better Auth, and it runs whether or not the button was
 * ever rendered. So when the flags cannot be read we **fail open** and keep the
 * provider in the list. Showing a button that then refuses to work is an
 * annoyance; hiding a button for a channel that still works strands users who
 * have no other way in.
 */
const NO_FLAGS: DisabledFlags = { wechat: false, alipay: false, phone: false };

async function resolveDisabledFlags(): Promise<DisabledFlags> {
	try {
		const settings = await resolveInstanceSettings();

		return {
			wechat: settings.disableWechatAuth.value,
			alipay: settings.disableAlipayAuth.value,
			phone: settings.disableSmsAuth.value,
		};
	} catch (error) {
		console.error("[auth/providers] falling back to no runtime overrides", error);
		return { ...NO_FLAGS };
	}
}

const providers = {
	/**
	 * Which sign-in buttons the web app should offer.
	 *
	 * Two conditions, not one: a provider needs its credentials *and* it must not
	 * have been switched off at runtime. The credentials half mirrors exactly what
	 * the auth package uses to decide whether to register the plugin at all, so
	 * the button the web app renders and the endpoint that serves it can never
	 * disagree. The switch half is what lets an administrator close a channel
	 * without restarting the instance.
	 */
	list: async (): Promise<ProviderList> => {
		const list: ProviderList = { credential: "Password", passkey: "Passkey" };

		if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) list.google = "Google";
		if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) list.github = "GitHub";
		if (env.LINKEDIN_CLIENT_ID && env.LINKEDIN_CLIENT_SECRET) list.linkedin = "LinkedIn";
		if (env.OAUTH_CLIENT_ID && env.OAUTH_CLIENT_SECRET) list.custom = env.OAUTH_PROVIDER_NAME ?? "Custom OAuth";

		const disabled = await resolveDisabledFlags();

		if (env.WECHAT_APP_ID && env.WECHAT_APP_SECRET && !disabled.wechat) list.wechat = "WeChat";
		if (env.ALIPAY_APP_ID && env.ALIPAY_PRIVATE_KEY && env.ALIPAY_PUBLIC_KEY && !disabled.alipay) {
			list.alipay = "Alipay";
		}
		// Same "all credentials present" rule the auth package uses to decide
		// whether to register the plugin at all, so the button the web app renders
		// and the endpoint that serves it can never disagree.
		if (resolveSmsConfig().configured && !disabled.phone) list.phone = "Phone";

		return list;
	},
};

export const authService = {
	providers,

	// GDPR-style export of everything the user owns. Selects explicit columns so
	// secrets (password hashes, tokens, api keys) never leak into the export.
	exportData: async (input: { userId: string }) => {
		const [userRecord] = await db
			.select({
				id: schema.user.id,
				name: schema.user.name,
				email: schema.user.email,
				username: schema.user.username,
				displayUsername: schema.user.displayUsername,
				image: schema.user.image,
				emailVerified: schema.user.emailVerified,
				createdAt: schema.user.createdAt,
				updatedAt: schema.user.updatedAt,
			})
			.from(schema.user)
			.where(eq(schema.user.id, input.userId));

		if (!userRecord) throw new ORPCError("NOT_FOUND");

		const resumes = await db
			.select({
				id: schema.resume.id,
				name: schema.resume.name,
				slug: schema.resume.slug,
				tags: schema.resume.tags,
				data: schema.resume.data,
				isPublic: schema.resume.isPublic,
				showDownloadButtons: schema.resume.showDownloadButtons,
				isLocked: schema.resume.isLocked,
				createdAt: schema.resume.createdAt,
				updatedAt: schema.resume.updatedAt,
			})
			.from(schema.resume)
			.where(eq(schema.resume.userId, input.userId));

		return {
			exportedAt: new Date().toISOString(),
			user: userRecord,
			resumes,
		};
	},

	deleteAccount: async (input: { userId: string }): Promise<void> => {
		const storageService = getStorageService();

		// Delete all user files in one call (pictures, screenshots, pdfs)
		// The storage service delete method supports recursive deletion via prefix
		try {
			await storageService.delete(`uploads/${input.userId}`);
		} catch (err) {
			// Log orphaned-file failures (GDPR erasure signal) but proceed with deleting the user.
			console.error("Failed to delete storage for user %s:", input.userId, err);
		}

		try {
			await db.delete(schema.user).where(eq(schema.user.id, input.userId));
		} catch (err) {
			console.error("Failed to delete user record:", err);

			throw new ORPCError("INTERNAL_SERVER_ERROR");
		}
	},
};
