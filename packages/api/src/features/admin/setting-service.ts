import type { AuditAction } from "../../audit-actions";
import type { AdminSettingInput } from "../../dto/admin";
import {
	invalidateInstanceSettings,
	OVERRIDABLE_SETTING_KEYS,
	resolveInstanceSettings,
} from "@reactive-resume/auth/instance-settings";
import { db } from "@reactive-resume/db/client";
import { instanceSetting } from "@reactive-resume/db/schema";
import { isSmtpEnabled } from "../flags/router";
import { recordAudit } from "./audit";

/**
 * Instance settings as the console sees them.
 *
 * `smtpEnabled` rides along so the screen can show it as read-only context: it
 * is derived from whether SMTP is configured, and an administrator editing it
 * by hand would only be lying to themselves.
 */
async function get() {
	const resolved = await resolveInstanceSettings();

	return {
		settings: OVERRIDABLE_SETTING_KEYS.map((key) => resolved[key]),
		smtpEnabled: isSmtpEnabled(),
	};
}

async function set(input: AdminSettingInput & { actorId: string }) {
	const previous = (await resolveInstanceSettings())[input.key];

	// Nothing to do only when the stored override already says this. A value that
	// merely happens to match an environment variable still has to be written —
	// that is what pins it against a future env change.
	if (previous.source === "database" && previous.value === input.value) return previous;

	await db
		.insert(instanceSetting)
		.values({ key: input.key, value: input.value, updatedBy: input.actorId })
		.onConflictDoUpdate({
			target: instanceSetting.key,
			set: { value: input.value, updatedBy: input.actorId },
		});

	// Same process picks the change up immediately; other replicas wait out the TTL.
	invalidateInstanceSettings();

	await recordAudit({
		actorId: input.actorId,
		action: "instance.setting.set" satisfies AuditAction,
		targetType: "instance",
		targetId: input.key,
		metadata: { from: previous.value, to: input.value, previousSource: previous.source },
	});

	return { key: input.key, value: input.value, source: "database" as const };
}

export const adminSettingService = { get, set };
