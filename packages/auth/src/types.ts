import type { auth } from "./config";

export type AuthSession = {
	session: typeof auth.$Infer.Session.session;
	user: typeof auth.$Infer.Session.user;
};

// ponytail: plain union replaces z.enum solely used for type inference
// `wechat` / `alipay` / `phone` are the domestic (China) channels. Adding a
// member here is what forces every `match(...).exhaustive()` over providers to
// be revisited — see the settings authentication hooks.
export type AuthProvider =
	| "credential"
	| "passkey"
	| "google"
	| "github"
	| "linkedin"
	| "custom"
	| "wechat"
	| "alipay"
	| "phone";
