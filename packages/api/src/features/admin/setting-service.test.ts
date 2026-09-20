import { beforeEach, describe, expect, it, vi } from "vitest";

const insertCalls: unknown[] = [];

function makeChain() {
	const chain: Record<string, unknown> = {};
	chain.onConflictDoUpdate = () => chain;

	// biome-ignore lint/suspicious/noThenProperty: the service awaits the builder
	chain.then = (onFulfilled: unknown, onRejected: unknown) =>
		Promise.resolve([]).then(onFulfilled as never, onRejected as never);

	return chain;
}

const dbMock = {
	insert: vi.fn(() => {
		const chain = makeChain();
		chain.values = (row: unknown) => {
			insertCalls.push(row);
			return chain;
		};
		return chain;
	}),
};

const resolveMock = vi.fn();
const invalidateMock = vi.fn();
const smtpMock = vi.fn(() => false);

vi.mock("@reactive-resume/db/client", () => ({ db: dbMock }));
vi.mock("@reactive-resume/db/schema", () => ({
	instanceSetting: { __table: "instanceSetting" },
	// `recordAudit` inserts here; omitting the export makes the audit write throw,
	// and its own try/catch would swallow that silently.
	adminAuditLog: { __table: "adminAuditLog" },
}));
vi.mock("@reactive-resume/auth/instance-settings", () => ({
	OVERRIDABLE_SETTING_KEYS: ["disableSignups", "disableEmailAuth"],
	resolveInstanceSettings: resolveMock,
	invalidateInstanceSettings: invalidateMock,
}));
vi.mock("../flags/router", () => ({ isSmtpEnabled: smtpMock }));

const { adminSettingService } = await import("./setting-service");

const resolved = (disableSignups: { value: boolean; source: string }) => ({
	disableSignups: { key: "disableSignups", ...disableSignups },
	disableEmailAuth: { key: "disableEmailAuth", value: false, source: "default" as const },
});

beforeEach(() => {
	insertCalls.length = 0;
	dbMock.insert.mockClear();
	resolveMock.mockReset();
	invalidateMock.mockClear();
	smtpMock.mockClear();
	smtpMock.mockReturnValue(false);
});

describe("get", () => {
	it("returns every overridable flag with its origin, plus read-only smtp state", async () => {
		resolveMock.mockResolvedValue(resolved({ value: true, source: "environment" }));
		smtpMock.mockReturnValue(true);

		const result = await adminSettingService.get();

		expect(result.settings).toEqual([
			{ key: "disableSignups", value: true, source: "environment" },
			{ key: "disableEmailAuth", value: false, source: "default" },
		]);
		// Derived from the SMTP configuration, never stored.
		expect(result.smtpEnabled).toBe(true);
	});
});

describe("set", () => {
	it("stores the override, drops the cache and records who made the change", async () => {
		resolveMock.mockResolvedValue(resolved({ value: false, source: "default" }));

		const result = await adminSettingService.set({ key: "disableSignups", value: true, actorId: "admin1" });

		expect(result).toEqual({ key: "disableSignups", value: true, source: "database" });
		expect(insertCalls).toContainEqual({ key: "disableSignups", value: true, updatedBy: "admin1" });
		expect(insertCalls).toContainEqual(
			expect.objectContaining({
				action: "instance.setting.set",
				targetType: "instance",
				targetId: "disableSignups",
				metadata: { from: false, to: true, previousSource: "default" },
			}),
		);
		// Without this the console would keep reading the pre-change value for a TTL.
		expect(invalidateMock).toHaveBeenCalledTimes(1);
	});

	it("does nothing when the stored override already says this", async () => {
		resolveMock.mockResolvedValue(resolved({ value: true, source: "database" }));

		const result = await adminSettingService.set({ key: "disableSignups", value: true, actorId: "admin1" });

		expect(result).toEqual({ key: "disableSignups", value: true, source: "database" });
		expect(dbMock.insert).not.toHaveBeenCalled();
		expect(invalidateMock).not.toHaveBeenCalled();
	});

	it("still writes when the value merely matches an environment variable", async () => {
		// Writing is what pins the value, so a later change to the environment
		// cannot silently flip the instance back.
		resolveMock.mockResolvedValue(resolved({ value: true, source: "environment" }));

		const result = await adminSettingService.set({ key: "disableSignups", value: true, actorId: "admin1" });

		expect(result.source).toBe("database");
		expect(insertCalls).toContainEqual({ key: "disableSignups", value: true, updatedBy: "admin1" });
		expect(insertCalls).toContainEqual(
			expect.objectContaining({ metadata: { from: true, to: true, previousSource: "environment" } }),
		);
	});
});
