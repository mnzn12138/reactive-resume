import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Fakes -------------------------------------------------------------------
// The service runs its queries through `Promise.all`, and the array literal is
// evaluated left to right, so a single FIFO queue is enough to line the results
// up with the calls.

const queue: unknown[][] = [];

function makeChain() {
	const chain: Record<string, unknown> = {};
	for (const method of ["from", "where", "groupBy"]) chain[method] = () => chain;

	// biome-ignore lint/suspicious/noThenProperty: the service awaits the builder
	chain.then = (onFulfilled: unknown, onRejected: unknown) =>
		Promise.resolve(queue.shift() ?? []).then(onFulfilled as never, onRejected as never);

	return chain;
}

const dbMock = { select: vi.fn(() => makeChain()) };
const storageMock = { usage: vi.fn(async () => ({ objects: 4, bytes: 2048 })) };

vi.mock("@reactive-resume/db/client", () => ({ db: dbMock }));
vi.mock("@reactive-resume/db/schema", () => ({ user: { __table: "user" }, resume: { __table: "resume" } }));
vi.mock("drizzle-orm", () => ({
	count: () => "count(*)",
	eq: () => ({ op: "eq" }),
	gte: () => ({ op: "gte" }),
	sql: () => ({ op: "sql" }),
}));
vi.mock("../storage", () => ({ getStorageService: () => storageMock }));

const { adminOverviewService } = await import("./overview-service");

const todayKey = () => new Date().toISOString().slice(0, 10);

beforeEach(() => {
	dbMock.select.mockClear();
	storageMock.usage.mockReset();
	storageMock.usage.mockResolvedValue({ objects: 4, bytes: 2048 });
	queue.length = 0;
});

describe("get", () => {
	it("returns the three totals and the storage figures", async () => {
		queue.push([{ value: 12 }], [{ value: 30 }], [{ value: 7 }], []);

		const result = await adminOverviewService.get();

		expect(result.totals).toEqual({ users: 12, resumes: 30, publicResumes: 7 });
		expect(result.storage).toEqual({ objects: 4, bytes: 2048 });
		expect(storageMock.usage).toHaveBeenCalledWith("uploads/");
	});

	it("coerces missing counts to zero", async () => {
		queue.push([], [], [], []);

		const result = await adminOverviewService.get();

		expect(result.totals).toEqual({ users: 0, resumes: 0, publicResumes: 0 });
	});

	it("returns a zero-filled 30-day window ending today", async () => {
		queue.push([{ value: 0 }], [{ value: 0 }], [{ value: 0 }], [{ date: todayKey(), value: 3 }]);

		const { signups } = await adminOverviewService.get();

		expect(signups).toHaveLength(30);
		expect(signups.at(-1)).toEqual({ date: todayKey(), count: 3 });
		// Days the database did not return are filled in rather than left as holes.
		expect(signups.at(0)).toEqual({ date: signups.at(0)?.date, count: 0 });
		expect(new Set(signups.map((day) => day.date)).size).toBe(30);
	});

	it("keeps going when the storage backend cannot be reached", async () => {
		storageMock.usage.mockRejectedValue(new Error("s3 down"));
		queue.push([{ value: 1 }], [{ value: 1 }], [{ value: 1 }], []);

		const result = await adminOverviewService.get();

		// Reporting zero here would look like an empty instance, so the DTO says null.
		expect(result.storage).toBeNull();
		expect(result.totals.users).toBe(1);
	});
});
