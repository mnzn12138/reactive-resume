import { crudRouter } from "./crud";
import { moderationRouter } from "./moderation";

/**
 * The campus recruitment board router, mounted at `/recruitment` by
 * `packages/api/src/routers/index.ts`.
 *
 * Endpoints 1–11 of §4.1. The four administrator ones (12–14 the review queue, 15–16 the
 * report queue) live under `/admin/recruitment` and are mounted by
 * `packages/api/src/features/admin/router.ts` from `./review` and `./moderation`, so that the
 * `adminProcedure` gate — and only that gate — stands in front of them.
 */
export const recruitmentRouter = {
	// Public reads (endpoints 1 and 2).
	list: crudRouter.list,
	getById: crudRouter.getById,

	// Submitting and owning (endpoints 3–7).
	create: crudRouter.create,
	update: crudRouter.update,
	delete: crudRouter.delete,
	mine: crudRouter.mine,
	bookmarks: crudRouter.bookmarks,

	// Bookmarks and reports (endpoints 8–10).
	bookmark: moderationRouter.bookmark,
	unbookmark: moderationRouter.unbookmark,
	report: moderationRouter.report,

	// One-click hand-off to the application pipeline (endpoint 11).
	convertToApplication: crudRouter.convertToApplication,
};
