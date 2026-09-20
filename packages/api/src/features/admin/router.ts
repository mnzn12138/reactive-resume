import { adminProcedure } from "../../context";
import { adminAuditDto, adminOverviewDto, adminResumeDto, adminSettingDto, adminUserDto } from "../../dto/admin";
import { adminAuditService } from "./audit-service";
import { adminOverviewService } from "./overview-service";
import { adminResumeService } from "./resume-service";
import { adminUserService } from "./service";
import { adminSettingService } from "./setting-service";

/**
 * Everything under `/admin` is tagged `Internal`, which the OpenAPI generator
 * filters out — these endpoints must not appear in the public API docs.
 */
const usersRouter = {
	list: adminProcedure
		.route({
			method: "GET",
			path: "/admin/users",
			tags: ["Internal"],
			operationId: "adminListUsers",
			summary: "List users",
			description:
				"Returns a paginated list of users with optional search, role and ban filters. Administrator access required.",
			successDescription: "The matching users and the total count across all pages.",
		})
		.input(adminUserDto.list.input)
		.output(adminUserDto.list.output)
		.handler(({ input }) => adminUserService.list(input)),

	getById: adminProcedure
		.route({
			method: "GET",
			path: "/admin/users/{id}",
			tags: ["Internal"],
			operationId: "adminGetUserById",
			summary: "Get a user",
			description: "Returns one user together with their content counts. Administrator access required.",
			successDescription: "The user and how much content they own.",
		})
		.input(adminUserDto.getById.input)
		.output(adminUserDto.getById.output)
		.handler(({ input }) => adminUserService.getById(input)),

	setRole: adminProcedure
		.route({
			method: "PATCH",
			path: "/admin/users/{id}/role",
			tags: ["Internal"],
			operationId: "adminSetUserRole",
			summary: "Change a user's role",
			description:
				"Sets a user's role to `user` or `admin`. An administrator cannot remove their own role. Administrator access required.",
			successDescription: "The updated user.",
		})
		.input(adminUserDto.setRole.input)
		.output(adminUserDto.setRole.output)
		.handler(({ context, input }) => adminUserService.setRole({ ...input, actorId: context.user.id })),

	setBan: adminProcedure
		.route({
			method: "PATCH",
			path: "/admin/users/{id}/ban",
			tags: ["Internal"],
			operationId: "adminSetUserBan",
			summary: "Ban or unban a user",
			description:
				"Bans a user (optionally with a reason and expiry) or lifts an existing ban. Banning also revokes the user's sessions so it takes effect immediately. Administrator access required.",
			successDescription: "The updated user.",
		})
		.input(adminUserDto.setBan.input)
		.output(adminUserDto.setBan.output)
		.handler(({ context, input }) => adminUserService.setBan({ ...input, actorId: context.user.id })),

	delete: adminProcedure
		.route({
			method: "DELETE",
			path: "/admin/users/{id}",
			tags: ["Internal"],
			operationId: "adminDeleteUser",
			summary: "Delete a user",
			description:
				"Deletes a user and, by cascade, everything they own. The last administrator cannot be deleted. Administrator access required.",
			successDescription: "The user was deleted.",
		})
		.input(adminUserDto.delete.input)
		.output(adminUserDto.delete.output)
		.handler(({ context, input }) => adminUserService.remove({ ...input, actorId: context.user.id })),
};

const resumesRouter = {
	list: adminProcedure
		.route({
			method: "GET",
			path: "/admin/resumes",
			tags: ["Internal"],
			operationId: "adminListResumes",
			summary: "List resumes",
			description:
				"Returns a paginated list of resumes across all accounts, with optional search, visibility and lock filters. Administrator access required.",
			successDescription: "The matching resumes and the total count across all pages.",
		})
		.input(adminResumeDto.list.input)
		.output(adminResumeDto.list.output)
		.handler(({ input }) => adminResumeService.list(input)),

	setLock: adminProcedure
		.route({
			method: "PATCH",
			path: "/admin/resumes/{id}/lock",
			tags: ["Internal"],
			operationId: "adminSetResumeLock",
			summary: "Lock or unlock a resume",
			description:
				"Locks a resume to prevent its owner from editing it, or unlocks it again. Administrator access required.",
			successDescription: "The updated resume.",
		})
		.input(adminResumeDto.setLock.input)
		.output(adminResumeDto.setLock.output)
		.handler(({ context, input }) => adminResumeService.setLock({ ...input, actorId: context.user.id })),

	delete: adminProcedure
		.route({
			method: "DELETE",
			path: "/admin/resumes/{id}",
			tags: ["Internal"],
			operationId: "adminDeleteResume",
			summary: "Delete a resume",
			description:
				"Permanently deletes a resume, its saved versions and its statistics. Uploaded images are left alone because the owner's other resumes may share them. Administrator access required.",
			successDescription: "The resume was deleted.",
		})
		.input(adminResumeDto.delete.input)
		.output(adminResumeDto.delete.output)
		.handler(({ context, input }) => adminResumeService.remove({ ...input, actorId: context.user.id })),
};

const overviewRouter = {
	get: adminProcedure
		.route({
			method: "GET",
			path: "/admin/overview",
			tags: ["Internal"],
			operationId: "adminGetOverview",
			summary: "Instance overview",
			description:
				"Returns instance-wide totals, a 30-day signup trend, and storage usage. Administrator access required.",
			successDescription: "The instance counters, daily signups and storage usage.",
		})
		.output(adminOverviewDto.get.output)
		.handler(() => adminOverviewService.get()),
};

const settingsRouter = {
	get: adminProcedure
		.route({
			method: "GET",
			path: "/admin/settings",
			tags: ["Internal"],
			operationId: "adminGetSettings",
			summary: "Read instance settings",
			description:
				"Returns each overridable feature flag together with where its effective value comes from (database override, environment variable, or default). Administrator access required.",
			successDescription: "The overridable flags, their effective values and their origin.",
		})
		.output(adminSettingDto.get.output)
		.handler(() => adminSettingService.get()),

	set: adminProcedure
		.route({
			method: "PATCH",
			path: "/admin/settings",
			tags: ["Internal"],
			operationId: "adminSetSetting",
			summary: "Override an instance setting",
			description:
				"Stores a runtime override for one feature flag. From then on the stored value wins over the environment variable. Administrator access required.",
			successDescription: "The setting with its new value and origin.",
		})
		.input(adminSettingDto.set.input)
		.output(adminSettingDto.set.output)
		.handler(({ context, input }) => adminSettingService.set({ ...input, actorId: context.user.id })),
};

const auditRouter = {
	list: adminProcedure
		.route({
			method: "GET",
			path: "/admin/audit-logs",
			tags: ["Internal"],
			operationId: "adminListAuditLogs",
			summary: "List audit log entries",
			description:
				"Returns a paginated, newest-first trail of privileged actions, with optional filters by action, target kind and free text. Administrator access required.",
			successDescription: "The matching entries and the total count across all pages.",
		})
		.input(adminAuditDto.list.input)
		.output(adminAuditDto.list.output)
		.handler(({ input }) => adminAuditService.list(input)),
};

export const adminRouter = {
	users: usersRouter,
	resumes: resumesRouter,
	overview: overviewRouter,
	settings: settingsRouter,
	audit: auditRouter,
};
