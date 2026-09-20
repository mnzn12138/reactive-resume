import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Fake database -----------------------------------------------------------
// Same shape as the other admin service tests: one thenable chain per call, with
// results fed from a FIFO queue so `Promise.all` lines up with the call order.

const queue: unknown[][] = [];

function makeChain() {
	const chain: Record<string, unknown> = {};
	for (const method of ["from", "leftJoin", "where", "orderBy", "limit", "offset"]) chain[method] = () => chain;

	// biome-ignore lint/suspicious/noThenProperty: the service awaits the builder
	chain.then = (onFulfilled: unknown, onRejected: unknown) =>
		Promise.resolve(queue.shift() ?? []).then(onFulfilled as never, onRejected as never);

	return chain;
}

const dbMock = { select: vi.fn(() => makeChain()) };

vi.mock("@reactive-resume/db/client", () => ({ db: dbMock }));
vi.mock("@reactive-resume/db/schema", () => ({
	adminAuditLog: { __table: "adminAuditLog" },
	user: { __table: "user" },
}));
vi.mock("drizzle-orm", () => ({
	and: (...args: unknown[]) => ({ op: "and", args }),
	or: () => ({ op: "or" }),
	eq: () => ({ op: "eq" }),
	ilike: () => ({ op: "ilike" }),
	desc: () => ({ op: "desc" }),
	count: () => "count(*)",
}));

const { adminAuditService } = await import("./audit-service");

const entryRow = {
	id: "a1",
	action: "user.ban.set",
	targetType: "user",
	targetId: "u1",
	metadata: { reason: "spam" },
	createdAt: new Date("2026-09-19T10:00:00.000Z"),
	actorId: "admin1",
	actorName: "Ada",
	actorEmail: "ada@example.com",
};

beforeEach(() => {
	queue.length = 0;
	dbMock.select.mockClear();
});

describe("list", () => {
	it("returns the entry with its actor nested", async () => {
		queue.push([entryRow], [{ value: 1 }]);

		const result = await adminAuditService.list({ limit: 25, offset: 0 });

		expect(result.items[0]).toEqual({
			id: "a1",
			action: "user.ban.set",
			targetType: "user",
			targetId: "u1",
			metadata: { reason: "spam" },
			createdAt: entryRow.createdAt,
			actor: { id: "admin1", name: "Ada", email: "ada@example.com" },
		});
		expect(result.total).toBe(1);
	});

	it("reports a null actor when the administrator's account is gone", async () => {
		// `actorId` is `on delete set null`, so the history survives without them.
		queue.push([{ ...entryRow, actorId: null, actorName: null, actorEmail: null }], [{ value: 1 }]);

		const result = await adminAuditService.list({ limit: 25, offset: 0 });

		expect(result.items[0]?.actor).toBeNull();
	});

	it("normalises metadata that is not a plain object", async () => {
		queue.push(
			[
				{ ...entryRow, id: "a2", metadata: ["not", "an", "object"] },
				{ ...entryRow, id: "a3", metadata: null },
			],
			[{ value: 2 }],
		);

		const result = await adminAuditService.list({ limit: 25, offset: 0 });

		expect(result.items[0]?.metadata).toBeNull();
		expect(result.items[1]?.metadata).toBeNull();
	});

	it("returns an empty page and a zero total when nothing matches", async () => {
		queue.push([], [{ value: 0 }]);

		const result = await adminAuditService.list({ action: "user.delete", limit: 25, offset: 50 });

		expect(result.items).toEqual([]);
		expect(result.total).toBe(0);
	});

	it("coerces a missing count to zero", async () => {
		queue.push([], []);

		const result = await adminAuditService.list({ limit: 25, offset: 0 });

		expect(result.total).toBe(0);
	});
});
