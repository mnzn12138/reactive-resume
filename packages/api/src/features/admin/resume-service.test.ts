import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Fake database -----------------------------------------------------------
// Same shape as `service.test.ts`: every builder method returns one thenable
// chain, and the resolved value is picked from the table the chain was built
// from. `innerJoin` is a no-op here because the join is expressed in the
// selected columns, not in the mock's data.

type Queue = Record<string, unknown[][]>;

const queues: Queue = {};
const insertCalls: unknown[] = [];
const deleteCalls: string[] = [];
const updateCalls: unknown[] = [];

function takeNext(table: string | null) {
	return queues[table ?? ""]?.shift() ?? [];
}

function makeChain(initialTable?: string | null, onExecute?: (table: string | null) => void) {
	let table: string | null = initialTable ?? null;

	const chain: Record<string, unknown> = {};
	const passthrough = ["from", "where", "innerJoin", "orderBy", "limit", "offset", "set", "values", "returning"];

	for (const method of passthrough) {
		chain[method] = (arg?: unknown) => {
			if (method === "from") table = (arg as { __table?: string })?.__table ?? null;
			if (method === "set") updateCalls.push(arg);
			return chain;
		};
	}

	// Deliberately thenable: the service awaits the builder, so `then` is the
	// whole point of the fake rather than an accident.
	// biome-ignore lint/suspicious/noThenProperty: see above
	chain.then = (onFulfilled: unknown, onRejected: unknown) => {
		onExecute?.(table);
		return Promise.resolve(takeNext(table)).then(onFulfilled as never, onRejected as never);
	};

	return { chain };
}

const dbMock = {
	select: vi.fn(() => makeChain().chain),
	insert: vi.fn(() => {
		const { chain } = makeChain();
		return Object.assign(chain, {
			values: (row: unknown) => {
				insertCalls.push(row);
				return chain;
			},
		});
	}),
	update: vi.fn((table: unknown) => makeChain((table as { __table?: string })?.__table ?? null).chain),
	delete: vi.fn(
		(table: unknown) =>
			makeChain((table as { __table?: string })?.__table ?? null, (target) => {
				if (target) deleteCalls.push(target);
			}).chain,
	),
};

const storageMock = { delete: vi.fn(async () => true) };
const notifyMock = vi.fn(async () => undefined);

vi.mock("@reactive-resume/db/client", () => ({ db: dbMock }));
vi.mock("@reactive-resume/db/schema", () => ({
	user: { __table: "user" },
	resume: { __table: "resume" },
	adminAuditLog: { __table: "adminAuditLog" },
}));
vi.mock("drizzle-orm", () => ({
	and: (...args: unknown[]) => ({ op: "and", args }),
	or: () => ({ op: "or" }),
	eq: () => ({ op: "eq" }),
	ilike: () => ({ op: "ilike" }),
	asc: () => ({ op: "asc" }),
	desc: () => ({ op: "desc" }),
	count: () => "count(*)",
	// `listColumns` builds a `sql` expression for `hasPassword` at module load,
	// so the mock has to answer before the service is imported.
	sql: () => ({ op: "sql" }),
}));
vi.mock("../storage", () => ({ getStorageService: () => storageMock }));
vi.mock("../resume/events", () => ({ notifyResumeUpdated: notifyMock }));

const { adminResumeService } = await import("./resume-service");

const resumeRow = {
	id: "r1",
	name: "Senior Engineer",
	slug: "senior-engineer",
	tags: ["backend"],
	isPublic: false,
	isLocked: false,
	// The column itself is never selected; this is the value the query derives.
	hasPassword: false,
	createdAt: new Date("2026-01-01T00:00:00.000Z"),
	updatedAt: new Date("2026-02-01T00:00:00.000Z"),
	ownerId: "u1",
	ownerName: "Dana",
	ownerEmail: "dana@example.com",
	ownerUsername: "dana",
};

beforeEach(() => {
	for (const key of Object.keys(queues)) delete queues[key];
	insertCalls.length = 0;
	deleteCalls.length = 0;
	updateCalls.length = 0;
	dbMock.select.mockClear();
	dbMock.update.mockClear();
	dbMock.delete.mockClear();
	storageMock.delete.mockClear();
	notifyMock.mockClear();
});

describe("list", () => {
	it("surfaces password protection as a plain boolean and never as a column", async () => {
		queues.resume = [[{ ...resumeRow, hasPassword: true }, resumeRow], [{ value: 2 }]];
		const result = await adminResumeService.list({ sortBy: "createdAt", sortOrder: "desc", limit: 25, offset: 0 });

		expect(result.items[0]?.hasPassword).toBe(true);
		expect(result.items[1]?.hasPassword).toBe(false);
		expect(result.items[0]).not.toHaveProperty("password");
		expect(result.total).toBe(2);
	});

	it("nests the owner so the console can show who a resume belongs to", async () => {
		queues.resume = [[resumeRow], [{ value: 1 }]];
		const result = await adminResumeService.list({ sortBy: "name", sortOrder: "asc", limit: 25, offset: 0 });

		expect(result.items[0]?.owner).toEqual({
			id: "u1",
			name: "Dana",
			email: "dana@example.com",
			username: "dana",
		});
	});

	it("returns an empty page and a zero total when nothing matches", async () => {
		queues.resume = [[], [{ value: 0 }]];
		const result = await adminResumeService.list({ sortBy: "createdAt", sortOrder: "desc", limit: 25, offset: 50 });

		expect(result.items).toEqual([]);
		expect(result.total).toBe(0);
	});
});

describe("setLock", () => {
	it("leaves the resume, the audit trail and subscribers alone when the state already matches", async () => {
		queues.resume = [[{ ...resumeRow, isLocked: true }]];
		const result = await adminResumeService.setLock({ id: "r1", locked: true, actorId: "admin1" });

		expect(result.isLocked).toBe(true);
		expect(updateCalls).toHaveLength(0);
		expect(insertCalls).toHaveLength(0);
		expect(notifyMock).not.toHaveBeenCalled();
	});

	it("locks the resume, records who did it, and tells the owner", async () => {
		const updatedAt = new Date("2026-03-01T00:00:00.000Z");
		queues.resume = [[resumeRow], [{ updatedAt }]];

		const result = await adminResumeService.setLock({ id: "r1", locked: true, actorId: "admin1" });

		expect(updateCalls).toContainEqual({ isLocked: true });
		expect(insertCalls.at(-1)).toMatchObject({
			action: "resume.lock.set",
			targetType: "resume",
			targetId: "r1",
			metadata: { from: false, to: true, name: "Senior Engineer", ownerId: "u1" },
		});
		// Without this the owner's open builder would keep editing a locked resume.
		expect(notifyMock).toHaveBeenCalledWith({
			type: "resume.updated",
			resumeId: "r1",
			userId: "u1",
			updatedAt: updatedAt.toISOString(),
			mutation: "lock",
		});
		expect(result.isLocked).toBe(true);
	});

	it("unlocks a locked resume", async () => {
		queues.resume = [[{ ...resumeRow, isLocked: true }], [{ updatedAt: new Date() }]];
		const result = await adminResumeService.setLock({ id: "r1", locked: false, actorId: "admin1" });

		expect(updateCalls).toContainEqual({ isLocked: false });
		expect(result.isLocked).toBe(false);
	});

	it("404s on an unknown resume instead of writing a pointless audit entry", async () => {
		queues.resume = [[]];
		await expect(adminResumeService.setLock({ id: "nope", locked: true, actorId: "admin1" })).rejects.toThrow(
			/Resume not found/,
		);
		expect(insertCalls).toHaveLength(0);
		expect(notifyMock).not.toHaveBeenCalled();
	});
});

describe("remove", () => {
	it("deletes the row and records the owner alongside the name", async () => {
		queues.resume = [[resumeRow]];
		await adminResumeService.remove({ id: "r1", actorId: "admin1" });

		expect(deleteCalls).toContain("resume");
		expect(insertCalls.at(-1)).toMatchObject({
			action: "resume.delete",
			targetType: "resume",
			targetId: "r1",
			metadata: { name: "Senior Engineer", slug: "senior-engineer", ownerId: "u1" },
		});
	});

	it("clears the files named after the resume but leaves shared pictures alone", async () => {
		queues.resume = [[resumeRow]];
		await adminResumeService.remove({ id: "r1", actorId: "admin1" });

		expect(storageMock.delete).toHaveBeenCalledWith("uploads/u1/screenshots/r1");
		expect(storageMock.delete).toHaveBeenCalledWith("uploads/u1/pdfs/r1");
		expect(storageMock.delete).not.toHaveBeenCalledWith(expect.stringContaining("pictures"));
	});

	it("still deletes the resume when storage cleanup fails", async () => {
		storageMock.delete.mockRejectedValue(new Error("s3 down"));
		queues.resume = [[resumeRow]];

		await expect(adminResumeService.remove({ id: "r1", actorId: "admin1" })).resolves.toBeUndefined();
		expect(deleteCalls).toContain("resume");
	});

	it("broadcasts the deletion so an open dashboard drops the resume", async () => {
		queues.resume = [[resumeRow]];
		await adminResumeService.remove({ id: "r1", actorId: "admin1" });

		expect(notifyMock).toHaveBeenCalledWith({
			type: "resume.updated",
			resumeId: "r1",
			userId: "u1",
			updatedAt: expect.any(String),
			mutation: "delete",
		});
	});

	it("404s on an unknown resume", async () => {
		queues.resume = [[]];
		await expect(adminResumeService.remove({ id: "nope", actorId: "admin1" })).rejects.toThrow(/Resume not found/);
		expect(deleteCalls).not.toContain("resume");
		expect(storageMock.delete).not.toHaveBeenCalled();
	});
});
