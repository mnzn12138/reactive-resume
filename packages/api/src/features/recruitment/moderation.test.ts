import type { SQL } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

/**
 * Bookmarks and reports — endpoints 8, 9, 10, 15 and 16 of §4.3.
 *
 * The properties pinned here are the ones a live database proves badly:
 *
 * - **idempotence of both bookmark endpoints**, which is what stops a double-click from
 *   becoming an error or a duplicate row;
 * - **the report's two refusals** (self-report, and a second report) and the fact that the
 *   counter is incremented *in SQL*, so two concurrent reports are both counted;
 * - **that a report nobody can see is a 404**, not a report — bookmarking and reporting run
 *   through the same visibility rule the public read does;
 * - **the handled/reopened bookkeeping** on the admin side, where `handled = false` next to a
 *   stale handler would be unattributable.
 */

type Call = { method: string; args: unknown[] };
type Chain = { kind: string; calls: Call[] };

const dbMock = vi.hoisted(() => ({
	insert: vi.fn(),
	select: vi.fn(),
	update: vi.fn(),
	delete: vi.fn(),
	transaction: vi.fn(),
}));
const settingsMock = vi.hoisted(() => ({
	isRecruitmentBoardEnabled: vi.fn(),
	isRecruitmentSubmissionEnabled: vi.fn(),
	isRecruitmentReviewRequired: vi.fn(),
	resolveInstanceSettings: vi.fn(),
}));

/** Stands in for the oRPC builder chain, so `moderationRouter.x` *is* the handler. */
const contextMock = vi.hoisted(() => {
	const procedure: Record<string, unknown> = {};
	const proxy = new Proxy(procedure, {
		get(_target, property) {
			if (property === "handler") return (handler: unknown) => handler;
			return () => proxy;
		},
	});

	return { publicProcedure: proxy, protectedProcedure: proxy, adminProcedure: proxy };
});

vi.mock("@reactive-resume/db/client", () => ({ db: dbMock }));
vi.mock("@reactive-resume/auth/instance-settings", () => settingsMock);
vi.mock("../../context", () => contextMock);

const { bookmark, listReports, moderationRouter, report, unbookmark, updateReport, adminReportRouter } = await import(
	"./moderation"
);

const chains: Chain[] = [];
const results: unknown[] = [];

/** A thenable stand-in for any drizzle builder: every link records the call and returns itself. */
function fakeQuery(kind: string, result: unknown): unknown {
	const calls: Call[] = [];
	chains.push({ kind, calls });

	const proxy = new Proxy({} as Record<string, unknown>, {
		get(_target, property) {
			if (property === "then") {
				return (onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
					Promise.resolve(result).then(onFulfilled as never, onRejected as never);
			}
			if (typeof property === "symbol") return undefined;

			return (...args: unknown[]) => {
				calls.push({ method: String(property), args });
				return proxy;
			};
		},
	});

	return proxy;
}

/** Queue one result per database statement, in call order. */
function queue(...rowSets: unknown[]) {
	chains.length = 0;
	results.length = 0;
	results.push(...rowSets);

	for (const mock of [dbMock.select, dbMock.insert, dbMock.update, dbMock.delete]) {
		mock.mockReset();
		mock.mockImplementation(() => fakeQuery(mock === dbMock.select ? "select" : "other", results.shift() ?? []));
	}

	dbMock.transaction.mockReset();
	dbMock.transaction.mockImplementation(async (callback: (tx: typeof dbMock) => unknown) => callback(dbMock));
}

const argOf = (chain: Chain | undefined, method: string) =>
	chain?.calls.find((call) => call.method === method)?.args.at(0);

const renderSql = (value: unknown) => new PgDialect().sqlToQuery(value as SQL);

const NOW = new Date("2026-09-29T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1_000;
const daysFromNow = (days: number) => new Date(NOW.getTime() + days * DAY_MS);

/** A row shaped like `writeColumns`, i.e. what `loadVisiblePost` reads. */
function visiblePost(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: "post-1",
		company: "字节跳动",
		role: "推荐系统后端工程师",
		companyLogoUrl: null,
		batch: "regular",
		employmentType: ["campus"],
		workMode: ["onsite"],
		workIntensity: ["standard"],
		locations: ["北京"],
		educationRequired: ["bachelor"],
		benefits: ["meal_allowance"],
		tags: ["Java"],
		salaryText: "20k-30k",
		deadline: daysFromNow(30),
		rolling: false,
		applyUrl: "https://example.com/apply",
		contactKind: "wechat",
		contactValue: "byte-bot",
		referralCode: "ABC123",
		summary: "负责推荐系统后端服务",
		source: "official",
		sourceUrl: "https://example.com/job",
		status: "published",
		publishedAt: NOW,
		createdBy: "user-1",
		rejectionReason: null,
		reportCount: 0,
		dedupeKey: "字节跳动|推荐系统后端工程师|北京",
		createdAt: NOW,
		updatedAt: NOW,
		...overrides,
	};
}

beforeEach(() => {
	vi.useFakeTimers({ now: NOW, shouldAdvanceTime: false });
	settingsMock.isRecruitmentBoardEnabled.mockReset();
	settingsMock.isRecruitmentBoardEnabled.mockResolvedValue(true);
	queue();
});

describe("bookmark / unbookmark (endpoints 8 and 9)", () => {
	it("saves a post idempotently, and only after checking the caller can see it", async () => {
		queue([visiblePost()], []);

		const result = await bookmark({ id: "post-1" }, { id: "user-2", role: "user" });

		expect(result).toEqual({ bookmarked: true });
		// The composite primary key is what makes a repeat a no-op rather than an error.
		expect(chains[1]?.calls.map((call) => call.method)).toContain("onConflictDoNothing");
		expect(argOf(chains[1], "values")).toEqual({ userId: "user-2", postId: "post-1" });
	});

	it("refuses a post the caller cannot see, as 404 rather than 403", async () => {
		queue([visiblePost({ status: "pending" })]);

		await expect(bookmark({ id: "post-1" }, { id: "user-2", role: "user" })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});

	it("let the author bookmark their own pending post — visibility is the same rule as the read", async () => {
		queue([visiblePost({ status: "pending", createdBy: "user-2" })]);

		await expect(bookmark({ id: "post-1" }, { id: "user-2", role: "user" })).resolves.toEqual({ bookmarked: true });
	});

	it("removes a bookmark idempotently, scoped to the caller", async () => {
		queue([]);

		const result = await unbookmark({ id: "post-1" }, { id: "user-2", role: "user" });

		expect(result).toEqual({ bookmarked: false });
		// No preceding visibility check: deleting an already-gone bookmark has to stay a no-op.
		expect(chains).toHaveLength(1);
		const { sql } = renderSql(argOf(chains[0], "where"));
		expect(sql).toContain("user_id");
		expect(sql).toContain("post_id");
	});
});

describe("report (endpoint 10)", () => {
	it("files a report and increments the counter in SQL", async () => {
		// One result per statement: the visibility read, the duplicate check, the report
		// INSERT and the counter UPDATE.
		queue([visiblePost()], [], [], [{ reportCount: 1 }]);

		const result = await report({ id: "post-1", reason: "notHiring" }, { id: "user-2", role: "user" });

		expect(result.reportCount).toBe(1);
		expect(result.id).toBeTruthy();

		// Statement 3 is the report INSERT, statement 4 the counter UPDATE — both inside the
		// transaction, so two concurrent reports cannot land one without the other.
		const values = argOf(chains[2], "values") as Record<string, unknown>;
		expect(values).toMatchObject({ postId: "post-1", reporterId: "user-2", reason: "notHiring" });

		// Incremented in the database, not read-then-written: two concurrent reports must both
		// be counted.
		const set = argOf(chains[3], "set") as Record<string, unknown>;
		expect(renderSql(set.reportCount).sql).toContain("+ 1");
	});

	it("answers 409 for a second report by the same person", async () => {
		queue([visiblePost()], [{ id: "report-1" }]);

		await expect(report({ id: "post-1", reason: "fakeInfo" }, { id: "user-2", role: "user" })).rejects.toMatchObject({
			code: "CONFLICT",
			data: { code: "RECRUITMENT_ALREADY_REPORTED", reportId: "report-1" },
		});
	});

	it("translates a unique violation the SELECT missed into the same 409", async () => {
		queue([visiblePost()], []);
		dbMock.insert.mockImplementationOnce(() => {
			const error = new Error("duplicate key value violates unique constraint") as Error & { code?: string };
			error.code = "23505";
			throw error;
		});

		await expect(report({ id: "post-1", reason: "fakeInfo" }, { id: "user-2", role: "user" })).rejects.toMatchObject({
			code: "CONFLICT",
			data: { code: "RECRUITMENT_ALREADY_REPORTED" },
		});
	});

	it("refuses a report of the caller's own post", async () => {
		queue([visiblePost({ createdBy: "user-2" })]);

		await expect(report({ id: "post-1", reason: "duplicate" }, { id: "user-2", role: "user" })).rejects.toMatchObject({
			code: "BAD_REQUEST",
			data: { code: "RECRUITMENT_SELF_REPORT" },
		});
	});

	it("refuses a report of a post the caller cannot see", async () => {
		queue([]);

		await expect(report({ id: "post-1", reason: "duplicate" }, { id: "user-2", role: "user" })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});
});

describe("admin report queue (endpoints 15 and 16)", () => {
	const reportRow = {
		id: "report-1",
		postId: "post-1",
		reason: "notHiring",
		detail: "已经招满了",
		handled: false,
		handledAt: null,
		createdAt: NOW,
		reporterId: "user-2",
		reporterName: "举报者",
		reporterEmail: "reporter@example.com",
		handlerId: null,
		handlerName: null,
		postCompany: "字节跳动",
		postRole: "推荐系统后端工程师",
		postStatus: "published",
	};

	it("pages the queue and counts the filtered set, not the page", async () => {
		queue([reportRow], [{ value: 7 }]);

		const result = await listReports({ limit: 5, offset: 10 });

		expect(result.items).toHaveLength(1);
		expect(result.total).toBe(7);
		expect(argOf(chains[0], "limit")).toBe(5);
		expect(argOf(chains[0], "offset")).toBe(10);
	});

	it("filters by handled state and by reason", async () => {
		queue([reportRow], [{ value: 1 }]);
		await listReports({ handled: false, reason: "notHiring", limit: 25, offset: 0 });

		const { sql, params } = renderSql(argOf(chains[0], "where"));
		expect(sql).toContain("handled");
		expect(sql).toContain("reason");
		expect(params).toEqual(expect.arrayContaining([false, "notHiring"]));
	});

	it("names the reporter and the post, and leaves handledBy null while unhandled", async () => {
		queue([reportRow], [{ value: 1 }]);

		const [item] = (await listReports({ limit: 25, offset: 0 })).items;

		expect(item?.reporter).toEqual({ id: "user-2", name: "举报者", email: "reporter@example.com" });
		expect(item?.post).toEqual({
			id: "post-1",
			company: "字节跳动",
			role: "推荐系统后端工程师",
			status: "published",
		});
		expect(item?.handledBy).toBeNull();
	});

	it("names the handler once handled", async () => {
		queue(
			[{ ...reportRow, handled: true, handledAt: NOW, handlerId: "admin-1", handlerName: "管理员" }],
			[{ value: 1 }],
		);

		const [item] = (await listReports({ limit: 25, offset: 0 })).items;

		expect(item?.handledBy).toEqual({ id: "admin-1", name: "管理员" });
		expect(item?.handledAt).toEqual(NOW);
	});

	it("records who handled a report and when", async () => {
		queue([{ id: "report-1" }], []);

		const result = await updateReport({ id: "report-1", handled: true }, { id: "admin-1", role: "admin" });

		expect(result).toEqual({ id: "report-1", handled: true });
		const set = argOf(chains[1], "set") as Record<string, unknown>;
		expect(set.handled).toBe(true);
		expect(set.handledBy).toBe("admin-1");
		expect(set.handledAt).toBeInstanceOf(Date);
	});

	it("clears the attribution when a report is reopened", async () => {
		queue([{ id: "report-1" }], []);

		await updateReport({ id: "report-1", handled: false }, { id: "admin-1", role: "admin" });

		const set = argOf(chains[1], "set") as Record<string, unknown>;
		expect(set.handled).toBe(false);
		// `handled = false` next to a stale handler and timestamp would be unattributable.
		expect(set.handledBy).toBeNull();
		expect(set.handledAt).toBeNull();
	});

	it("answers 404 for a report that is not there", async () => {
		queue([]);

		await expect(
			updateReport({ id: "missing", handled: true }, { id: "admin-1", role: "admin" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("the board switch (§4.5)", () => {
	it("answers 404, not 403, on every moderation endpoint while the board is off", async () => {
		settingsMock.isRecruitmentBoardEnabled.mockResolvedValue(false);

		const call = async (handler: unknown, input: unknown) => {
			const invoke = handler as (args: { input: unknown; context: unknown }) => Promise<unknown>;
			try {
				await invoke({ input, context: { user: { id: "user-2", role: "user" }, reqHeaders: new Headers() } });
				return undefined;
			} catch (error) {
				return error as { code?: string };
			}
		};

		expect(await call(moderationRouter.bookmark, { id: "post-1" })).toMatchObject({ code: "NOT_FOUND" });
		expect(await call(moderationRouter.unbookmark, { id: "post-1" })).toMatchObject({ code: "NOT_FOUND" });
		expect(await call(moderationRouter.report, { id: "post-1", reason: "notHiring" })).toMatchObject({
			code: "NOT_FOUND",
		});
		expect(await call(adminReportRouter.list, { limit: 25, offset: 0 })).toMatchObject({ code: "NOT_FOUND" });
		expect(await call(adminReportRouter.update, { id: "report-1", handled: true })).toMatchObject({
			code: "NOT_FOUND",
		});
	});
});
