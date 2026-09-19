import { adminProcedure } from "../../context";
import { adminResumeDto, adminUserDto } from "../../dto/admin";
import { adminResumeService } from "./resume-service";
import { adminUserService } from "./service";

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

export const adminRouter = { users: usersRouter, resumes: resumesRouter };
