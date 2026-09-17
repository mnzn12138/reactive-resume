import { defineConfig } from "@lingui/cli";
import { formatter } from "@lingui/format-po";

export default defineConfig({
	sourceLocale: "en-US",
	locales: ["en-US", "zh-CN", "zh-TW"],
	fallbackLocales: {
		default: "en-US",
	},
	format: formatter({
		lineNumbers: false,
	}),
	catalogs: [
		{
			path: "<rootDir>/locales/{locale}",
			include: ["src"],
		},
	],
});
