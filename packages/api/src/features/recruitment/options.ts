import {
	BATCHES,
	BENEFITS,
	CONTACT_KINDS,
	EDUCATION_REQUIREMENTS,
	EMPLOYMENT_TYPES,
	POST_STATUSES,
	REPORT_REASONS,
	SOURCES,
	WORK_INTENSITIES,
	WORK_MODES,
} from "@reactive-resume/schema/recruitment/data";

/**
 * Filter options for the campus recruitment board, re-exported from the single source of
 * truth (`packages/schema/src/recruitment/data.ts`) rather than re-declared here.
 *
 * §4.1 of `plans/46-campus-board-design.md` is explicit that this is **not** an endpoint: the
 * options are static, so the web app imports them and no round trip happens. Duplicating the
 * lists here would let them drift from the zod schemas the API validates against, which is
 * exactly the failure mode a filter dropdown is worst at hiding (a value the UI offers and the
 * server rejects).
 *
 * Only *values* live here — no labels. i18n keys belong to the web app, which already owns the
 * translation catalogues for the China-specific vocabulary (提前批 / 985 / 211 / 内推码).
 */

/** 提前批 / 正式批 / 补录. */
export const recruitmentBatchOptions = BATCHES;

/** 校招 / 实习 / 暑期实习 / 社招. */
export const recruitmentEmploymentTypeOptions = EMPLOYMENT_TYPES;

export const recruitmentWorkModeOptions = WORK_MODES;

/** 标准工时 / 高强度 — stated neutrally, not as a moral judgement. */
export const recruitmentWorkIntensityOptions = WORK_INTENSITIES;

export const recruitmentEducationOptions = EDUCATION_REQUIREMENTS;

export const recruitmentBenefitOptions = BENEFITS;

export const recruitmentContactKindOptions = CONTACT_KINDS;

export const recruitmentSourceOptions = SOURCES;

export const recruitmentStatusOptions = POST_STATUSES;

export const recruitmentReportReasonOptions = REPORT_REASONS;

/**
 * Sortable columns on the public list. Mirrors `publicSortFieldSchema` in
 * `packages/api/src/dto/recruitment.ts`; `reportCount` is deliberately absent because it is
 * admin-only, like the column itself.
 */
export const recruitmentSortOptions = ["publishedAt", "deadline", "createdAt"] as const;

/**
 * Freshness bands a caller may filter on. `expired` is absent on purpose — expired posts are
 * reached with `includeExpired`, not with `availability` (§4.3.4).
 */
export const recruitmentAvailabilityOptions = ["open", "closingSoon", "rolling"] as const;

/** Page size bounds, so the web app's paginator cannot disagree with the DTO. */
export const RECRUITMENT_PAGE_SIZE = {
	default: 20,
	min: 1,
	max: 100,
} as const;

/** Everything above in one object, for callers that want to iterate rather than import ten names. */
export const recruitmentOptions = {
	batch: recruitmentBatchOptions,
	employmentType: recruitmentEmploymentTypeOptions,
	workMode: recruitmentWorkModeOptions,
	workIntensity: recruitmentWorkIntensityOptions,
	educationRequired: recruitmentEducationOptions,
	benefits: recruitmentBenefitOptions,
	contactKind: recruitmentContactKindOptions,
	source: recruitmentSourceOptions,
	status: recruitmentStatusOptions,
	reportReason: recruitmentReportReasonOptions,
	sortBy: recruitmentSortOptions,
	availability: recruitmentAvailabilityOptions,
	pageSize: RECRUITMENT_PAGE_SIZE,
} as const;
