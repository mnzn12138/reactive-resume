import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Fakes -------------------------------------------------------------------
// `resolveInstanceSettings` awaits a `select().from().where()` chain, so the fake
// returns one thenable chain and pulls the next queued result when awaited.

// Each queued entry is either the rows to return or an Error to reject with.
const queues: { rows: (unknown[] | Error)[] } = { rows: [] };

function makeChain() {
	const chain: Record<string, unknown> = {};
	chain.from = () => chain;
	chain.where = () => chain;

	// Deliberately thenable: the service awaits the builder.
	// biome-ignore lint/suspicious/noThenProperty: see above
	chain.then = (onFulfilled: unknown, onRejected: unknown) => {
		const next = queues.rows.shift() ?? [];
		if (next instanceof Error) return Promise.reject(next).then(onFulfilled as never, onRejected as never);
		return Promise.resolve(next).then(onFulfilled as never, onRejected as never);
	};

	return chain;
}

const dbMock = { select: vi.fn(() => makeChain()) };
const envMock = vi.hoisted(() => ({ FLAG_DISABLE_SIGNUPS: false, FLAG_DISABLE_EMAIL_AUTH: false }));

vi.mock("@reactive-resume/db/client", () => ({ db: dbMock }));
vi.mock("@reactive-resume/db/schema", () => ({ instanceSetting: { key: "key", value: "value" } }));
vi.mock("@reactive-resume/env/server", () => ({ env: envMock }));

const { invalidateInstanceSettings, isEmailAuthDisabled, isSignupDisabled, resolveInstanceSettings } = await import(
	"./instance-settings"
);

beforeEach(() => {
	invalidateInstanceSettings();
	queues.rows.length = 0;
	dbMock.select.mockClear();
	envMock.FLAG_DISABLE_SIGNUPS = false;
	envMock.FLAG_DISABLE_EMAIL_AUTH = false;
	// `isEnvProvided` reads the raw environment, so both variables have to be
	// genuinely absent for the "default" cases.
	delete process.env.FLAG_DISABLE_SIGNUPS;
	delete process.env.FLAG_DISABLE_EMAIL_AUTH;
});

describe("precedence", () => {
	it("falls back to the built-in default when there is neither a row nor a variable", async () => {
		queues.rows.push([]);

		const settings = await resolveInstanceSettings();

		expect(settings.disableSignups).toEqual({ key: "disableSignups", value: false, source: "default" });
	});

	it("reports the environment as the source when the variable is set", async () => {
		process.env.FLAG_DISABLE_SIGNUPS = "true";
		envMock.FLAG_DISABLE_SIGNUPS = true;
		queues.rows.push([]);

		const settings = await resolveInstanceSettings();

		expect(settings.disableSignups).toEqual({ key: "disableSignups", value: true, source: "environment" });
	});

	it("lets a stored override win over the environment", async () => {
		process.env.FLAG_DISABLE_SIGNUPS = "true";
		envMock.FLAG_DISABLE_SIGNUPS = true;
		queues.rows.push([{ key: "disableSignups", value: false }]);

		const settings = await resolveInstanceSettings();

		expect(settings.disableSignups).toEqual({ key: "disableSignups", value: false, source: "database" });
	});

	it("treats an empty variable as unset, matching packages/env", async () => {
		process.env.FLAG_DISABLE_SIGNUPS = "";
		queues.rows.push([]);

		const settings = await resolveInstanceSettings();

		expect(settings.disableSignups.source).toBe("default");
	});

	it("ignores rows with an unknown key or a non-boolean value", async () => {
		queues.rows.push([
			{ key: "somethingElse", value: true },
			{ key: "disableEmailAuth", value: "yes" },
		]);

		const settings = await resolveInstanceSettings();

		expect(settings.disableEmailAuth.source).toBe("default");
	});
});

describe("caching", () => {
	it("serves the second call from cache instead of querying again", async () => {
		queues.rows.push([]);

		await resolveInstanceSettings();
		await resolveInstanceSettings();

		expect(dbMock.select).toHaveBeenCalledTimes(1);
	});

	it("queries again once the cache is invalidated", async () => {
		queues.rows.push([], []);

		await resolveInstanceSettings();
		invalidateInstanceSettings();
		await resolveInstanceSettings();

		expect(dbMock.select).toHaveBeenCalledTimes(2);
	});
});

describe("resilience", () => {
	it("falls back to environment values when the query fails", async () => {
		process.env.FLAG_DISABLE_SIGNUPS = "true";
		envMock.FLAG_DISABLE_SIGNUPS = true;
		queues.rows.push(new Error("database is down"));

		const settings = await resolveInstanceSettings();

		// Failing open here would change behaviour for an instance that had
		// deliberately restricted signups, so the environment value still applies.
		expect(settings.disableSignups).toEqual({ key: "disableSignups", value: true, source: "environment" });
	});
});

describe("named guards", () => {
	it("exposes the two flags Better Auth consults", async () => {
		queues.rows.push([{ key: "disableSignups", value: true }]);

		expect(await isSignupDisabled()).toBe(true);
		expect(await isEmailAuthDisabled()).toBe(false);
	});
});
