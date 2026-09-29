import { z } from "zod";
import { aiProviderSchema } from "./types";

/**
 * Mainland-China model presets.
 *
 * Every preset is a shortcut that fills the provider settings form — it does not
 * add a new provider. `openai-compatible` already accepts an arbitrary `baseURL`,
 * which is all these vendors need, so `AIProvider` stays untouched (the match in
 * `packages/api/src/features/ai/service.ts` is `.exhaustive()` and would fail to
 * compile if the enum grew).
 *
 * `name` is a brand name and is deliberately kept in its original script —
 * 通义千问 has no established English rendering.
 *
 * Accuracy caveat: the `baseURL` values were cross-checked against several public
 * sources, but none of them could be called for real from here (no API keys), so
 * they are "documented", not "verified by request". `defaultModel` is left empty
 * wherever the vendor's model ids were not corroborated — the form then asks the
 * user to paste the id from their console rather than silently guessing one.
 */
export const domesticModelPresetSchema = z.object({
	id: z.string().describe("Stable identifier for the preset."),
	name: z.string().describe("Vendor or model family name, in its original script."),
	provider: aiProviderSchema.describe("Which existing AI provider the preset is built on."),
	baseURL: z.string().describe("OpenAI-compatible endpoint for the vendor."),
	defaultModel: z.string().describe("Suggested model id, or empty when the vendor's ids were not corroborated."),
	docsUrl: z.string().describe("Where the user gets an API key and confirms the current model ids."),
	notes: z
		.string()
		.optional()
		.describe("Access quirks worth knowing before filling the form, e.g. non-bearer authentication."),
});

export type DomesticModelPreset = z.infer<typeof domesticModelPresetSchema>;

export const DOMESTIC_MODEL_PRESETS: readonly DomesticModelPreset[] = [
	{
		id: "deepseek",
		name: "DeepSeek",
		provider: "deepseek",
		baseURL: "https://api.deepseek.com/v1",
		defaultModel: "deepseek-chat",
		docsUrl: "https://platform.deepseek.com",
	},
	{
		id: "qwen",
		name: "通义千问",
		provider: "openai-compatible",
		baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
		defaultModel: "qwen-plus",
		docsUrl: "https://dashscope.console.aliyun.com",
		notes: "阿里云百炼平台。兼容模式端点与普通 DashScope 端点不同,勿混用。",
	},
	{
		id: "glm",
		name: "智谱 GLM",
		provider: "openai-compatible",
		baseURL: "https://open.bigmodel.cn/api/paas/v4",
		defaultModel: "glm-4-plus",
		docsUrl: "https://open.bigmodel.cn",
	},
	{
		id: "doubao",
		name: "豆包",
		provider: "openai-compatible",
		baseURL: "https://ark.cn-beijing.volces.com/api/v3",
		defaultModel: "doubao-pro-32k",
		docsUrl: "https://console.volcengine.com/ark",
		notes: "火山方舟。模型需先在方舟控制台创建接入点,实际模型名常为接入点 ID。",
	},
	{
		id: "kimi",
		name: "Kimi",
		provider: "openai-compatible",
		baseURL: "https://api.moonshot.cn/v1",
		defaultModel: "moonshot-v1-8k",
		docsUrl: "https://platform.moonshot.cn",
	},
	{
		id: "hunyuan",
		name: "腾讯混元",
		provider: "openai-compatible",
		baseURL: "https://api.hunyuan.cloud.tencent.com/v1",
		defaultModel: "hunyuan-turbo",
		docsUrl: "https://cloud.tencent.com/product/hunyuan",
	},
	{
		id: "ernie",
		name: "文心一言",
		provider: "openai-compatible",
		baseURL: "https://qianfan.baidubce.com/v2",
		defaultModel: "",
		docsUrl: "https://console.bce.baidu.com/qianfan",
		notes: "百度千帆。鉴权与其他家不同:需用 AK/SK 换取 access_token,不是直接填 API Key,模型 ID 请在控制台确认。",
	},
	{
		id: "spark",
		name: "讯飞星火",
		provider: "openai-compatible",
		baseURL: "https://spark-api-open.xf-yun.com/v1",
		defaultModel: "",
		docsUrl: "https://console.xfyun.cn",
		notes: "模型 ID 由服务版本决定(如 generalv3 / 4.0Ultra),请在控制台确认后填入。",
	},
	{
		id: "minimax",
		name: "MiniMax",
		provider: "openai-compatible",
		baseURL: "https://api.minimax.chat/v1",
		defaultModel: "",
		docsUrl: "https://platform.minimaxi.com",
		notes: "国际站与国内站域名不同,若填此地址不通可尝试国内站域名。",
	},
	{
		id: "baichuan",
		name: "百川智能",
		provider: "openai-compatible",
		baseURL: "https://api.baichuan-ai.com/v1",
		defaultModel: "Baichuan4-Turbo",
		docsUrl: "https://platform.baichuan-ai.com",
	},
	{
		id: "yi",
		name: "零一万物",
		provider: "openai-compatible",
		baseURL: "https://api.lingyiwanwu.com/v1",
		defaultModel: "yi-large",
		docsUrl: "https://platform.lingyiwanwu.com",
	},
	{
		id: "stepfun",
		name: "阶跃星辰",
		provider: "openai-compatible",
		baseURL: "https://api.stepfun.com/v1",
		defaultModel: "",
		docsUrl: "https://platform.stepfun.com",
		notes: "模型 ID 迭代较快,请在控制台确认当前可用版本。",
	},
];

/** Preset ids are the form's option values, so they must be unique and stable. */
export const findDomesticModelPreset = (id: string): DomesticModelPreset | undefined =>
	DOMESTIC_MODEL_PRESETS.find((preset) => preset.id === id);
