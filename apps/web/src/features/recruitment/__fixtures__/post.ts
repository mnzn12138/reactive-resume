// @vitest-environment happy-dom

import type { RecruitmentPost, RecruitmentPostAdmin, RecruitmentPostOwner } from "../types";

/**
 * Fixtures for the board's tests.
 *
 * Everything here mirrors `recruitmentPostPublicSchema`, including the fields a client must not
 * compute itself (`availability`, `daysUntilDeadline`) — those come from the server in production,
 * and the components deliberately render them as given rather than recomputing them.
 */
export const mockPost: RecruitmentPost = {
	id: "post-1",
	company: "Example Corp",
	role: "Frontend Engineer",
	companyLogoUrl: null,
	batch: "regular",
	employmentType: ["campus"],
	workMode: ["hybrid"],
	workIntensity: ["standard"],
	locations: ["Beijing", "Shanghai"],
	educationRequired: ["bachelor"],
	benefits: ["afternoon_tea", "meal_allowance"],
	tags: [],
	salaryText: "200-300/day",
	deadline: new Date("2030-01-01T00:00:00.000Z"),
	rolling: false,
	availability: "open",
	daysUntilDeadline: 3,
	applyUrl: "https://example.com/apply",
	source: "official",
	sourceUrl: "https://example.com/announcement",
	summary: "Build the campus hiring product.",
	status: "published",
	publishedAt: new Date("2026-09-01T00:00:00.000Z"),
	createdAt: new Date("2026-09-01T00:00:00.000Z"),
	updatedAt: new Date("2026-09-01T00:00:00.000Z"),
	bookmarked: false,
	myApplicationId: null,
};

/** Same post with `contact` — everything the detail page's contact panel is allowed to know. */
export const mockPostDetail = {
	...mockPost,
	contact: { kind: "wechat" as const, value: "example-hr", referralCode: "CAMPUS-42" },
	rejectionReason: null,
};

export const mockPostAnonymous = {
	...mockPost,
	contact: null,
	rejectionReason: null,
};

/** What `recruitment.mine` returns: the owner's row, plus contact, reason and report count. */
export const mockPostOwner: RecruitmentPostOwner = {
	...mockPost,
	contact: { kind: "wechat", value: "example-hr", referralCode: "CAMPUS-42" },
	rejectionReason: null,
	reportCount: 0,
};

/** What the review queue returns: the owner's row plus submitter, reviewer and dedupe data. */
export const mockPostAdmin: RecruitmentPostAdmin = {
	...mockPostOwner,
	createdBy: { id: "user-1", name: "Zhang San", email: "zhang@example.com" },
	reviewedBy: null,
	dedupeKey: "example corp|frontend engineer|beijing",
	duplicateOf: null,
};

/** A rejected row, the state 「我的提交」 exists to explain. */
export const mockPostRejected: RecruitmentPostOwner = {
	...mockPostOwner,
	status: "rejected",
	rejectionReason: "The announcement link does not open.",
};
