import type { SQL } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

/**
 * The review queue — endpoints 12, 13 and 14 of §4.3.
 *
 * What is worth pinning in TypeScript rather than leaving to a live database:
 *
 * - **the four actions and their audit lines** (§4.7), including that a failed audit write is
 *   logged and *not* propagated — an administrator's decision must not fail because the log
 *   did;
 * - **which fields each action writes**, because `publishedAt` is the public list's sort key
 *   and a stale one would float a rejected or re-queued post to the top of the board;
 * - **`duplicateOf`**, which is computed in TypeScript and must never point at the row it is
 *   attached to;
 * - **the board switch**, which has to answer 404 on every one of them.
 *
 * Filtering and sorting are asserted against the SQL the builder renders, since that is what
 * the database would actually be asked.
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

/** Stands in for the oRPC builder chain, so `adminRecruitmentRouter.x` *is* the handler. */
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
vi.mock("../applications/service", () => ({ applicationService: { create: vi.fn() } }));

const { list, remove, update, adminRecruitmentRouter } = await import("./review");

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

/** A row shaped like `listColumns`: the owner columns plus the two joined users and the key. */
function queueRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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
		status: "pending",
		publishedAt: null,
		rejectionReason: null,
		reportCount: 0,
		createdBy: "user-1",
		dedupeKey: "字节跳动|推荐系统后端工程师|北京",
		createdAt: NOW,
		updatedAt: NOW,
		authorId: "user-1",
		authorName: "提交者",
		authorEmail: "submitter@example.com",
		reviewerId: null,
		reviewerName: null,
		...overrides,
	};
}

type ListInput = Parameters<typeof list>[0];

function listInput(overrides: Partial<ListInput> = {}): ListInput {
	return { sortBy: "createdAt", sortOrder: "desc", limit: 25, offset: 0, ...overrides } as ListInput;
}

beforeEach(() => {
	vi.useFakeTimers({ now: NOW, shouldAdvanceTime: false });
	settingsMock.isRecruitmentBoardEnabled.mockReset();
	settingsMock.isRecruitmentBoardEnabled.mockResolvedValue(true);
	settingsMock.isRecruitmentSubmissionEnabled.mockReset();
	settingsMock.isRecruitmentSubmissionEnabled.mockResolvedValue(true);
	settingsMock.isRecruitmentReviewRequired.mockReset();
	settingsMock.isRecruitmentReviewRequired.mockResolvedValue(true);
	queue();
});

describe("adminRecruitmentRouter.list (endpoint 12)", () => {
	it("pages the queue and counts the filtered set, not the page", async () => {
		queue([queueRow({ id: "post-25" })], [{ value: 25 }], [], []);

		const result = await list(listInput({ limit: 8, offset: 24 }), { id: "admin-1" });

		expect(result.items).toHaveLength(1);
		expect(result.total).toBe(25);

		const [pageQuery, countQuery] = chains;
		expect(argOf(pageQuery, "limit")).toBe(8);
		expect(argOf(pageQuery, "offset")).toBe(24);
		expect(argOf(countQuery, "limit")).toBeUndefined();
	});

	it("shares one WHERE between the page and the count", async () => {
		queue([queueRow()], [{ value: 1 }], [], []);

		await list(listInput({ status: "pending" }), { id: "admin-1" });

		const [pageQuery, countQuery] = chains;
		// Identity, not equality: the two SELECTs must not be able to drift.
		expect(argOf(pageQuery, "where")).toBe(argOf(countQuery, "where"));
	});

	it("turns minReportCount into a comparison on the counter", async () => {
		queue([queueRow()], [{ value: 1 }], [], []);

		await list(listInput({ minReportCount: 3 }), { id: "admin-1" });

		const { sql, params } = renderSql(argOf(chains[0], "where"));
		expect(sql).toContain("report_count");
		expect(params).toEqual(expect.arrayContaining([3]));
	});

	it("filters on a passed deadline, and on a live one as its negation", async () => {
		queue([queueRow()], [{ value: 1 }], [], []);
		await list(listInput({ hasDeadlinePassed: true }), { id: "admin-1" });
		const passed = renderSql(argOf(chains[0], "where"));
		expect(passed.sql.toLocaleLowerCase()).toContain("deadline");

		queue([queueRow()], [{ value: 1 }], [], []);
		await list(listInput({ hasDeadlinePassed: false }), { id: "admin-1" });
		const live = renderSql(argOf(chains[0], "where"));
		// The §3.6 predicate: rolling, undated, or still ahead of now().
		expect(live.sql).toContain("rolling");
	});

	it("searches company, role and the submitter's name", async () => {
		queue([queueRow()], [{ value: 1 }], [], []);

		await list(listInput({ search: "字节" }), { id: "admin-1" });

		const { sql, params } = renderSql(argOf(chains[0], "where"));
		expect(sql.toLocaleLowerCase()).toContain("ilike");
		expect(params).toEqual(expect.arrayContaining(["%字节%"]));
		// Three columns, so three OR-ed clauses.
		expect(sql.match(/ilike/gi)?.length).toBe(3);
	});

	it("sorts by report count when asked, always nulls last and ties broken by id", async () => {
		queue([queueRow()], [{ value: 1 }], [], []);

		await list(listInput({ sortBy: "reportCount", sortOrder: "desc" }), { id: "admin-1" });

		// `orderBy` takes the primary sort and the id tiebreaker in one call.
		const orderByArgs = chains[0]?.calls.find((call) => call.method === "orderBy")?.args ?? [];
		const rendered = orderByArgs.map((term) => renderSql(term).sql).join(", ");

		expect(rendered).toContain("report_count");
		expect(rendered.toLocaleLowerCase()).toContain("nulls last");
		expect(rendered).toContain("id");
	});

	it("names the submitter and the reviewer, and nulls them when the accounts are gone", async () => {
		queue(
			[queueRow({ id: "post-1" })],
			[{ value: 1 }],
			[
				{
					id: "post-1",
					dedupeKey: "字节跳动|推荐系统后端工程师|北京",
					company: "字节跳动",
					role: "推荐系统后端工程师",
					status: "pending",
				},
			],
			[],
		);

		const [item] = (await list(listInput(), { id: "admin-1" })).items;

		expect(item?.createdBy).toEqual({ id: "user-1", name: "提交者", email: "submitter@example.com" });
		expect(item?.reviewedBy).toBeNull();
		// The owner's private fields are part of the admin row by design (§4.3.14).
		expect(item?.contact).toEqual({ kind: "wechat", value: "byte-bot", referralCode: "ABC123" });
		expect(item?.reportCount).toBe(0);
		expect(item?.dedupeKey).toBe("字节跳动|推荐系统后端工程师|北京");
	});

	it("fills duplicateOf from the other holder of the key, never from the row itself", async () => {
		queue(
			[queueRow({ id: "post-2", dedupeKey: "k" })],
			[{ value: 1 }],
			[
				// The row itself comes back first — which is exactly why `duplicateOf` has to
				// skip it rather than take the head of the group.
				{ id: "post-2", dedupeKey: "k", company: "字节跳动", role: "后端", status: "published" },
				{ id: "post-9", dedupeKey: "k", company: "字节跳动", role: "后端", status: "pending" },
			],
			[],
		);

		const [item] = (await list(listInput(), { id: "admin-1" })).items;

		// The lookup returns every holder of the key including the row itself, so pointing at
		// the first one would make the card say "duplicate of you".
		expect(item?.duplicateOf).toEqual({ id: "post-9", company: "字节跳动", role: "后端", status: "pending" });
	});

	it("leaves duplicateOf null when the key is unique", async () => {
		queue(
			[queueRow({ id: "post-2", dedupeKey: "k" })],
			[{ value: 1 }],
			[{ id: "post-2", dedupeKey: "k", company: "字节跳动", role: "后端", status: "published" }],
			[],
		);

		const [item] = (await list(listInput(), { id: "admin-1" })).items;
		expect(item?.duplicateOf).toBeNull();
	});
});

describe("adminRecruitmentRouter.update (endpoint 13)", () => {
	const existingRow = {
		id: "post-1",
		status: "pending" as const,
		dedupeKey: "字节跳动|推荐系统后端工程师|北京",
		company: "字节跳动",
		role: "推荐系统后端工程师",
		locations: ["北京"],
		applyUrl: "https://example.com/apply",
		sourceUrl: null,
		contactKind: null,
		contactValue: null,
	};

	it("publishes on approve and writes an audit line", async () => {
		queue([existingRow], undefined, undefined);

		const result = await update({ action: "approve", id: "post-1" }, { id: "admin-1" });

		expect(result).toEqual({ id: "post-1", status: "published" });
		const set = argOf(chains[1], "set") as Record<string, unknown>;
		expect(set.status).toBe("published");
		expect(set.publishedAt).toBeInstanceOf(Date);
		expect(set.reviewedBy).toBe("admin-1");
		expect(set.reviewedAt).toBeInstanceOf(Date);
		// A previous rejection no longer describes this post.
		expect(set.rejectionReason).toBeNull();

		const audit = argOf(chains[2], "values") as Record<string, unknown>;
		expect(audit).toMatchObject({
			actorId: "admin-1",
			action: "recruitment.post.approve",
			targetType: "recruitment_post",
			targetId: "post-1",
		});
	});

	it("rejects with a reason, records who and when, and drops the publish time", async () => {
		queue([existingRow], undefined, undefined);

		const result = await update({ action: "reject", id: "post-1", rejectionReason: "链接打不开" }, { id: "admin-1" });

		expect(result).toEqual({ id: "post-1", status: "rejected" });
		const set = argOf(chains[1], "set") as Record<string, unknown>;
		expect(set.status).toBe("rejected");
		expect(set.rejectionReason).toBe("链接打不开");
		expect(set.reviewedBy).toBe("admin-1");
		// Otherwise a rejected post keeps the public list's sort key and stays ranked as live.
		expect(set.publishedAt).toBeNull();

		const audit = argOf(chains[2], "values") as Record<string, unknown>;
		expect(audit).toMatchObject({ action: "recruitment.post.reject", metadata: { reason: "链接打不开" } });
	});

	it("closes without touching publishedAt", async () => {
		queue([{ ...existingRow, status: "published" as const }], undefined, undefined);

		const result = await update({ action: "close", id: "post-1" }, { id: "admin-1" });

		expect(result.status).toBe("closed");
		const set = argOf(chains[1], "set") as Record<string, unknown>;
		expect(set.status).toBe("closed");
		// §4.3.15: the timestamp records when the post *was* on the board.
		expect(Object.keys(set)).not.toContain("publishedAt");

		const audit = argOf(chains[2], "values") as Record<string, unknown>;
		expect(audit).toMatchObject({ action: "recruitment.post.close" });
	});

	it("edits fields only, and writes no audit line", async () => {
		queue([existingRow], [], undefined);

		await update({ action: "edit", id: "post-1", summary: "改了简介" }, { id: "admin-1" });

		const set = argOf(chains[1], "set") as Record<string, unknown>;
		expect(set.summary).toBe("改了简介");
		// An administrator editing a post must not silently change its moderation state.
		expect(Object.keys(set)).not.toContain("status");
		expect(Object.keys(set)).not.toContain("publishedAt");
		// No third statement: `edit` is not one of §4.7's audited actions.
		expect(chains.filter((chain) => chain.kind === "other")).toHaveLength(1);
	});

	it("re-runs the cross-field rules against the stored row on a partial edit", async () => {
		// Only `sourceUrl` is stored; dropping it on its own would leave the post with no link.
		queue([{ ...existingRow, applyUrl: null, sourceUrl: "https://example.com/job" }], []);

		await expect(
			update({ action: "edit", id: "post-1", sourceUrl: "https://example.com/other" }, { id: "admin-1" }),
		).resolves.toBeDefined();

		queue([{ ...existingRow, applyUrl: null, sourceUrl: "https://example.com/job" }], []);
		await expect(
			update({ action: "edit", id: "post-1", contactKind: "wechat" }, { id: "admin-1" }),
		).rejects.toMatchObject({ code: "BAD_REQUEST", data: { code: "RECRUITMENT_CONTACT_INCOMPLETE" } });
	});

	it("refuses an edit whose new dedupe key is already taken", async () => {
		queue([existingRow], [{ id: "post-9", status: "published", createdBy: "user-2" }]);

		await expect(update({ action: "edit", id: "post-1", role: "前端工程师" }, { id: "admin-1" })).rejects.toMatchObject(
			{
				code: "CONFLICT",
				data: { code: "RECRUITMENT_DUPLICATE", existingPostId: "post-9", existingPostStatus: "published" },
			},
		);
	});

	it("answers 404 for a post that is not there", async () => {
		queue([]);

		await expect(update({ action: "approve", id: "missing" }, { id: "admin-1" })).rejects.toMatchObject({
			code: "NOT_FOUND",
			data: { code: "RECRUITMENT_POST_NOT_FOUND" },
		});
	});

	it("still succeeds when the audit write fails", async () => {
		queue([existingRow], undefined, undefined);
		// `recordAudit` swallows its own failures, so the insert blowing up must be invisible
		// to the caller — losing a log line is not worth failing a moderation decision.
		dbMock.insert.mockImplementationOnce(() => {
			throw new Error("audit table is on fire");
		});
		const errors = vi.spyOn(console, "error").mockImplementation(() => false);

		await expect(update({ action: "approve", id: "post-1" }, { id: "admin-1" })).resolves.toEqual({
			id: "post-1",
			status: "published",
		});
		expect(errors).toHaveBeenCalled();

		errors.mockRestore();
	});
});

describe("adminRecruitmentRouter.delete (endpoint 14)", () => {
	it("deletes the post and records the deletion", async () => {
		queue([{ id: "post-1", company: "字节跳动", role: "后端" }], undefined, undefined);

		await remove({ id: "post-1" }, { id: "admin-1" });

		expect(argOf(chains[1], "where")).toBeDefined();
		const audit = argOf(chains[2], "values") as Record<string, unknown>;
		expect(audit).toMatchObject({
			actorId: "admin-1",
			action: "recruitment.post.delete",
			targetType: "recruitment_post",
			targetId: "post-1",
		});
	});

	it("answers 404 for a post that is not there", async () => {
		queue([]);

		await expect(remove({ id: "missing" }, { id: "admin-1" })).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("the board switch (§4.5)", () => {
	it("answers 404, not 403, on all three review endpoints while the board is off", async () => {
		settingsMock.isRecruitmentBoardEnabled.mockResolvedValue(false);

		const call = async (handler: unknown, input: unknown) => {
			const invoke = handler as (args: { input: unknown; context: unknown }) => Promise<unknown>;
			try {
				await invoke({ input, context: { user: { id: "admin-1", role: "admin" }, reqHeaders: new Headers() } });
				return undefined;
			} catch (error) {
				return error as { code?: string };
			}
		};

		expect(await call(adminRecruitmentRouter.list, listInput())).toMatchObject({ code: "NOT_FOUND" });
		expect(await call(adminRecruitmentRouter.update, { action: "approve", id: "post-1" })).toMatchObject({
			code: "NOT_FOUND",
		});
		expect(await call(adminRecruitmentRouter.delete, { id: "post-1" })).toMatchObject({ code: "NOT_FOUND" });
	});
});
