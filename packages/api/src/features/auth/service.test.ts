import { afterEach, describe, expect, it, vi } from "vitest";

const envMock = vi.hoisted(() => ({
	GOOGLE_CLIENT_ID: undefined as string | undefined,
	GOOGLE_CLIENT_SECRET: undefined as string | undefined,
	GITHUB_CLIENT_ID: undefined as string | undefined,
	GITHUB_CLIENT_SECRET: undefined as string | undefined,
	LINKEDIN_CLIENT_ID: undefined as string | undefined,
	LINKEDIN_CLIENT_SECRET: undefined as string | undefined,
	OAUTH_CLIENT_ID: undefined as string | undefined,
	OAUTH_CLIENT_SECRET: undefined as string | undefined,
	OAUTH_PROVIDER_NAME: undefined as string | undefined,
	WECHAT_APP_ID: undefined as string | undefined,
	WECHAT_APP_SECRET: undefined as string | undefined,
	ALIPAY_APP_ID: undefined as string | undefined,
	ALIPAY_PRIVATE_KEY: undefined as string | undefined,
	ALIPAY_PUBLIC_KEY: undefined as string | undefined,
}));

/** Which domestic channels the console has closed. Everything else stays open. */
const flagsMock = vi.hoisted(() => ({ wechat: false, alipay: false, sms: false }));

vi.mock("@reactive-resume/env/server", () => ({ env: envMock }));
// auth.ts also imports db client and storage; stub them with no-op surfaces.
vi.mock("@reactive-resume/db/client", () => ({ db: { delete: vi.fn() } }));
vi.mock("@reactive-resume/db/schema", () => ({ user: {} }));
vi.mock("../storage/service", () => ({ getStorageService: () => ({ delete: vi.fn() }) }));
vi.mock("@reactive-resume/auth/instance-settings", () => ({
	// Reading the switches needs the database; the service is expected to survive
	// that failing, so the mock only has to stand in for the happy path.
	resolveInstanceSettings: () =>
		Promise.resolve({
			disableSignups: { key: "disableSignups", value: false, source: "default" },
			disableEmailAuth: { key: "disableEmailAuth", value: false, source: "default" },
			disableWechatAuth: { key: "disableWechatAuth", value: flagsMock.wechat, source: "database" },
			disableAlipayAuth: { key: "disableAlipayAuth", value: flagsMock.alipay, source: "database" },
			disableSmsAuth: { key: "disableSmsAuth", value: flagsMock.sms, source: "database" },
		}),
}));

const { authService } = await import("./service");

const resetEnv = () => {
	for (const key of Object.keys(envMock) as (keyof typeof envMock)[]) envMock[key] = undefined;
	flagsMock.wechat = false;
	flagsMock.alipay = false;
	flagsMock.sms = false;
};

/** The four credentials `resolveSmsConfig` insists on before it reports the channel as usable. */
const stubSmsEnv = () => {
	vi.stubEnv("SMS_PROVIDER", "aliyun");
	vi.stubEnv("ALIYUN_ACCESS_KEY_ID", "id");
	vi.stubEnv("ALIYUN_ACCESS_KEY_SECRET", "secret");
	vi.stubEnv("ALIYUN_SMS_SIGN_NAME", "简历");
	vi.stubEnv("ALIYUN_SMS_TEMPLATE_CODE", "SMS_000001");
};

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("authService.providers.list", () => {
	it("always includes credential and passkey providers", async () => {
		resetEnv();
		const providers = await authService.providers.list();
		expect(providers.credential).toBe("Password");
		expect(providers.passkey).toBe("Passkey");
	});

	it("omits social providers when credentials are not configured", async () => {
		resetEnv();
		const providers = await authService.providers.list();
		expect(providers.google).toBeUndefined();
		expect(providers.github).toBeUndefined();
		expect(providers.linkedin).toBeUndefined();
		expect(providers.custom).toBeUndefined();
	});

	it("includes Google when both client id and secret are present", async () => {
		resetEnv();
		envMock.GOOGLE_CLIENT_ID = "id";
		envMock.GOOGLE_CLIENT_SECRET = "secret";
		const providers = await authService.providers.list();
		expect(providers.google).toBe("Google");
	});

	it("does NOT include Google when only one of id/secret is set", async () => {
		resetEnv();
		envMock.GOOGLE_CLIENT_ID = "id";
		const providers = await authService.providers.list();
		expect(providers.google).toBeUndefined();
	});

	it("includes GitHub when both client id and secret are present", async () => {
		resetEnv();
		envMock.GITHUB_CLIENT_ID = "id";
		envMock.GITHUB_CLIENT_SECRET = "secret";
		const providers = await authService.providers.list();
		expect(providers.github).toBe("GitHub");
	});

	it("includes LinkedIn when both client id and secret are present", async () => {
		resetEnv();
		envMock.LINKEDIN_CLIENT_ID = "id";
		envMock.LINKEDIN_CLIENT_SECRET = "secret";
		const providers = await authService.providers.list();
		expect(providers.linkedin).toBe("LinkedIn");
	});

	it("labels the custom OAuth provider with OAUTH_PROVIDER_NAME when set", async () => {
		resetEnv();
		envMock.OAUTH_CLIENT_ID = "id";
		envMock.OAUTH_CLIENT_SECRET = "secret";
		envMock.OAUTH_PROVIDER_NAME = "Acme SSO";
		const providers = await authService.providers.list();
		expect(providers.custom).toBe("Acme SSO");
	});

	it("falls back to 'Custom OAuth' when OAUTH_PROVIDER_NAME is not set", async () => {
		resetEnv();
		envMock.OAUTH_CLIENT_ID = "id";
		envMock.OAUTH_CLIENT_SECRET = "secret";
		const providers = await authService.providers.list();
		expect(providers.custom).toBe("Custom OAuth");
	});

	it("can register multiple social providers at once", async () => {
		resetEnv();
		envMock.GOOGLE_CLIENT_ID = "g";
		envMock.GOOGLE_CLIENT_SECRET = "g";
		envMock.GITHUB_CLIENT_ID = "h";
		envMock.GITHUB_CLIENT_SECRET = "h";
		const providers = await authService.providers.list();
		expect(providers.google).toBe("Google");
		expect(providers.github).toBe("GitHub");
	});
});

/**
 * The list drives which buttons the web app renders, so a channel that has been
 * switched off at runtime has to disappear from it. The endpoint itself is
 * closed separately by Better Auth's `hooks.before` — this only hides the button.
 */
describe("authService.providers.list runtime switches", () => {
	it("includes a domestic channel whose credentials are present and whose switch is open", async () => {
		resetEnv();
		envMock.WECHAT_APP_ID = "wx";
		envMock.WECHAT_APP_SECRET = "secret";
		envMock.ALIPAY_APP_ID = "2021";
		envMock.ALIPAY_PRIVATE_KEY = "private";
		envMock.ALIPAY_PUBLIC_KEY = "public";
		stubSmsEnv();

		const providers = await authService.providers.list();

		expect(providers.wechat).toBe("WeChat");
		expect(providers.alipay).toBe("Alipay");
		expect(providers.phone).toBe("Phone");
	});

	it("leaves a switched-off channel out even when its credentials are complete", async () => {
		resetEnv();
		envMock.WECHAT_APP_ID = "wx";
		envMock.WECHAT_APP_SECRET = "secret";
		envMock.ALIPAY_APP_ID = "2021";
		envMock.ALIPAY_PRIVATE_KEY = "private";
		envMock.ALIPAY_PUBLIC_KEY = "public";
		stubSmsEnv();
		flagsMock.wechat = true;
		flagsMock.alipay = true;
		flagsMock.sms = true;

		const providers = await authService.providers.list();

		expect(providers.wechat).toBeUndefined();
		expect(providers.alipay).toBeUndefined();
		expect(providers.phone).toBeUndefined();
	});
});
