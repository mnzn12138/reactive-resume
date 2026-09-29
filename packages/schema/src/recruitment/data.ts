import z from "zod";

/**
 * Enums for the campus recruitment board (`/jobs`).
 *
 * Single source of truth: the API DTOs (`packages/api/src/dto/recruitment.ts`), the
 * Drizzle column types (`packages/db/src/schema/recruitment.ts`) and the web filter
 * options all read from here, so a value can never drift between layers.
 *
 * Every enum exports **both** shapes on purpose:
 * - a `as const` value array, so a `<select>` and the `z.enum` share one list;
 * - a zod schema, so the wire format is validated in one place.
 *
 * i18n note: campus-recruitment vocabulary (提前批 / 985 / 211 / 内推码) has no
 * literal counterpart outside China. `en.po` needs descriptive translations, not
 * transliterations — see §3.9 of `plans/46-campus-board-design.md`.
 */

/** 提前批 / 正式批 / 补录 —— the time dimension that actually drives Chinese campus hiring. */
export const BATCHES = ["early", "regular", "supplementary"] as const;

export const batchSchema = z.enum(BATCHES);

export type Batch = z.infer<typeof batchSchema>;

/** 校招 / 实习 / 暑期实习 / 社招. Multi-valued: one post can hire interns and grads at once. */
export const EMPLOYMENT_TYPES = ["campus", "internship", "summerInternship", "social"] as const;

export const employmentTypeSchema = z.enum(EMPLOYMENT_TYPES);

export type EmploymentType = z.infer<typeof employmentTypeSchema>;

/** Where the work happens. Deliberately separate from `workIntensity` (see below). */
export const WORK_MODES = ["onsite", "hybrid", "remote"] as const;

export const workModeSchema = z.enum(WORK_MODES);

export type WorkMode = z.infer<typeof workModeSchema>;

/**
 * How hard the work is: 标准工时 / 高强度.
 *
 * codecv labelled this dimension with value judgements (`996` / `WLB`), which a reviewer
 * cannot objectively confirm. Kept neutral on purpose — it states intensity, not morality.
 */
export const WORK_INTENSITIES = ["standard", "intensive"] as const;

export const workIntensitySchema = z.enum(WORK_INTENSITIES);

export type WorkIntensity = z.infer<typeof workIntensitySchema>;

/**
 * Education requirement, the dimension Chinese campus hiring actually filters on.
 *
 * `985_211` → 985/211本科, `bachelor` → 统招本科, `associate` → 专科,
 * `upgraded` → 专升本, `no_92_requirement` → 不强制要求92, `case_by_case` → 优秀可特批.
 */
export const EDUCATION_REQUIREMENTS = [
	"985_211",
	"bachelor",
	"associate",
	"upgraded",
	"no_92_requirement",
	"case_by_case",
] as const;

export const educationRequiredSchema = z.enum(EDUCATION_REQUIREMENTS);

export type EducationRequired = z.infer<typeof educationRequiredSchema>;

/**
 * Benefits only. codecv mixed these into one 18-value `tags` array together with company
 * descriptors; splitting them keeps "show me 包三餐" from returning 弹性工作 posts.
 */
export const BENEFITS = [
	"afternoon_tea",
	"meal_allowance",
	"housing_allowance",
	"insurance_5",
	"insurance_6",
	"flexible_hours",
	"no_clock_in",
] as const;

export const benefitSchema = z.enum(BENEFITS);

export type Benefit = z.infer<typeof benefitSchema>;

/**
 * How to reach the poster. WeChat / 内推 are the dominant channels in China — a
 * generic "job board URL only" model would leave the most useful path unrepresentable.
 */
export const CONTACT_KINDS = ["wechat", "email", "phone", "referral"] as const;

export const contactKindSchema = z.enum(CONTACT_KINDS);

export type ContactKind = z.infer<typeof contactKindSchema>;

/** Where the post came from, so a reviewer can judge how much to trust it. */
export const SOURCES = ["official", "referral", "community"] as const;

export const sourceSchema = z.enum(SOURCES);

export type RecruitmentSource = z.infer<typeof sourceSchema>;

/**
 * Moderation state machine.
 *
 * `expired` is only ever written by an administrator taking a post down — natural expiry
 * is a read-time condition (`rolling = false AND deadline <= now()`), never a background
 * job rewriting rows (see §3.6 of the design).
 */
export const POST_STATUSES = ["draft", "pending", "published", "rejected", "closed", "expired"] as const;

export const postStatusSchema = z.enum(POST_STATUSES);

export type PostStatus = z.infer<typeof postStatusSchema>;

export const REPORT_REASONS = ["notHiring", "fakeInfo", "kpiFarming", "duplicate", "other"] as const;

export const reportReasonSchema = z.enum(REPORT_REASONS);

export type ReportReason = z.infer<typeof reportReasonSchema>;

/**
 * Derived freshness, computed **on the server** so the browser and the API can never
 * disagree about whether a post is still open. Clients must not recompute it.
 *
 * `closingSoon` means "deadline within 7 days"; the 7-day threshold is server-side and is
 * deliberately not exposed as a parameter.
 */
export const AVAILABILITIES = ["open", "closingSoon", "rolling", "expired"] as const;

export const availabilitySchema = z.enum(AVAILABILITIES);

export type Availability = z.infer<typeof availabilitySchema>;
