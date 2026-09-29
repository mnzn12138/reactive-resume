import z from "zod";
import {
	availabilitySchema,
	batchSchema,
	benefitSchema,
	contactKindSchema,
	educationRequiredSchema,
	employmentTypeSchema,
	postStatusSchema,
	reportReasonSchema,
	sourceSchema,
	workIntensitySchema,
	workModeSchema,
} from "@reactive-resume/schema/recruitment/data";

/**
 * Contracts for the campus recruitment board (§4 of `plans/46-campus-board-design.md`).
 *
 * Three rules hold everywhere in this file, and breaking any one of them is a security
 * regression rather than a cosmetic slip:
 *
 * 1. `contact` is cut **as a whole object** for anonymous callers — not field by field. A
 *    response must not even contain the words `contactValue` / `referralCode`.
 * 2. `reportCount` never appears in a public schema: publishing it turns reports into a
 *    weapon against a post.
 * 3. Every URL goes through `httpUrlSchema`. The scheme whitelist **rejects**, it does not
 *    sanitise — `javascript:alert(1)` is a 400, not a cleaned-up string.
 */

const MAX_SEARCH_CHARS = 200;
const MAX_ROLE_CHARS = 200;
const MAX_COMPANY_CHARS = 200;
const MAX_SALARY_CHARS = 100;
const MAX_SUMMARY_CHARS = 2_000;
const MAX_CONTACT_VALUE_CHARS = 200;
const MAX_REFERRAL_CODE_CHARS = 64;
const MAX_REJECTION_REASON_CHARS = 500;
const MAX_REPORT_DETAIL_CHARS = 500;
const MAX_LOCATION_CHARS = 64;
const MAX_TAG_CHARS = 32;
const MAX_LOCATIONS = 10;
const MAX_TAGS = 10;

/** Only `http:` / `https:` ever make it through; everything else is a bad request. */
const httpUrlSchema = z
	.string()
	.trim()
	.pipe(z.url({ protocol: /^https?$/, error: "URL must use http or https." }));

const idSchema = z.object({ id: z.string().min(1).describe("The post's unique identifier.") });

const sortOrderSchema = z.enum(["asc", "desc"]).describe("Sort direction.");

const publicSortFieldSchema = z
	.enum(["publishedAt", "deadline", "createdAt"])
	.describe("Field to sort by. Anything outside this whitelist is a validation error, not a fallback.");

const adminSortFieldSchema = z
	.enum(["publishedAt", "deadline", "createdAt", "reportCount"])
	.describe("Field to sort by. `reportCount` is admin-only, like the column itself.");

/**
 * What the public list and the public detail page may see.
 *
 * Fields that are absent here and must stay absent: `contactKind`, `contactValue`,
 * `referralCode`, `reportCount`, `createdBy`, `reviewedBy`, `reviewedAt`, `rejectionReason`.
 */
const recruitmentPostPublicSchema = z.object({
	id: z.string().describe("The post's unique identifier."),
	company: z.string().describe("The hiring company."),
	role: z.string().describe("The role / job title."),
	companyLogoUrl: z.string().nullable().describe("Company logo URL, or null. Clients should fall back to a monogram."),
	batch: batchSchema.describe("Hiring batch: early, regular, or supplementary."),
	employmentType: z.array(employmentTypeSchema).describe("Campus, internship, summer internship, and/or social."),
	workMode: z.array(workModeSchema).describe("Onsite, hybrid, and/or remote."),
	workIntensity: z.array(workIntensitySchema).describe("Standard hours and/or intensive."),
	locations: z.array(z.string()).describe("Work cities."),
	educationRequired: z.array(educationRequiredSchema).describe("Education requirements."),
	benefits: z.array(benefitSchema).describe("Benefit labels."),
	tags: z.array(z.string()).describe("Free-form labels attached by the submitter."),
	salaryText: z.string().nullable().describe("Salary as free text, or null."),
	deadline: z.date().nullable().describe("Application deadline, or null when none was given."),
	rolling: z.boolean().describe("Whether the post accepts applications indefinitely."),
	availability: availabilitySchema.describe(
		"Derived freshness: open, closingSoon, rolling, or expired. Computed server-side — clients must not recompute it.",
	),
	daysUntilDeadline: z
		.number()
		.int()
		.nullable()
		.describe("Whole days left before the deadline, or null when the post is rolling or has no deadline."),
	applyUrl: z.string().nullable().describe("Application URL, already checked against the scheme whitelist."),
	source: sourceSchema.nullable().describe("Where the post came from, or null."),
	sourceUrl: z.string().nullable().describe("Original announcement URL, for verification. Null when absent."),
	summary: z.string().nullable().describe("Plain-text summary of the role. Never HTML."),
	status: postStatusSchema.describe("Moderation state. Public listings only ever return `published`."),
	publishedAt: z.date().nullable().describe("When the post was approved, or null while it is still in review."),
	createdAt: z.date().describe("When the post was submitted."),
	updatedAt: z.date().describe("When the post was last edited."),
	bookmarked: z.boolean().describe("Whether the caller has bookmarked this post. Always false when anonymous."),
	myApplicationId: z
		.string()
		.nullable()
		.describe(
			"Reserved: the caller's tracked application created from this post, or null. Always null until `application.recruitment_post_id` ships.",
		),
});

/**
 * How to reach the poster — the part of a post that must not be public.
 *
 * The whole object is null for an anonymous caller, which is what keeps the field *names*
 * out of the response body; returning `contact: { value: null }` would leak them.
 */
const contactSchema = z
	.object({
		kind: contactKindSchema.describe("Which channel this is: wechat, email, phone, or referral."),
		value: z.string().describe("The handle, address, or number to reach."),
		referralCode: z.string().nullable().describe("Referral code, or null."),
	})
	.nullable()
	.describe("How to apply. Null for anonymous callers — log in to see it.");

/** What the submitter sees about their own post: contact, rejection reason, report count. */
const recruitmentOwnerSchema = recruitmentPostPublicSchema.extend({
	contact: contactSchema,
	rejectionReason: z.string().nullable().describe("Why an administrator rejected the post, or null."),
	reportCount: z.number().int().describe("How many times the post has been reported."),
});

const postAuthorSchema = z.object({
	id: z.string().describe("The user's unique identifier."),
	name: z.string().describe("The user's display name."),
	email: z.string().describe("The user's email address."),
});

const postReviewerSchema = z.object({
	id: z.string().describe("The user's unique identifier."),
	name: z.string().describe("The user's display name."),
});

/** What the review queue sees: everything the owner sees, plus who submitted and who reviewed. */
const recruitmentPostAdminSchema = recruitmentOwnerSchema.extend({
	createdBy: postAuthorSchema.nullable().describe("Who submitted the post, or null when an administrator imported it."),
	reviewedBy: postReviewerSchema.nullable().describe("Who last reviewed the post, or null."),
	dedupeKey: z.string().describe("The normalised dedupe key the unique constraint is built on."),
	duplicateOf: z
		.object({
			id: z.string().describe("The other post's unique identifier."),
			company: z.string().describe("The other post's company."),
			role: z.string().describe("The other post's role."),
			status: postStatusSchema.describe("The other post's moderation state."),
		})
		.nullable()
		.describe(
			"Another post sharing this dedupe key, so a reviewer can spot a duplicate at a glance. Null when unique.",
		),
});

const reportAdminSchema = z.object({
	id: z.string().describe("The report's unique identifier."),
	postId: z.string().describe("The reported post's unique identifier."),
	post: z.object({
		id: z.string().describe("The reported post's unique identifier."),
		company: z.string().describe("The reported post's company."),
		role: z.string().describe("The reported post's role."),
		status: postStatusSchema.describe("The reported post's moderation state."),
	}),
	reporter: postAuthorSchema.describe("Who filed the report."),
	reason: reportReasonSchema.describe("Why it was reported."),
	detail: z.string().nullable().describe("Free-text detail supplied with the report, or null."),
	handled: z.boolean().describe("Whether an administrator has handled the report."),
	handledBy: postReviewerSchema.nullable().describe("Who handled it, or null."),
	handledAt: z.date().nullable().describe("When it was handled, or null."),
	createdAt: z.date().describe("When it was filed."),
});

/**
 * Fields a submitter may set. Shared by `create`, `update` and the admin `edit` action so
 * the three can never drift apart.
 */
const recruitmentPostEditableSchema = z.object({
	company: z.string().trim().min(1).max(MAX_COMPANY_CHARS).optional().describe("The hiring company."),
	role: z.string().trim().min(1).max(MAX_ROLE_CHARS).optional().describe("The role / job title."),
	companyLogoUrl: httpUrlSchema.optional().describe("Company logo URL. Must be http(s)."),
	batch: batchSchema.optional().describe("Hiring batch. Defaults to `regular`."),
	employmentType: z
		.array(employmentTypeSchema)
		.min(1)
		.optional()
		.describe("Recruitment types. At least one when supplied; omitting it leaves the existing value alone."),
	workMode: z.array(workModeSchema).optional().describe("Where the work happens."),
	workIntensity: z.array(workIntensitySchema).optional().describe("How intense the work is."),
	locations: z
		.array(z.string().trim().min(1).max(MAX_LOCATION_CHARS))
		.max(MAX_LOCATIONS)
		.optional()
		.describe(`Work cities. At most ${MAX_LOCATIONS}.`),
	educationRequired: z.array(educationRequiredSchema).optional().describe("Education requirements."),
	benefits: z.array(benefitSchema).optional().describe("Benefit labels."),
	tags: z
		.array(z.string().trim().min(1).max(MAX_TAG_CHARS))
		.max(MAX_TAGS)
		.optional()
		.describe(`Free-form labels. At most ${MAX_TAGS}.`),
	salaryText: z.string().trim().max(MAX_SALARY_CHARS).optional().describe("Salary as free text."),
	deadline: z.coerce.date().optional().describe("Application deadline. Must be in the future."),
	rolling: z.boolean().optional().describe("Whether applications are accepted indefinitely. Defaults to false."),
	applyUrl: httpUrlSchema.optional().describe("Application URL. Must be http(s)."),
	contactKind: contactKindSchema.optional().describe("Contact channel. Must be paired with `contactValue`."),
	contactValue: z
		.string()
		.trim()
		.max(MAX_CONTACT_VALUE_CHARS)
		.optional()
		.describe("Contact value. Must be paired with `contactKind`."),
	referralCode: z.string().trim().max(MAX_REFERRAL_CODE_CHARS).optional().describe("Referral code."),
	summary: z.string().trim().max(MAX_SUMMARY_CHARS).optional().describe("Plain-text summary of the role."),
	source: sourceSchema.optional().describe("Where the post came from."),
	sourceUrl: httpUrlSchema.optional().describe("Original announcement URL. Must be http(s)."),
});

/**
 * Creation input.
 *
 * Two cross-field rules the database cannot express: a post needs at least one link to back
 * it up, and a contact channel is meaningless without its value.
 */
const recruitmentPostCreateInputSchema = recruitmentPostEditableSchema
	.extend({
		company: z.string().trim().min(1).max(MAX_COMPANY_CHARS).describe("The hiring company."),
		role: z.string().trim().min(1).max(MAX_ROLE_CHARS).describe("The role / job title."),
	})
	.refine((value) => value.applyUrl !== undefined || value.sourceUrl !== undefined, {
		error: "Either `applyUrl` or `sourceUrl` is required — a post needs at least one link behind it.",
		path: ["applyUrl"],
	})
	.refine((value) => (value.contactKind === undefined) === (value.contactValue === undefined), {
		error: "`contactKind` and `contactValue` must be provided together.",
		path: ["contactValue"],
	})
	.refine((value) => value.deadline === undefined || value.deadline.getTime() > Date.now(), {
		error: "`deadline` must be in the future.",
		path: ["deadline"],
	});

/**
 * Update input: the same fields, all optional.
 *
 * The cross-field rules above are deliberately **not** re-applied here — on a partial update
 * the other half of a pair may already be stored, and only the service can see the row. It
 * must re-check the source/contact invariants against the stored values.
 */
const recruitmentPostUpdateInputSchema = recruitmentPostEditableSchema.extend({
	id: z.string().min(1).describe("The post's unique identifier."),
});

export const recruitmentPostDto = {
	/** GET /recruitment/posts — public, filtered server-side, `{ items, total }`. */
	list: {
		input: z
			.object({
				search: z
					.string()
					.max(MAX_SEARCH_CHARS)
					.optional()
					.describe("Case-insensitive match against company, role, summary, and tags."),
				role: z.string().max(MAX_ROLE_CHARS).optional().describe("Substring match against the role."),
				company: z.string().max(MAX_COMPANY_CHARS).optional().describe("Substring match against the company."),
				batch: batchSchema.optional().describe("Only this hiring batch."),
				employmentType: z.array(employmentTypeSchema).optional().describe("Match any of these types (OR)."),
				workMode: z.array(workModeSchema).optional().describe("Match any of these modes (OR)."),
				workIntensity: z.array(workIntensitySchema).optional().describe("Match any of these intensities (OR)."),
				educationRequired: z
					.array(educationRequiredSchema)
					.optional()
					.describe("Match any of these education levels (OR)."),
				benefits: z.array(benefitSchema).optional().describe("Match any of these benefits (OR)."),
				locations: z.array(z.string().max(MAX_LOCATION_CHARS)).optional().describe("Match any of these cities (OR)."),
				tags: z.array(z.string().max(MAX_TAG_CHARS)).optional().describe("Match any of these tags (OR)."),
				availability: z
					.enum(["open", "closingSoon", "rolling"])
					.optional()
					.describe("Only posts in this freshness band. Expired posts are reachable through `includeExpired`."),
				includeExpired: z.boolean().optional().describe("Include published posts whose deadline has passed."),
				sortBy: publicSortFieldSchema.default("publishedAt"),
				sortOrder: sortOrderSchema.default("desc"),
				limit: z.number().int().min(1).max(100).default(20),
				offset: z.number().int().min(0).default(0),
			})
			.default({ sortBy: "publishedAt", sortOrder: "desc", limit: 20, offset: 0 })
			.describe(
				"Filters combine as OR within one field and AND across fields: `employmentType=campus&employmentType=internship&locations=Beijing` means (campus OR internship) AND Beijing.",
			),
		output: z.object({
			items: z.array(recruitmentPostPublicSchema).describe("The current page of posts."),
			total: z.number().describe("Total matching posts across all pages — not the size of this page."),
		}),
	},

	/** GET /recruitment/posts/{id} — public; `contact` is cut for anonymous callers. */
	getById: {
		input: idSchema,
		output: recruitmentPostPublicSchema.extend({
			contact: contactSchema,
			rejectionReason: z
				.string()
				.nullable()
				.describe("Why the post was rejected. Only present for the submitter or an administrator."),
		}),
	},

	/** POST /recruitment/posts — submit a post. Lands in `pending` when review is required. */
	create: {
		input: recruitmentPostCreateInputSchema,
		output: z.object({ id: z.string().describe("The created post's unique identifier.") }),
	},

	/** PATCH /recruitment/posts/{id} — edit own post. Editing a published post re-queues it. */
	update: {
		input: recruitmentPostUpdateInputSchema,
		output: z.object({ id: z.string().describe("The updated post's unique identifier.") }),
	},

	/** DELETE /recruitment/posts/{id} — withdraw own post. */
	delete: {
		input: idSchema,
		output: z.void(),
	},

	/** GET /recruitment/mine — own submissions, including pending and rejected ones. */
	mine: {
		input: z
			.object({
				status: postStatusSchema.optional().describe("Only posts in this moderation state."),
				limit: z.number().int().min(1).max(100).default(20),
				offset: z.number().int().min(0).default(0),
			})
			.default({ limit: 20, offset: 0 }),
		output: z.object({
			items: z.array(recruitmentOwnerSchema).describe("The current page of the caller's posts."),
			total: z.number().describe("Total matching posts across all pages."),
		}),
	},

	/** GET /recruitment/bookmarks — own bookmarks, newest first. Expired posts still appear. */
	bookmarks: {
		input: z
			.object({
				limit: z.number().int().min(1).max(100).default(20),
				offset: z.number().int().min(0).default(0),
			})
			.default({ limit: 20, offset: 0 }),
		output: z.object({
			items: z.array(recruitmentPostPublicSchema).describe("The current page of bookmarked posts."),
			total: z.number().describe("Total bookmarks across all pages."),
		}),
	},

	/** PUT /recruitment/posts/{id}/bookmark — idempotent. */
	bookmark: {
		input: idSchema,
		output: z.object({
			bookmarked: z.boolean().describe("Always true here; repeating the call changes nothing."),
		}),
	},

	/** DELETE /recruitment/posts/{id}/bookmark — idempotent. */
	unbookmark: {
		input: idSchema,
		output: z.object({
			bookmarked: z.boolean().describe("Always false here; repeating the call changes nothing."),
		}),
	},

	/** POST /recruitment/posts/{id}/report — one report per person per post. */
	report: {
		input: z
			.object({
				id: z.string().min(1).describe("The post's unique identifier."),
				reason: reportReasonSchema.describe("Why the post is being reported."),
				detail: z
					.string()
					.trim()
					.max(MAX_REPORT_DETAIL_CHARS)
					.optional()
					.describe("Free-text detail. Required when `reason` is `other`."),
			})
			.refine((value) => value.reason !== "other" || (value.detail?.length ?? 0) > 0, {
				error: "`detail` is required when `reason` is `other`.",
				path: ["detail"],
			}),
		output: z.object({
			id: z.string().describe("The created report's unique identifier."),
			reportCount: z.number().int().describe("The post's report count after this report."),
		}),
	},

	/** POST /recruitment/posts/{id}/to-application — one-click hand-off to the pipeline. */
	convertToApplication: {
		input: idSchema.extend({
			resumeId: z.string().optional().describe("Resume to attach to the new application, if any."),
		}),
		output: z.object({
			applicationId: z.string().describe("The created application's unique identifier."),
		}),
	},
};

/**
 * Admin moderation: one endpoint, four actions.
 *
 * Kept as a discriminated union rather than four procedures so the audit trail can name the
 * action without guessing it from which fields happened to be present.
 */
const adminRecruitmentPostUpdateInputSchema = z.discriminatedUnion("action", [
	z.object({
		action: z.literal("approve").describe("Publish the post."),
		id: z.string().min(1).describe("The post's unique identifier."),
	}),
	z.object({
		action: z.literal("reject").describe("Reject the post; the reason is sent back to the submitter."),
		id: z.string().min(1).describe("The post's unique identifier."),
		rejectionReason: z
			.string()
			.trim()
			.min(1)
			.max(MAX_REJECTION_REASON_CHARS)
			.describe("Why the post was rejected. Shown to the submitter, so it has to say something."),
	}),
	z.object({
		action: z.literal("close").describe("Take the post down without deleting it."),
		id: z.string().min(1).describe("The post's unique identifier."),
	}),
	z
		.object({
			action: z.literal("edit").describe("Change fields without touching the moderation state."),
			id: z.string().min(1).describe("The post's unique identifier."),
		})
		.extend(recruitmentPostEditableSchema.shape),
]);

export const adminRecruitmentPostDto = {
	/** GET /admin/recruitment/posts — the review queue. */
	list: {
		input: z
			.object({
				search: z
					.string()
					.max(MAX_SEARCH_CHARS)
					.optional()
					.describe("Case-insensitive match against company, role, or the submitter's name."),
				status: postStatusSchema.optional().describe("Only posts in this moderation state."),
				minReportCount: z.number().int().min(0).optional().describe("Only posts reported at least this often."),
				hasDeadlinePassed: z.boolean().optional().describe("Only posts whose deadline has passed."),
				createdBy: z.string().optional().describe("Only posts submitted by this user id."),
				sortBy: adminSortFieldSchema.default("createdAt"),
				sortOrder: sortOrderSchema.default("desc"),
				limit: z.number().int().min(1).max(100).default(25),
				offset: z.number().int().min(0).default(0),
			})
			.default({ sortBy: "createdAt", sortOrder: "desc", limit: 25, offset: 0 }),
		output: z.object({
			items: z.array(recruitmentPostAdminSchema).describe("The current page of posts."),
			total: z.number().describe("Total matching posts across all pages."),
		}),
	},

	/** PATCH /admin/recruitment/posts/{id} — approve, reject, close, or edit. */
	update: {
		input: adminRecruitmentPostUpdateInputSchema,
		output: z.object({
			id: z.string().describe("The post's unique identifier."),
			status: z.string().describe("The post's moderation state after the action."),
		}),
	},

	/** DELETE /admin/recruitment/posts/{id} — reports and bookmarks cascade; applications survive. */
	delete: {
		input: idSchema,
		output: z.void(),
	},
};

export const adminRecruitmentReportDto = {
	/** GET /admin/recruitment/reports — the report queue. */
	list: {
		input: z
			.object({
				postId: z.string().optional().describe("Only reports about this post."),
				reason: reportReasonSchema.optional().describe("Only reports with this reason."),
				handled: z.boolean().optional().describe("Only handled (true) or unhandled (false) reports."),
				limit: z.number().int().min(1).max(100).default(25),
				offset: z.number().int().min(0).default(0),
			})
			.default({ limit: 25, offset: 0 }),
		output: z.object({
			items: z.array(reportAdminSchema).describe("The current page of reports."),
			total: z.number().describe("Total matching reports across all pages."),
		}),
	},

	/** PATCH /admin/recruitment/reports/{id} — mark handled or reopened. */
	update: {
		input: z.object({
			id: z.string().min(1).describe("The report's unique identifier."),
			handled: z.boolean().describe("True to mark handled (records who and when), false to reopen."),
		}),
		output: z.object({
			id: z.string().describe("The report's unique identifier."),
			handled: z.boolean().describe("The report's handled flag after the action."),
		}),
	},
};

export type RecruitmentPostPublic = z.infer<typeof recruitmentPostPublicSchema>;
export type RecruitmentPostOwner = z.infer<typeof recruitmentOwnerSchema>;
export type RecruitmentPostAdmin = z.infer<typeof recruitmentPostAdminSchema>;
export type RecruitmentReportAdmin = z.infer<typeof reportAdminSchema>;

export type RecruitmentPostListInput = z.infer<typeof recruitmentPostDto.list.input>;
export type RecruitmentPostCreateInput = z.infer<typeof recruitmentPostDto.create.input>;
export type RecruitmentPostUpdateInput = z.infer<typeof recruitmentPostDto.update.input>;
export type AdminRecruitmentPostListInput = z.infer<typeof adminRecruitmentPostDto.list.input>;
export type AdminRecruitmentPostUpdateInput = z.infer<typeof adminRecruitmentPostDto.update.input>;
export type AdminRecruitmentReportListInput = z.infer<typeof adminRecruitmentReportDto.list.input>;
