import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Fake database -----------------------------------------------------------
// The service awaits chained query builders (`select().from().where().limit()`),
// so every method returns the same thenable object and the resolved value is
// picked once the chain is awaited, based on the table it was built from.

type Queue = Record<string, unknown[][]>;

const queues: Queue = {};
const insertCalls: unknown[] = [];
const deleteCalls: string[] = [];

function takeNext(table: string | null) {
	// Each entry in a table's queue is one query result; consume them in order
	// and fall back to an empty result set once exhausted.
	return queues[table ?? ""]?.shift() ?? [];
}

function makeChain(initialTable?: string | null, onExecute?: (table: string | null) => void) {
	let table: string | null = initialTable ?? null;

	const chain: Record<string, unknown> = {};
	const passthrough = ["from", "where", "orderBy", "limit", "offset", "set", "values", "returning"];

	for (const method of passthrough) {
		chain[method] = (arg?: unknown) => {
			if (method === "from") table = (arg as { __table?: string })?.__table ?? null;
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

const storageMock = { list: vi.fn(async () => ["uploads/u1/pictures/a.png"]), delete: vi.fn(async () => true) };

vi.mock("@reactive-resume/db/client", () => ({ db: dbMock }));
vi.mock("@reactive-resume/db/schema", () => ({
	user: { __table: "user" },
	resume: { __table: "resume" },
	application: { __table: "application" },
	session: { __table: "session" },
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
}));
vi.mock("../storage", () => ({ getStorageService: () => storageMock }));

const { adminUserService } = await import("./service");

const adminRow = { id: "admin1", email: "a@example.com", username: "admin", role: "admin", banned: false };
const targetRow = { id: "u1", email: "u@example.com", username: "user", role: "user", banned: false };

beforeEach(() => {
	for (const key of Object.keys(queues)) delete queues[key];
	insertCalls.length = 0;
	deleteCalls.length = 0;
	dbMock.select.mockClear();
	dbMock.update.mockClear();
	dbMock.delete.mockClear();
	storageMock.list.mockClear();
	storageMock.delete.mockClear();
	// `requireUser` reads from `user`; give every test a target user by default.
	queues.user = [[targetRow]];
});

describe("setRole guards", () => {
	it("rejects a role outside the whitelist", async () => {
		await expect(adminUserService.setRole({ id: "u1", role: "root", actorId: "admin1" })).rejects.toThrow(
			/Invalid user role/,
		);
	});

	it("refuses to demote yourself, which would lock you out of the console", async () => {
		queues.user = [[adminRow]];
		await expect(adminUserService.setRole({ id: "admin1", role: "user", actorId: "admin1" })).rejects.toThrow(
			/own administrator role/,
		);
	});
});

describe("setBan", () => {
	it("refuses to ban yourself", async () => {
		await expect(adminUserService.setBan({ id: "admin1", banned: true, actorId: "admin1" })).rejects.toThrow(
			/ban yourself/,
		);
	});

	it("drops sessions when banning so the ban takes effect immediately", async () => {
		queues.user = [[targetRow], [{ ...targetRow, banned: true }]];
		await adminUserService.setBan({ id: "u1", banned: true, reason: "spam", actorId: "admin1" });

		expect(deleteCalls).toContain("session");
	});

	it("clears reason and expiry when lifting a ban", async () => {
		queues.user = [[{ ...targetRow, banned: true, banReason: "spam" }], [{ ...targetRow, banned: false }]];
		await adminUserService.setBan({ id: "u1", banned: false, actorId: "admin1" });

		expect(deleteCalls).not.toContain("session");
		expect(insertCalls.at(-1)).toMatchObject({ action: "user.ban.lift" });
	});
});

describe("remove", () => {
	it("refuses to delete your own account", async () => {
		await expect(adminUserService.remove({ id: "admin1", actorId: "admin1" })).rejects.toThrow(/own account/);
	});

	it("refuses to delete the last administrator", async () => {
		// First read is the target, second is the admin count query.
		queues.user = [[adminRow], [{ value: 1 }]];
		await expect(adminUserService.remove({ id: "admin1", actorId: "admin2" })).rejects.toThrow(/last administrator/);
	});

	it("removes uploaded objects and then the row", async () => {
		queues.user = [[targetRow]];
		await adminUserService.remove({ id: "u1", actorId: "admin1" });

		expect(storageMock.list).toHaveBeenCalledWith("uploads/u1/");
		expect(storageMock.delete).toHaveBeenCalledWith("uploads/u1/pictures/a.png");
		expect(deleteCalls).toContain("user");
	});

	it("still deletes the account when storage cleanup fails", async () => {
		storageMock.list.mockRejectedValueOnce(new Error("s3 down"));
		queues.user = [[targetRow]];

		await expect(adminUserService.remove({ id: "u1", actorId: "admin1" })).resolves.toBeUndefined();
		expect(deleteCalls).toContain("user");
	});
});

describe("list", () => {
	it("normalises an unrecognised role to a plain user", async () => {
		queues.user = [[{ ...targetRow, role: "something-else" }], [{ value: 1 }]];
		const result = await adminUserService.list({ sortBy: "createdAt", sortOrder: "desc", limit: 25, offset: 0 });

		expect(result.items[0]?.role).toBe("user");
		expect(result.total).toBe(1);
	});
});
