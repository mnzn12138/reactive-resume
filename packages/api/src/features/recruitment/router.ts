import { crudRouter } from "./crud";

/**
 * The campus recruitment board router, mounted at `/recruitment` by
 * `packages/api/src/routers/index.ts`.
 *
 * T03 grows this object with the write endpoints: the protected ones (create / update /
 * delete / mine / bookmarks / report / convert) come from `./crud`, the moderation ones from
 * `./moderation`, and the review queue from `./review` (which is exposed through the admin
 * router instead, since it lives under `/admin`).
 */
export const recruitmentRouter = {
	list: crudRouter.list,
	getById: crudRouter.getById,
};
