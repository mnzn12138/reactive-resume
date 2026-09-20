import z from "zod";
import { OVERRIDABLE_SETTING_KEYS } from "@reactive-resume/auth/instance-settings";
import { AUDIT_ACTIONS, AUDIT_TARGET_TYPES } from "../audit-actions";
import { USER_ROLES } from "../roles";

const idSchema = z.object({ id: z.string().min(1) });

const roleSchema = z.enum(USER_ROLES);

/**
 * What the console is allowed to see about a user. Deliberately excludes
 * credentials: passwords live in `account`, not `user`, and are never selected.
 *
 * `role` is normalised through the whitelist, so a corrupted value shows up as
 * a plain user rather than being echoed back as something privileged.
 */
const adminUserSchema = z.object({
	id: z.string().describe("The user's unique identifier."),
	name: z.string().describe("The user's display name."),
	email: z.string().describe("The user's email address."),
	username: z.string().describe("The user's unique username."),
	image: z.string().nullable().describe("URL of the user's avatar, or null."),
	role: roleSchema.describe("The user's role, normalised against the whitelist."),
	emailVerified: z.boolean().describe("Whether the user has verified their email address."),
	twoFactorEnabled: z.boolean().describe("Whether the user has two-factor authentication enabled."),
	banned: z.boolean().describe("Whether the user is currently banned."),
	banReason: z.string().nullable().describe("Why the user was banned, or null."),
	banExpires: z.date().nullable().describe("When the ban lifts automatically, or null for a permanent ban."),
	lastActiveAt: z.date().nullable().describe("When the user was last active, or null if never."),
	createdAt: z.date().describe("When the account was created."),
	updatedAt: z.date().describe("When the account was last updated."),
});

const adminUserDetailSchema = adminUserSchema.extend({
	stats: z
		.object({
			resumes: z.number().describe("Number of resumes owned by the user."),
			applications: z.number().describe("Number of job applications tracked by the user."),
		})
		.describe("Content counts, useful before deleting an account."),
});

const sortFieldSchema = z
	.enum(["createdAt", "lastActiveAt", "email", "name"])
	.describe("Field to sort the user list by.");

export const adminUserDto = {
	list: {
		input: z
			.object({
				search: z.string().max(200).optional().describe("Case-insensitive match against name, email, or username."),
				role: roleSchema.optional().describe("Return only users with this role."),
				banned: z.boolean().optional().describe("Return only banned (true) or unbanned (false) users."),
				sortBy: sortFieldSchema.default("createdAt"),
				sortOrder: z.enum(["asc", "desc"]).default("desc"),
				limit: z.number().int().min(1).max(100).default(25),
				offset: z.number().int().min(0).default(0),
			})
			.default({ sortBy: "createdAt", sortOrder: "desc", limit: 25, offset: 0 }),
		output: z.object({
			items: z.array(adminUserSchema),
			total: z.number().describe("Total matching users, across all pages."),
		}),
	},

	getById: { input: idSchema, output: adminUserDetailSchema },

	setRole: {
		input: idSchema.extend({ role: roleSchema }),
		output: adminUserSchema,
	},

	setBan: {
		input: idSchema.extend({
			banned: z.boolean().describe("True to ban, false to lift an existing ban."),
			reason: z.string().max(500).optional().describe("Why the user is being banned."),
			expiresAt: z.coerce.date().optional().describe("When the ban lifts automatically; omit for permanent."),
		}),
		output: adminUserSchema,
	},

	delete: { input: idSchema, output: z.void() },
};

export type AdminUserListInput = z.infer<typeof adminUserDto.list.input>;

/**
 * What the console is allowed to see about someone else's resume.
 *
 * Credentials follow the same rule as the user list: the `password` column is
 * never selected, and only a boolean derived in SQL crosses the boundary. The
 * resume body (`data`) is left out as well — it is large, and the list view has
 * no use for it.
 */
const adminResumeSchema = z.object({
	id: z.string().describe("The resume's unique identifier."),
	name: z.string().describe("The resume's display name."),
	slug: z.string().describe("The resume's public URL segment, unique per owner."),
	tags: z.array(z.string()).describe("Labels the owner attached to the resume."),
	isPublic: z.boolean().describe("Whether the resume is shared publicly."),
	isLocked: z.boolean().describe("Whether editing is locked."),
	hasPassword: z.boolean().describe("Whether the public view is password protected."),
	owner: z
		.object({
			id: z.string().describe("The owner's unique identifier."),
			name: z.string().describe("The owner's display name."),
			email: z.string().describe("The owner's email address."),
			username: z.string().describe("The owner's unique username."),
		})
		.describe("Who the resume belongs to."),
	createdAt: z.date().describe("When the resume was created."),
	updatedAt: z.date().describe("When the resume was last updated."),
});

const resumeSortFieldSchema = z.enum(["createdAt", "updatedAt", "name"]).describe("Field to sort the resume list by.");

export const adminResumeDto = {
	list: {
		input: z
			.object({
				search: z
					.string()
					.max(200)
					.optional()
					.describe("Case-insensitive match against the resume name or slug, or the owner's name, email, or username."),
				isPublic: z.boolean().optional().describe("Return only public (true) or private (false) resumes."),
				isLocked: z.boolean().optional().describe("Return only locked (true) or unlocked (false) resumes."),
				sortBy: resumeSortFieldSchema.default("createdAt"),
				sortOrder: z.enum(["asc", "desc"]).default("desc"),
				limit: z.number().int().min(1).max(100).default(25),
				offset: z.number().int().min(0).default(0),
			})
			.default({ sortBy: "createdAt", sortOrder: "desc", limit: 25, offset: 0 }),
		output: z.object({
			items: z.array(adminResumeSchema),
			total: z.number().describe("Total matching resumes, across all pages."),
		}),
	},

	setLock: {
		input: idSchema.extend({ locked: z.boolean().describe("True to lock editing, false to unlock it.") }),
		output: adminResumeSchema,
	},

	delete: { input: idSchema, output: z.void() },
};

export type AdminResumeListInput = z.infer<typeof adminResumeDto.list.input>;

/**
 * Instance-wide counters for the admin overview.
 *
 * `storage` is nullable on purpose: it is the one figure that depends on the
 * configured storage backend, and an unreachable S3 bucket should show as
 * "unknown" rather than as a misleading zero.
 */
export const adminOverviewDto = {
	get: {
		output: z.object({
			totals: z.object({
				users: z.number().describe("Total accounts on this instance."),
				resumes: z.number().describe("Total resumes across all accounts."),
				publicResumes: z.number().describe("Resumes currently shared publicly."),
			}),
			signups: z
				.array(
					z.object({
						date: z.string().describe("UTC day, as YYYY-MM-DD."),
						count: z.number().describe("Accounts created that day."),
					}),
				)
				.describe("Daily signup counts, oldest first, with empty days filled in as zero."),
			storage: z
				.object({
					objects: z.number().describe("Stored files under the uploads prefix."),
					bytes: z.number().describe("Total size of those files."),
				})
				.nullable()
				.describe("Storage usage, or null when the backend could not be reached."),
		}),
	},
};

const settingSourceSchema = z
	.enum(["database", "environment", "default"])
	.describe("Where the effective value came from.");

const adminSettingSchema = z.object({
	key: z.enum(OVERRIDABLE_SETTING_KEYS).describe("The flag's identifier."),
	value: z.boolean().describe("The value actually in force right now."),
	source: settingSourceSchema,
});

export const adminSettingDto = {
	get: {
		output: z.object({
			settings: z.array(adminSettingSchema).describe("Flags the console can override, with their origin."),
			smtpEnabled: z
				.boolean()
				.describe("Whether outbound email is configured. Derived from the environment, not stored."),
		}),
	},

	set: {
		input: z.object({
			key: z.enum(OVERRIDABLE_SETTING_KEYS),
			value: z.boolean().describe("Override value. It takes precedence over the environment from now on."),
		}),
		output: adminSettingSchema,
	},
};

export type AdminSettingInput = z.infer<typeof adminSettingDto.set.input>;

/**
 * One line of the admin audit trail.
 *
 * `action` and `targetType` are plain strings rather than enums on the way out:
 * the table stores whatever the running version wrote, so a row produced by a
 * newer release must still render instead of failing validation.
 */
const auditEntrySchema = z.object({
	id: z.string().describe("The entry's unique identifier."),
	action: z.string().describe("Dotted action name, for example `user.ban.set`."),
	targetType: z.string().describe("What kind of object the action targeted."),
	targetId: z.string().nullable().describe("The affected object's identifier, or null."),
	metadata: z
		.record(z.string(), z.unknown())
		.nullable()
		.describe("Action-specific context such as the previous value. Null when the action recorded none."),
	createdAt: z.date().describe("When the action happened."),
	actor: z
		.object({
			id: z.string().describe("The administrator's unique identifier."),
			name: z.string().describe("The administrator's display name."),
			email: z.string().describe("The administrator's email address."),
		})
		.nullable()
		.describe("Who performed the action, or null when that account has since been deleted."),
});

export const adminAuditDto = {
	list: {
		input: z
			.object({
				action: z.enum(AUDIT_ACTIONS).optional().describe("Return only entries for this action."),
				targetType: z.enum(AUDIT_TARGET_TYPES).optional().describe("Return only entries for this target kind."),
				search: z
					.string()
					.max(200)
					.optional()
					.describe("Case-insensitive match against the administrator's name or email, or the target id."),
				limit: z.number().int().min(1).max(100).default(25),
				offset: z.number().int().min(0).default(0),
			})
			.default({ limit: 25, offset: 0 }),
		output: z.object({
			items: z.array(auditEntrySchema),
			total: z.number().describe("Total matching entries, across all pages."),
		}),
	},
};

export type AdminAuditListInput = z.infer<typeof adminAuditDto.list.input>;
