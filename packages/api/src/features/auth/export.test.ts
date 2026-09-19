import { describe, expect, it, vi } from "vitest";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";

const mocks = vi.hoisted(() => ({ select: vi.fn(), predicates: [] as unknown[] }));
vi.mock("@reactive-resume/db/client", () => ({ db: { select: mocks.select } }));
vi.mock("@reactive-resume/db/schema", () => ({
	user: { id: "user.id" },
	resume: { userId: "resume.userId" },
}));
vi.mock("drizzle-orm", () => ({ eq: (column: unknown, value: unknown) => ({ column, value }) }));
vi.mock("@reactive-resume/env/server", () => ({ env: {} }));
vi.mock("../storage/service", () => ({ getStorageService: vi.fn() }));
const { authService } = await import("./service");

describe("account backup", () => {
	it("exports the profile together with every owned resume", async () => {
		for (const rows of [[{ id: "owner", name: "Owner" }], [{ id: "resume", data: defaultResumeData }]]) {
			mocks.select.mockReturnValueOnce({
				from: () => ({
					where: (predicate: unknown) => {
						mocks.predicates.push(predicate);
						return Promise.resolve(rows);
					},
				}),
			});
		}
		const exported = await authService.exportData({ userId: "owner" });
		expect(exported).toMatchObject({ resumes: [{ id: "resume" }] });
		expect(exported).not.toHaveProperty("coverLetters");
		expect(mocks.predicates).toContainEqual({ column: "resume.userId", value: "owner" });
	});
});
