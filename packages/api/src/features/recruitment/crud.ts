import type { RecruitmentViewer } from "./service";
import { ORPCError } from "@orpc/client";
import { isRecruitmentBoardEnabled } from "@reactive-resume/auth/instance-settings";
import { publicProcedure } from "../../context";
import { recruitmentPostDto } from "../../dto/recruitment";
import { recruitmentReadRateLimit } from "../../middleware/rate-limit";
import { isAdminRole } from "../../roles";
import { recruitmentService } from "./service";

/**
 * Public handlers for the campus recruitment board — endpoints 1 and 2 of §4.3.
 *
 * Both are `publicProcedure`: a signed-in caller gets a wider response (contact details,
 * bookmark state), but the board is readable without an account. T03 appends the protected
 * endpoints (`create` / `update` / `delete` / `mine` / bookmarks / report / convert) to the
 * object below; nothing here has to change for that.
 *
 * The board switch is consulted through `isRecruitmentBoardEnabled()` — the three-tier
 * resolution (database > environment > default) in `packages/auth` — and never by querying
 * `instanceSetting` directly, so the console, the flags endpoint and these handlers cannot
 * disagree about whether the board is on.
 */

/**
 * Gate for the whole board.
 *
 * A closed board answers **404, not 403** (§0 / §4.5): a 403 would confirm that the board
 * exists and is merely switched off, which is exactly what the switch is meant to hide.
 */
async function assertBoardEnabled(): Promise<void> {
	if (await isRecruitmentBoardEnabled()) return;

	throw new ORPCError("NOT_FOUND", { message: "The campus recruitment board is not available on this instance." });
}

function toViewer(context: { user?: { id?: string; role?: unknown } | null }): RecruitmentViewer {
	return { userId: context.user?.id ?? null, isAdmin: isAdminRole(context.user?.role) };
}

export const crudRouter = {
	list: publicProcedure
		.route({
			method: "GET",
			path: "/recruitment/posts",
			tags: ["Recruitment"],
			operationId: "listRecruitmentPosts",
			summary: "List campus recruitment posts",
			description:
				"Returns a page of published campus job openings together with the total number of posts matching the filters. Filters combine as OR within one field and AND across fields. Expired posts are excluded unless includeExpired is set, and contact details are omitted for anonymous callers.",
			successDescription: "The current page of posts and the total number of matching posts.",
		})
		.input(recruitmentPostDto.list.input)
		.use(recruitmentReadRateLimit)
		.output(recruitmentPostDto.list.output)
		.handler(async ({ input, context }) => {
			await assertBoardEnabled();

			return recruitmentService.list({ ...input, viewer: toViewer(context) });
		}),

	getById: publicProcedure
		.route({
			method: "GET",
			path: "/recruitment/posts/{id}",
			tags: ["Recruitment"],
			operationId: "getRecruitmentPost",
			summary: "Get a campus recruitment post",
			description:
				"Returns a single published campus job opening. Anonymous callers receive no contact details; a signed-in caller receives the full contact block. Posts that are not published, or whose deadline has passed, are answered with 404.",
			successDescription: "The campus recruitment post.",
		})
		.input(recruitmentPostDto.getById.input)
		.use(recruitmentReadRateLimit)
		.output(recruitmentPostDto.getById.output)
		.handler(async ({ input, context }) => {
			await assertBoardEnabled();

			return recruitmentService.getById({ id: input.id, viewer: toViewer(context) });
		}),
};
