import { z } from "zod";
import { BASICS_BLOCK_ID, INTENTION_BLOCK_ID, STRUCTURED_SECTION_ORDER } from "./structured-text";

/**
 * A recruitment platform whose online form has its own field order and vocabulary.
 *
 * The four named sites are the ones this fork targets for Chinese job seekers (BOSS 直聘,
 * 智联招聘, 前程无忧 51job, 猎聘). `generic` is the pass-through profile: no reordering, no
 * renaming, byte-identical to `buildStructuredText` from `@reactive-resume/resume/structured-text`.
 */
export const platformIdSchema = z.enum(["generic", "boss", "zhilian", "job51", "liepin"]);

/** A platform id, or any string that is not a known id — callers resolve it with {@link getPlatformProfile}. */
export type PlatformId = z.infer<typeof platformIdSchema>;

/** Every platform id, in picker order. `generic` comes first because it is the default. */
export const RECRUITMENT_PLATFORMS: readonly PlatformId[] = platformIdSchema.options;

export const DEFAULT_PLATFORM_ID: PlatformId = "generic";

/** Section/block ids a profile can order, rename, or group. */
type BlockId = string;

/**
 * Everything one platform needs to reshape a structured export.
 *
 * The order and vocabulary below were compiled from the *public* form conventions of each site
 * (what a candidate is asked for, screen by screen, when filling in an online resume) — not from
 * any published API contract, and not confirmed by the platforms themselves. They are best
 * guesses that are cheap to correct in this file.
 */
export type PlatformProfile = {
	id: PlatformId;
	/** Display name. Brand names are proper nouns and are deliberately not translated. */
	name: string;
	/**
	 * Screen-by-screen order. Blocks absent from this list keep their relative position and are
	 * pushed to the end, so a custom section never disappears.
	 */
	sectionOrder: readonly BlockId[];
	/** Heading overrides keyed by block id, e.g. `experience` → 工作经验. */
	sectionTitles: Readonly<Record<BlockId, string>>;
	/**
	 * Field label overrides applied to every block. Keyed by the label {@link buildStructuredSections}
	 * emits, so only labels that read the same everywhere belong here — `时间` becomes `起止时间`
	 * under 教育经历 *and* under 工作经历, which is fine, whereas `在职时间` under 教育经历 is not;
	 * that belongs in {@link sectionFieldLabels}.
	 */
	fieldLabels: Readonly<Record<string, string>>;
	/** Per-block field label overrides; win over {@link fieldLabels}. Same keying, zero ambiguity. */
	sectionFieldLabels: Readonly<Record<BlockId, Readonly<Record<string, string>>>>;
	/**
	 * Labels recognised as belonging to the 求职意向 block rather than to 基本信息. Any of them the
	 * user wrote into `basics.customFields` is lifted into 求职意向; none of them exist as schema
	 * fields, so nothing appears when the user did not fill one in. Empty means "lift nothing".
	 */
	intentionLabels: readonly string[];
	/**
	 * Copy-paste chunking. Each listed group of block ids collapses into one block, everything else
	 * gets a block of its own. Empty means one block per section, which is the most granular choice.
	 */
	blockGroups: readonly (readonly BlockId[])[];
};

/**
 * Default profile: exactly what {@link buildStructuredSections} already produces.
 *
 * Keeping this empty is what guarantees `buildPlatformText(data, { platform: "generic" })` stays
 * byte-identical to `buildStructuredText(data)` — the A7 behaviour is the baseline, not a special case.
 */
const GENERIC: PlatformProfile = {
	id: "generic",
	name: "通用",
	sectionOrder: STRUCTURED_SECTION_ORDER,
	sectionTitles: {},
	fieldLabels: {},
	sectionFieldLabels: {},
	intentionLabels: [],
	blockGroups: [],
};

/**
 * BOSS 直聘 — 在线简历 is edited screen by screen in this order: 基本信息 → 求职意向 (期望职位 /
 * 期望薪资) → 工作经验 → 项目经验 → 教育经历 → 技能 → 自我评价. Certificates, awards, and language
 * rows sit after the self-evaluation as optional extras. Because 基本信息 and 求职意向 share one
 * screen they're grouped into a single copy block.
 */
const BOSS: PlatformProfile = {
	id: "boss",
	name: "BOSS 直聘",
	sectionOrder: [
		BASICS_BLOCK_ID,
		INTENTION_BLOCK_ID,
		"experience",
		"projects",
		"education",
		"skills",
		"summary",
		"certifications",
		"awards",
		"languages",
		"references",
		"profiles",
		"publications",
		"volunteer",
		"interests",
	],
	sectionTitles: {
		experience: "工作经验",
		projects: "项目经验",
		education: "教育经历",
		skills: "专业技能",
		summary: "自我评价",
		certifications: "资格证书",
		awards: "荣誉奖项",
		languages: "语言能力",
		references: "推荐人",
		profiles: "社交主页",
		publications: "出版物",
		volunteer: "志愿者经历",
		interests: "兴趣爱好",
	},
	fieldLabels: {
		求职意向: "期望职位",
		手机: "手机号",
		所在地: "所在城市",
		网址: "个人主页",
		职位: "职位名称",
		学校: "学校名称",
		专业: "专业名称",
		熟练度: "掌握程度",
	},
	sectionFieldLabels: {
		experience: { 时间: "在职时间", 工作描述: "工作内容", 地点: "工作地点" },
		projects: { 时间: "起止时间", 描述: "项目描述" },
		education: { 时间: "在校时间" },
		skills: { 关键词: "技能关键词" },
	},
	intentionLabels: ["期望职位", "期望薪资", "期望城市", "期望行业", "到岗时间", "当前状态", "求职状态", "期望工作地点"],
	blockGroups: [[BASICS_BLOCK_ID, INTENTION_BLOCK_ID]],
};

/**
 * 智联招聘 — the online resume wizard goes 基本信息 → 教育经历 → 工作经验 → 项目经验 → 技能 → 自我评价,
 * and it keeps a dedicated 语言能力 sub-form, so languages and certificates come before the
 * self-evaluation rather than after it.
 */
const ZHILIAN: PlatformProfile = {
	id: "zhilian",
	name: "智联招聘",
	sectionOrder: [
		BASICS_BLOCK_ID,
		INTENTION_BLOCK_ID,
		"education",
		"experience",
		"projects",
		"skills",
		"languages",
		"certifications",
		"summary",
		"awards",
		"references",
		"profiles",
		"publications",
		"volunteer",
		"interests",
	],
	sectionTitles: {
		experience: "工作经验",
		projects: "项目经验",
		education: "教育经历",
		skills: "专业技能",
		languages: "语言能力",
		certifications: "证书",
		summary: "自我评价",
		awards: "获奖情况",
		references: "推荐人",
		profiles: "社交主页",
		publications: "出版物",
		volunteer: "志愿者经历",
		interests: "兴趣爱好",
	},
	fieldLabels: {
		求职意向: "期望职位",
		手机: "手机号码",
		所在地: "现居城市",
		网址: "个人主页",
		职位: "担任职位",
		项目名称: "项目名称",
		学校: "学校名称",
		熟练度: "熟练程度",
	},
	sectionFieldLabels: {
		experience: { 时间: "起止时间", 工作描述: "工作职责", 地点: "工作地点" },
		projects: { 时间: "起止时间", 描述: "项目描述" },
		education: { 时间: "在校时间", 描述: "专业描述" },
		skills: { 关键词: "技能关键词" },
	},
	intentionLabels: ["期望职位", "期望薪资", "期望城市", "期望行业", "到岗时间", "当前状态", "求职状态", "期望工作地点"],
	blockGroups: [[BASICS_BLOCK_ID, INTENTION_BLOCK_ID]],
};

/**
 * 前程无忧 51job — the original 表格型 resume: 基本信息 → 教育经历 → 工作经验 → 技能/语言 → 项目
 * 经验 → 证书 → 自我评价. It front-loads the hard qualifications (education, skills, language,
 * certificates) and puts projects behind them; 自我评价 is always the last thing asked for.
 */
const JOB51: PlatformProfile = {
	id: "job51",
	name: "前程无忧 51job",
	sectionOrder: [
		BASICS_BLOCK_ID,
		INTENTION_BLOCK_ID,
		"education",
		"experience",
		"skills",
		"languages",
		"projects",
		"certifications",
		"awards",
		"summary",
		"references",
		"profiles",
		"publications",
		"volunteer",
		"interests",
	],
	sectionTitles: {
		education: "教育经历",
		experience: "工作经验",
		skills: "技能专长",
		languages: "语言能力",
		projects: "项目经验",
		certifications: "证书",
		awards: "获奖情况",
		summary: "自我评价",
		references: "推荐人",
		profiles: "社交主页",
		publications: "出版物",
		volunteer: "志愿者经历",
		interests: "兴趣爱好",
	},
	fieldLabels: {
		求职意向: "期望职位",
		手机: "联系电话",
		邮箱: "电子邮箱",
		出生年月: "出生日期",
		所在地: "目前所在地",
		网址: "个人主页",
		职位: "职务",
		项目名称: "项目名称",
		学校: "学校名称",
		学历: "学历学位",
		技能名称: "专长名称",
		熟练度: "掌握程度",
	},
	sectionFieldLabels: {
		experience: { 时间: "起止年月", 工作描述: "工作职责", 地点: "工作地点" },
		projects: { 时间: "起止年月", 描述: "项目描述" },
		education: { 时间: "起止年月", 描述: "专业描述" },
		skills: { 关键词: "专长关键词" },
	},
	intentionLabels: ["期望职位", "期望薪资", "期望城市", "期望行业", "到岗时间", "当前状态", "求职状态", "期望工作地点"],
	blockGroups: [[BASICS_BLOCK_ID, INTENTION_BLOCK_ID]],
};

/**
 * 猎聘 — oriented at experienced hires: the form follows the career narrative 基本信息 → 求职意向 →
 * 工作经历 → 教育经历 → 项目经历 and asks for credentials (证书 / 奖项) right after it, keeping
 * 自我评价 at the very end where interviewers read it for motivation rather than for facts.
 */
const LIEPIN: PlatformProfile = {
	id: "liepin",
	name: "猎聘",
	sectionOrder: [
		BASICS_BLOCK_ID,
		INTENTION_BLOCK_ID,
		"experience",
		"education",
		"projects",
		"certifications",
		"awards",
		"skills",
		"languages",
		"summary",
		"references",
		"profiles",
		"publications",
		"volunteer",
		"interests",
	],
	sectionTitles: {
		experience: "工作经历",
		education: "教育经历",
		projects: "项目经历",
		certifications: "专业证书",
		awards: "荣誉奖项",
		skills: "专业技能",
		languages: "语言能力",
		summary: "自我评价",
		references: "推荐人",
		profiles: "社交主页",
		publications: "出版物",
		volunteer: "志愿者经历",
		interests: "兴趣爱好",
	},
	fieldLabels: {
		求职意向: "期望职位",
		手机: "手机号码",
		邮箱: "邮箱地址",
		所在地: "现居地",
		网址: "个人主页",
		职位: "职务名称",
		公司名称: "企业名称",
		学校: "院校名称",
		技能名称: "专业技能",
		熟练度: "熟练程度",
	},
	sectionFieldLabels: {
		experience: { 时间: "在职时间", 工作描述: "工作职责与业绩", 地点: "工作地点" },
		projects: { 时间: "起止时间", 描述: "项目描述" },
		education: { 时间: "在校时间", 描述: "专业描述" },
		skills: { 关键词: "技能关键词" },
	},
	intentionLabels: ["期望职位", "期望薪资", "期望城市", "期望行业", "到岗时间", "当前状态", "求职状态", "期望工作地点"],
	blockGroups: [],
};

/** Every profile, keyed by id. Iterate {@link RECRUITMENT_PLATFORMS} to get picker order. */
export const PLATFORM_PROFILES: Readonly<Record<PlatformId, PlatformProfile>> = {
	generic: GENERIC,
	boss: BOSS,
	zhilian: ZHILIAN,
	job51: JOB51,
	liepin: LIEPIN,
};

/** Maps any string onto a known platform id, falling back to {@link DEFAULT_PLATFORM_ID}. */
export function resolvePlatformId(platform: string | undefined | null): PlatformId {
	const parsed = platformIdSchema.safeParse(platform);
	return parsed.success ? parsed.data : DEFAULT_PLATFORM_ID;
}

/** Looks a profile up by id. An unknown id falls back to the generic profile rather than throwing. */
export function getPlatformProfile(platform: string | undefined | null): PlatformProfile {
	return PLATFORM_PROFILES[resolvePlatformId(platform)];
}
