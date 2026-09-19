import z from "zod";
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
export type AdminUserSortField = z.infer<typeof sortFieldSchema>;
