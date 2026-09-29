import { isAbsolute, join } from "node:path";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import { findWorkspaceRoot } from "@reactive-resume/utils/monorepo.node";

const workspaceRoot = findWorkspaceRoot();

if (workspaceRoot) {
	try {
		// Native stand-in for dotenv: existing process.env still wins over file values.
		process.loadEnvFile(join(workspaceRoot, ".env"));
	} catch (error) {
		// A missing .env is expected (e.g. production with injected env); anything else is a real problem.
		if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
	}
}

export const env = createEnv({
	server: {
		// Application
		APP_URL: z.url({ protocol: /https?/ }),
		ROOT_RESUME_ID: z
			.string()
			.trim()
			.transform((value) => value || undefined)
			.optional(),
		SERVER_PORT: z.coerce.number().int().min(1).max(65535).default(3001),

		// Database
		DATABASE_URL: z.url({ protocol: /postgres(ql)?/ }),

		// Authentication
		AUTH_SECRET: z.string().min(1),
		BETTER_AUTH_API_KEY: z.string().min(1).optional(),

		// Social Auth (Google)
		GOOGLE_CLIENT_ID: z.string().min(1).optional(),
		GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),

		// Social Auth (GitHub)
		GITHUB_CLIENT_ID: z.string().min(1).optional(),
		GITHUB_CLIENT_SECRET: z.string().min(1).optional(),

		// Social Auth (LinkedIn)
		LINKEDIN_CLIENT_ID: z.string().min(1).optional(),
		LINKEDIN_CLIENT_SECRET: z.string().min(1).optional(),

		// Custom OAuth Provider
		OAUTH_PROVIDER_NAME: z.string().min(1).optional(),
		OAUTH_CLIENT_ID: z.string().min(1).optional(),
		OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
		OAUTH_DISCOVERY_URL: z.url({ protocol: /https?/ }).optional(),
		OAUTH_AUTHORIZATION_URL: z.url({ protocol: /https?/ }).optional(),
		OAUTH_TOKEN_URL: z.url({ protocol: /https?/ }).optional(),
		OAUTH_USER_INFO_URL: z.url({ protocol: /https?/ }).optional(),
		OAUTH_SCOPES: z
			.string()
			.min(1)
			.transform((value) => value.split(" "))
			.default(["openid", "profile", "email"]),

		// Social Auth (WeChat Open Platform — QR connect)
		WECHAT_APP_ID: z.string().min(1).optional(),
		WECHAT_APP_SECRET: z.string().min(1).optional(),

		// Social Auth (Alipay — RSA2 signed gateway calls)
		ALIPAY_APP_ID: z.string().min(1).optional(),
		ALIPAY_PRIVATE_KEY: z.string().min(1).optional(),
		ALIPAY_PUBLIC_KEY: z.string().min(1).optional(),

		// Email (SMTP)
		SMTP_HOST: z.string().min(1).optional(),
		SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
		SMTP_USER: z.string().min(1).optional(),
		SMTP_PASS: z.string().min(1).optional(),
		SMTP_FROM: z.string().min(1).optional(),
		SMTP_SECURE: z.stringbool().default(false),

		// SMS (optional until phone sign-in is enabled)
		SMS_PROVIDER: z.enum(["aliyun", "tencent"]).optional(),
		ALIYUN_ACCESS_KEY_ID: z.string().min(1).optional(),
		ALIYUN_ACCESS_KEY_SECRET: z.string().min(1).optional(),
		ALIYUN_SMS_SIGN_NAME: z.string().min(1).optional(),
		ALIYUN_SMS_TEMPLATE_CODE: z.string().min(1).optional(),
		TENCENT_SECRET_ID: z.string().min(1).optional(),
		TENCENT_SECRET_KEY: z.string().min(1).optional(),
		TENCENT_SMS_SDK_APP_ID: z.string().min(1).optional(),
		TENCENT_SMS_SIGN_NAME: z.string().min(1).optional(),
		TENCENT_SMS_TEMPLATE_ID: z.string().min(1).optional(),

		// Storage (Optional)
		STORAGE_PROVIDER: z.enum(["auto", "oss", "cos", "obs", "s3"]).default("auto"),
		LOCAL_STORAGE_PATH: z.string().min(1).refine(isAbsolute, "LOCAL_STORAGE_PATH must be an absolute path").optional(),
		S3_ACCESS_KEY_ID: z.string().min(1).optional(),
		S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
		S3_REGION: z.string().default("us-east-1"),
		S3_ENDPOINT: z.url({ protocol: /https?/ }).optional(),
		S3_BUCKET: z.string().min(1).optional(),
		S3_FORCE_PATH_STYLE: z.stringbool().default(false),

		// Fonts (optional: serve CJK fonts from your own host so PDF export works
		// offline and stops pulling ~10 MiB per face from fonts.gstatic.com)
		FONT_SELF_HOST_BASE_URL: z.string().min(1).optional(),

		// AI Agent Workspace (optional until the agent feature is used)
		REDIS_URL: z.url({ protocol: /redis(s)?/ }).optional(),
		ENCRYPTION_SECRET: z.string().min(32, "ENCRYPTION_SECRET must be at least 32 characters").optional(),

		// Feature Flags
		FLAG_DISABLE_SIGNUPS: z.stringbool().default(false),
		FLAG_DISABLE_EMAIL_AUTH: z.stringbool().default(false),
		FLAG_DISABLE_WECHAT_AUTH: z.stringbool().default(false),
		FLAG_DISABLE_ALIPAY_AUTH: z.stringbool().default(false),
		FLAG_DISABLE_SMS_AUTH: z.stringbool().default(false),
		FLAG_DISABLE_IMAGE_PROCESSING: z.stringbool().default(false),
		FLAG_DISABLE_API_RATE_LIMIT: z.stringbool().default(false),
		FLAG_ALLOW_UNSAFE_AI_BASE_URL: z.stringbool().default(false),
		FLAG_ALLOW_UNSAFE_OAUTH_REDIRECT_URI: z.stringbool().default(false),

		// Campus recruitment board (`/jobs`). Stated positively because the conservative
		// default is "off": an instance that never opted in must not grow a public,
		// user-submitted job board just because it upgraded.
		FLAG_RECRUITMENT_BOARD_ENABLED: z.stringbool().default(false),
		FLAG_RECRUITMENT_SUBMISSION_ENABLED: z.stringbool().default(false),
		FLAG_RECRUITMENT_REQUIRE_REVIEW: z.stringbool().default(true),
	},
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
});
