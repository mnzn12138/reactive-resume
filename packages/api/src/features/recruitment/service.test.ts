import type { SQL } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ORPCError } from "@orpc/client";
import { PgDialect } from "drizzle-orm/pg-core";

/**
 * Public reads for the campus recruitment board, with the database stubbed out.
 *
 * What this file is for is the part that a live database cannot prove: the **field trimming**
 * of §4.4 and the **404 gate** of §4.5. Both are security properties, and both are decided in
 * TypeScript rather than in SQL, so they are asserted here against the exact strings that must
 * never reach a response body. Pagination, filtering and freshness are covered behaviourally
 * by an integration run against a temporary database (see the task report); what is pinned here
 * is that `total` and the page share one WHERE, and that the derived fields follow §3.6.
 */

type QueryCall = { method: string; args: unknown[] };

const dbMock = vi.hoisted(() => ({ select: vi.fn() }));
const settingsMock = vi.hoisted(() => ({
	isRecruitmentBoardEnabled: vi.fn(),
	isRecruitmentSubmissionEnabled: vi.fn(),
	isRecruitmentReviewRequired: vi.fn(),
	resolveInstanceSettings: vi.fn(),
}));

/**
 * Stands in for the oRPC builder chain. Every link returns the proxy except `handler`, which
 * hands the handler back untouched — so `crudRouter.list` *is* the handler, and the 404 gate can
 * be exercised without a server or a session.
 */
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

const { recruitmentService } = await import("./service");
const { crudRouter } = await import("./crud");
const { availabilityOf, daysUntilDeadlineOf, isExpired } = await import("./expiry");
const { buildApplicationDraft } = await import("./convert");

const NOW = new Date("2026-09-29T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1_000;

const daysFromNow = (days: number) => new Date(NOW.getTime() + days * DAY_MS);

/** A row shaped like `detailColumns`, i.e. everything the service could possibly read. */
function postRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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
		source: "official",
		sourceUrl: "https://example.com/job",
		summary: "负责推荐系统后端服务",
		status: "published",
		publishedAt: NOW,
		createdAt: NOW,
		updatedAt: NOW,
		createdBy: "user-1",
		contactKind: "wechat",
		contactValue: "byte-bot",
		referralCode: "ABC123",
		rejectionReason: null,
		...overrides,
	};
}

type FakeQuery = { calls: QueryCall[]; proxy: unknown };

/**
 * A thenable stand-in for a drizzle query builder: any link in the chain resolves to `rows` and
 * records what it was called with, so `where` / `limit` / `offset` can be inspected afterwards.
 */
function fakeQuery(rows: unknown[]): FakeQuery {
	const calls: QueryCall[] = [];

	const proxy = new Proxy({} as Record<string, unknown>, {
		get(_target, property) {
			if (property === "then") {
				return (onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
					Promise.resolve(rows).then(onFulfilled, onRejected);
			}
			if (typeof property === "symbol") return undefined;

			return (...args: unknown[]) => {
				calls.push({ method: property, args });
				return proxy;
			};
		},
	});

	return { calls, proxy };
}

const queries: FakeQuery[] = [];

/** Queue one result set per `db.select` call, in call order. */
function queueResults(...rowSets: unknown[][]) {
	queries.length = 0;
	dbMock.select.mockReset();

	for (const rows of rowSets) {
		const fake = fakeQuery(rows);
		queries.push(fake);
		dbMock.select.mockReturnValueOnce(fake.proxy);
	}

	dbMock.select.mockReturnValue(fakeQuery([]).proxy);
}

const argOf = (query: FakeQuery | undefined, method: string) =>
	query?.calls.find((call) => call.method === method)?.args.at(0);

/**
 * Render a captured condition to real Postgres SQL. Comparing the drizzle objects themselves is
 * useless here — a column holds a back-reference to its table, so nothing in a WHERE clause can
 * be deep-compared — while the rendered text is exactly what the database would be asked.
 */
const renderSql = (value: unknown) => new PgDialect().sqlToQuery(value as SQL);

type ListInput = Parameters<typeof recruitmentService.list>[0];

function listInput(overrides: Partial<ListInput> = {}): ListInput {
	return {
		sortBy: "publishedAt",
		sortOrder: "desc",
		limit: 20,
		offset: 0,
		...overrides,
	} as ListInput;
}

const callHandler = async (handler: unknown, input: unknown, user: unknown = null) => {
	const invoke = handler as (args: { input: unknown; context: unknown }) => Promise<unknown>;

	try {
		return { value: await invoke({ input, context: { user, reqHeaders: new Headers() } }) };
	} catch (error) {
		return { error };
	}
};

beforeEach(() => {
	vi.useFakeTimers({ now: NOW, shouldAdvanceTime: false });
	settingsMock.isRecruitmentBoardEnabled.mockReset();
	settingsMock.isRecruitmentBoardEnabled.mockResolvedValue(true);
	queueResults();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("recruitment freshness (§3.6)", () => {
	it("calls a rolling post rolling whatever its deadline says", () => {
		expect(availabilityOf({ rolling: true, deadline: null }, NOW)).toBe("rolling");
		expect(availabilityOf({ rolling: true, deadline: daysFromNow(-5) }, NOW)).toBe("rolling");
	});

	it("expires a post whose deadline has passed, and leaves an undated one open", () => {
		expect(availabilityOf({ rolling: false, deadline: daysFromNow(-1) }, NOW)).toBe("expired");
		expect(availabilityOf({ rolling: false, deadline: null }, NOW)).toBe("open");
	});

	it("marks a deadline within 7 days as closing soon, and one beyond it as open", () => {
		expect(availabilityOf({ rolling: false, deadline: daysFromNow(3) }, NOW)).toBe("closingSoon");
		expect(availabilityOf({ rolling: false, deadline: daysFromNow(8) }, NOW)).toBe("open");
		// Exactly 7 days out is still `open`: the boundary belongs to `closingSoon` from below.
		expect(availabilityOf({ rolling: false, deadline: daysFromNow(7) }, NOW)).toBe("open");
	});

	it("counts down whole days, and answers null where there is nothing to count", () => {
		expect(daysUntilDeadlineOf({ rolling: false, deadline: daysFromNow(3) }, NOW)).toBe(3);
		expect(daysUntilDeadlineOf({ rolling: true, deadline: daysFromNow(3) }, NOW)).toBeNull();
		expect(daysUntilDeadlineOf({ rolling: false, deadline: null }, NOW)).toBeNull();
		// A countdown never goes negative.
		expect(daysUntilDeadlineOf({ rolling: false, deadline: daysFromNow(-2) }, NOW)).toBe(0);
	});

	it("never expires a rolling post", () => {
		expect(isExpired({ rolling: true, deadline: daysFromNow(-10) }, NOW)).toBe(false);
		expect(isExpired({ rolling: false, deadline: daysFromNow(-1) }, NOW)).toBe(true);
	});
});

describe("recruitmentService.list", () => {
	it("paginates and reports the filtered total, not the page size", async () => {
		queueResults([postRow({ id: "post-25" })], [{ value: 25 }]);

		const result = await recruitmentService.list(listInput({ limit: 8, offset: 24 }));

		expect(result.items).toHaveLength(1);
		expect(result.total).toBe(25);

		const [pageQuery, countQuery] = queries;
		expect(argOf(pageQuery, "limit")).toBe(8);
		expect(argOf(pageQuery, "offset")).toBe(24);
		expect(argOf(countQuery, "limit")).toBeUndefined();
		expect(argOf(countQuery, "offset")).toBeUndefined();
	});

	it("shares one WHERE between the page and the count", async () => {
		queueResults([postRow()], [{ value: 1 }]);

		await recruitmentService.list(listInput({ search: "后端", locations: ["北京"] }));

		const [pageQuery, countQuery] = queries;
		expect(argOf(pageQuery, "where")).toBeDefined();
		// Identity, not equality: the two SELECTs of appendix B.1 must not be able to drift.
		expect(argOf(pageQuery, "where")).toBe(argOf(countQuery, "where"));
	});

	it("asks only for published posts, and for fresh ones by default", async () => {
		queueResults([postRow()], [{ value: 1 }]);

		await recruitmentService.list(listInput());

		const { sql, params } = renderSql(argOf(queries[0], "where"));

		expect(params).toContain("published");
		// The §3.6 predicate: `rolling = true OR deadline IS NULL OR deadline > now()`.
		expect(sql).toContain("rolling");
		expect(sql).toContain("deadline");
		expect(sql).toMatch(/is null/i);
		expect(queries).toHaveLength(2);
	});

	it("drops the freshness predicate when the caller asks for expired posts", async () => {
		queueResults([postRow()], [{ value: 1 }]);

		await recruitmentService.list(listInput({ includeExpired: true }));

		const { sql, params } = renderSql(argOf(queries[0], "where"));

		expect(params).toContain("published");
		expect(sql).not.toContain("deadline");
	});

	it("pushes a keyword search down to SQL, tags included", async () => {
		queueResults([postRow()], [{ value: 1 }]);

		await recruitmentService.list(listInput({ search: "后端" }));

		const { sql, params } = renderSql(argOf(queries[0], "where"));

		expect(params).toContain("%后端%");
		// `tags` is an array column: flatten it instead of comparing element-wise.
		expect(sql).toContain("array_to_string");
		expect(sql.toLocaleLowerCase()).toContain("ilike");
	});

	it("pushes an array filter down as overlap, i.e. OR within the field", async () => {
		queueResults([postRow()], [{ value: 1 }]);

		await recruitmentService.list(listInput({ employmentType: ["campus", "internship"], locations: ["北京"] }));

		const { sql, params } = renderSql(argOf(queries[0], "where"));

		// `&&` shares any element; `arrayContains` would have demanded all of them.
		expect(sql).toContain("&&");
		// `arrayOverlaps` binds one array per field rather than one parameter per element, so
		// the values are flattened before the comparison — what matters is that every value
		// is bound as a parameter and never interpolated into the statement.
		expect(params.flat()).toEqual(expect.arrayContaining(["campus", "internship", "北京"]));
	});

	it("derives availability and the countdown server-side", async () => {
		queueResults([postRow({ deadline: daysFromNow(3) })], [{ value: 1 }]);

		const [item] = (await recruitmentService.list(listInput())).items;

		expect(item?.availability).toBe("closingSoon");
		expect(item?.daysUntilDeadline).toBe(3);
		expect(item?.myApplicationId).toBeNull();
	});

	it("never puts a contact field or its value in an anonymous response", async () => {
		queueResults([postRow()], [{ value: 1 }]);

		const result = await recruitmentService.list(listInput());
		const body = JSON.stringify(result);

		// §4.4: names as well as values — a response must not even contain the words.
		for (const forbidden of ["contactValue", "contactKind", "referralCode", "reportCount", "byte-bot", "ABC123"]) {
			expect(body).not.toContain(forbidden);
		}
		// The public schema has no `contact` key at all on a list item.
		expect(Object.keys(result.items[0] ?? {})).not.toContain("contact");
	});

	it("reports bookmark state only for a signed-in caller", async () => {
		queueResults([postRow({ id: "post-9" })], [{ value: 1 }], [{ postId: "post-9" }]);

		const signedIn = await recruitmentService.list(listInput({ viewer: { userId: "user-2" } }));

		expect(signedIn.items[0]?.bookmarked).toBe(true);
		// A third SELECT: the bookmark lookup, which an anonymous caller never triggers.
		expect(queries).toHaveLength(3);

		queueResults([postRow({ id: "post-9" })], [{ value: 1 }]);
		const anonymous = await recruitmentService.list(listInput());
		expect(anonymous.items[0]?.bookmarked).toBe(false);
		expect(queries).toHaveLength(2);
	});
});

describe("recruitmentService.getById", () => {
	it("gives an anonymous caller no contact at all, rather than a hollow object", async () => {
		queueResults([postRow()]);

		const result = await recruitmentService.getById({ id: "post-1" });
		const body = JSON.stringify(result);

		expect(result.contact).toBeNull();
		expect(result.rejectionReason).toBeNull();
		for (const forbidden of ["contactValue", "referralCode", "reportCount", "byte-bot", "ABC123"]) {
			expect(body).not.toContain(forbidden);
		}
	});

	it("gives a signed-in caller the whole contact block", async () => {
		queueResults([postRow()]);

		const result = await recruitmentService.getById({ id: "post-1", viewer: { userId: "user-2" } });

		expect(result.contact).toEqual({ kind: "wechat", value: "byte-bot", referralCode: "ABC123" });
	});

	it("hands a half-written contact back as null instead of publishing it", async () => {
		queueResults([postRow({ contactValue: null })]);

		const result = await recruitmentService.getById({ id: "post-1", viewer: { userId: "user-2" } });

		expect(result.contact).toBeNull();
	});

	it("shows the submitter their own post while it is still in review, and nobody else", async () => {
		queueResults([postRow({ status: "pending", rejectionReason: "链接打不开" })]);

		const own = await recruitmentService.getById({ id: "post-1", viewer: { userId: "user-1" } });
		expect(own.status).toBe("pending");
		expect(own.rejectionReason).toBe("链接打不开");

		queueResults([postRow({ status: "pending", rejectionReason: "链接打不开" })]);
		await expect(recruitmentService.getById({ id: "post-1", viewer: { userId: "user-3" } })).rejects.toThrowError(
			ORPCError,
		);
	});

	it("hides a published post whose deadline has passed, except from its author and an admin", async () => {
		const expired = { deadline: daysFromNow(-1) };

		queueResults([postRow(expired)]);
		await expect(recruitmentService.getById({ id: "post-1" })).rejects.toThrowError(ORPCError);

		queueResults([postRow(expired)]);
		expect((await recruitmentService.getById({ id: "post-1", viewer: { userId: "user-1" } })).id).toBe("post-1");

		queueResults([postRow(expired)]);
		expect((await recruitmentService.getById({ id: "post-1", viewer: { isAdmin: true } })).id).toBe("post-1");
	});

	it("answers 404, not 403, for a post that does not exist", async () => {
		queueResults([]);

		await expect(recruitmentService.getById({ id: "missing" })).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("the board switch (§4.5)", () => {
	it("answers 404 on both public endpoints while the board is off", async () => {
		settingsMock.isRecruitmentBoardEnabled.mockResolvedValue(false);

		const listResult = await callHandler(crudRouter.list, listInput());
		const detailResult = await callHandler(crudRouter.getById, { id: "post-1" });

		expect(listResult.error).toBeInstanceOf(ORPCError);
		expect((listResult.error as { code?: string }).code).toBe("NOT_FOUND");
		expect(detailResult.error).toBeInstanceOf(ORPCError);
		expect((detailResult.error as { code?: string }).code).toBe("NOT_FOUND");
	});

	it("reaches the service once the board is on", async () => {
		settingsMock.isRecruitmentBoardEnabled.mockResolvedValue(true);
		queueResults([postRow()], [{ value: 1 }]);

		const listResult = await callHandler(crudRouter.list, listInput());

		expect(listResult.error).toBeUndefined();
		expect((listResult.value as { total: number }).total).toBe(1);
	});
});

describe("buildApplicationDraft (§5.7)", () => {
	it("maps a post onto an application draft in the saved stage", () => {
		const draft = buildApplicationDraft({
			company: "字节跳动",
			role: "后端工程师",
			locations: ["北京", "上海"],
			salaryText: "20k-30k",
			source: "official",
			applyUrl: "https://example.com/apply",
			sourceUrl: "https://example.com/job",
			summary: "负责推荐系统",
		});

		expect(draft).toEqual({
			company: "字节跳动",
			role: "后端工程师",
			location: "北京 / 上海",
			salary: "20k-30k",
			source: "official",
			sourceUrl: "https://example.com/apply",
			jobDescription: "负责推荐系统",
			status: "saved",
		});
	});

	it("falls back to the source URL and drops an empty location", () => {
		const draft = buildApplicationDraft({
			company: "腾讯",
			role: "前端工程师",
			locations: [],
			salaryText: null,
			source: null,
			applyUrl: null,
			sourceUrl: "https://example.com/job",
			summary: null,
		});

		expect(draft.sourceUrl).toBe("https://example.com/job");
		expect(draft.location).toBeNull();
		expect(draft.salary).toBeNull();
		expect(draft.jobDescription).toBeNull();
	});
});
