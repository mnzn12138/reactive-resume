import { beforeAll, describe, expect, it } from "vitest";
import { i18n } from "@lingui/core";
import { ORPCError } from "@orpc/client";
import { RECRUITMENT_ERROR_CODES, recruitmentErrorMessage, toRecruitmentFailure } from "./errors";

beforeAll(() => i18n.loadAndActivate({ locale: "en", messages: {} }));

const conflict = (code: string, extra: Record<string, unknown> = {}) =>
	new ORPCError("CONFLICT", { message: "conflict", data: { code, ...extra } });

describe("recruitment errors", () => {
	it("names the duplicate and points at the post that already holds the key", () => {
		const failure = toRecruitmentFailure(conflict(RECRUITMENT_ERROR_CODES.duplicate, { existingPostId: "post-9" }));

		expect(failure.existingPostId).toBe("post-9");
		expect(failure.message).toBe("A post for this company, role and city already exists.");
	});

	it("reads a repeated report as a report that landed, not as a failure", () => {
		const failure = toRecruitmentFailure(conflict(RECRUITMENT_ERROR_CODES.alreadyReported));

		expect(failure.alreadyReported).toBe(true);
		expect(failure.message).toBe("You have already reported this post. An administrator will look at it.");
	});

	it("tells the two 409s apart instead of collapsing them into one", () => {
		const duplicate = toRecruitmentFailure(conflict(RECRUITMENT_ERROR_CODES.duplicate));
		const reported = toRecruitmentFailure(conflict(RECRUITMENT_ERROR_CODES.alreadyReported));

		expect(duplicate.alreadyReported).toBe(false);
		expect(reported.alreadyReported).toBe(true);
		expect(duplicate.message).not.toBe(reported.message);
	});

	it("flags a closed submission so the caller can drop its entry point", () => {
		const failure = toRecruitmentFailure(
			new ORPCError("FORBIDDEN", { message: "off", data: { code: RECRUITMENT_ERROR_CODES.submissionDisabled } }),
		);

		expect(failure.submissionDisabled).toBe(true);
	});

	it("flags a switched-off board", () => {
		const failure = toRecruitmentFailure(
			new ORPCError("FORBIDDEN", { message: "off", data: { code: RECRUITMENT_ERROR_CODES.boardDisabled } }),
		);

		expect(failure.boardDisabled).toBe(true);
	});

	it("says what to fix for the cross-field rules", () => {
		expect(
			recruitmentErrorMessage(
				new ORPCError("BAD_REQUEST", { message: "x", data: { code: RECRUITMENT_ERROR_CODES.sourceRequired } }),
			),
		).toBe("Add either an application link or a link to the original announcement.");
	});

	it("falls back to a sentence rather than leaking the server's wording", () => {
		expect(recruitmentErrorMessage(new ORPCError("INTERNAL_SERVER_ERROR", { message: "connection reset" }))).toBe(
			"Something went wrong. Please try again.",
		);
	});

	it("survives errors that are not oRPC errors at all", () => {
		expect(recruitmentErrorMessage(new Error("boom"))).toBe("Something went wrong. Please try again.");
		expect(recruitmentErrorMessage(undefined)).toBe("Something went wrong. Please try again.");
	});
});
