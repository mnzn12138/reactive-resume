
#
  37 — 校招信息汇总(Campus Recruitment Board)设计

    状态:设计书,未实施(只定方案,不含代码改动)    日期:2026-09-21    参考实现:codecv(`acmenlei/codecv`)的 `src/views/recruit` 模块    前置阅读:[11-job-search-policy.md](./11-job-search-policy.md)(JSearch 移除记录与遗留约束)、[36-admin-console.md](./36-admin-console.md)(权限 / 审计 / 表格基座)

##
  一、目标

  给 Reactive Resume 增加一个校招 / 实习岗位信息汇总板:把散落在公司官网、公众号、内推群里的招聘信息收敛成一份可检索、可筛选、有时效管理的结构化列表。

  与参考实现的关键差别 —— codecv 的模块只做到"展示岗位";本设计把岗位接到本产品已有的 `application` 流水线上,让用户从"看到岗位"到"进入投递追踪"是一次点击,而不是复制粘贴到另一个页面。

  明确不做的事:

     |

        不做

     |

     |

        原因

     |

     |

        接入任何付费招聘数据 API

     |

     |

        见第三节,与 plan 11 的结论直接冲突

     |

     |

        爬取第三方招聘站点

     |

     |

        合规风险 + 反爬不稳定 + 需要长期维护解析器

     |

     |

        自动投递简历

     |

     |

        不可逆的外部动作,超出本产品职责边界

     |

     |

        岗位内容渲染富文本 HTML

     |

     |

        见第十一节,会重新引入已清理掉的依赖

     |

##
  二、参考实现盘点(codecv `src/views/recruit`)

  已核实文件:`src/views/recruit/{README.md,hook.ts,recruit.vue,recruits.ts}`。  路由入口:`src/router/modules/recruit.ts.not` —— `.not` 后缀即该模块未启用,内容是指向 `@/views/recruit/recruit.vue` 的 `/recruit` 路由。

###
  2.1 数据结构

  `hook.ts` 导出的 `IRecruitData` 即全部字段:

     |

        字段

     |

     |

        类型

     |

     |

        说明

     |

     |

        `logo`

     |

     |

        `string?`

     |

     |

        公司 logo,外链直出

     |

     |

        `job`

     |

     |

        `string`

     |

     |

        岗位名称

     |

     |

        `corporation`

     |

     |

        `string`

     |

     |

        公司名称

     |

     |

        `type`

     |

     |

        `string[]`

     |

     |

        招聘面向人群

     |

     |

        `tags`

     |

     |

        `string[]`

     |

     |

        公司 / 岗位标签

     |

     |

        `endTime`

     |

     |

        `string`

     |

     |

        截止时间,自由文本(示例值"尽快投递")

     |

     |

        `educational_required`

     |

     |

        `string[]`

     |

     |

        学历要求

     |

     |

        `remark`

     |

     |

        `string`

     |

     |

        备注

     |

     |

        `external_link`

     |

     |

        `string ``| { app, contact }`

     |

     |

        投递链接,或直接是联系方式

     |

  配套三组枚举常量:

  `EducationalRequiredOptions`(6 项):`985/211本科`、`不强制要求92`、`优秀可特批`、`统招本科`、`专升本`、`专科`

  `WorkEXPOptions`(5 项):`应届生`、`一年以内`、`1-3年经验`、`3-5年经验`、`5-10年经验`

  `WorkAndResetTimeOptions`(18 项):混装了工作时间(`996`/`855`/`965`/`1075`/`WLB`)、福利(`下午茶`/`餐补`/`房补`/`五险一金`/`六险一金`/`福利待遇好`)、面试特征(`面试简单`/`看中基础`)、公司类型(`创业公司`/`互联网大厂`)、制度(`不打卡`/`弹性上班`)五类语义

###
  2.2 交互

  数据来源是静态 TS 数组 `recruits.ts`(仅 1 条示例),新增岗位靠提 PR 或联系作者。

  `useData()` 维护 `pageNum` / `pageSize`(固定 8)/ `keyword` / `job` / `type` / `educational_required` / `icu` 七个参数,`watchEffect(query)` 全量重算:纯客户端 `filter` + `slice` 分页。

  页面为 `el-form`(inline)六个筛选项 + `el-table` 九列(Logo / 公司名称 / 岗位 / 工作经验 / 学历要求 / 公司标签 / 结束时间 / 投递通道 / 备注)+ `el-pagination` + 右侧 sticky 二维码侧栏(作者微信、QQ 群)。

  治理规则(`README.md` 与页面顶部同款文案):"岗位需要是真实在招人的,刷 KPI 的被发现将加入黑名单册"。

###
  2.3 值得借鉴的部分

  筛选维度选得准:学历要求、招聘人群、标签三项是中国校招场景真正用来决策的维度,不是通用招聘站那套。

  标签体系轻量:字符串数组 + 前端按索引循环配色,零配置、零管理后台,贡献者能直接看懂。

  贡献门槛低:数据结构简单到"往数组里加一个对象就能提 PR",这是它在社区能收上来数据的原因。

  投递通道允许非链接:`{ app, contact }` 兼容微信内推这种国内主流形式 —— 通用招聘站只认 URL,反而用不上。

###
  2.4 缺陷(本设计必须修正)

     |

        #

     |

     |

        问题

     |

     |

        说明

     |

     |

        1

     |

     |

        分页器恒为 1 页

     |

     |

        `query()` 内部已 `slice` 分页,而 `el-pagination` 的 `:total="data.length"` 取的是分页后的数组长度,永远 ≤ `pageSize`。需要独立的"过滤后总数"

     |

     |

        2

     |

     |

        `endTime` 无法判定时效

     |

     |

        自由文本("尽快投递")无法比较、无法自动下线,列表里长期堆着已关岗的岗位

     |

     |

        3

     |

     |

        外部链接缺安全属性

     |

     |

        `` 未带 `rel="noopener noreferrer"`(tabnabbing 风险)

     |

     |

        4

     |

     |

        联系方式公开直出

     |

     |

        `{ app, contact }` 直接渲染在公开页,微信/手机号可被爬虫批量抓取

     |

     |

        5

     |

     |

        全量客户端过滤

     |

     |

        数据全量加载到浏览器后再筛,岗位数上到四位数即不可用

     |

     |

        6

     |

     |

        枚举语义混装

     |

     |

        一个字段承担"工作时间/福利/面试特征/公司类型/制度"五种语义,"按标签筛选"无法给出正确结果

     |

     |

        7

     |

     |

        无去重

     |

     |

        同一岗位多人提交会重复展示

     |

     |

        8

     |

     |

        搜索范围反直觉

     |

     |

        `keyword` 只匹配 `corporation` 与 `remark`,不匹配 `job` 与 `tags`,用户搜岗位名搜不到

     |

##
  三、与 v5.1.0 被移除的 JSearch 职位列表的关系

  这是本设计必须先交代清楚的事,否则会被合理地质疑为"把删掉的功能加回来"。

  plan 11 记录的事实:JSearch / RapidAPI 职位列表在 v5.0.20 存在、v5.1.0 被移除;`apps/web/src/routes/dashboard/settings/job-search.tsx` 现在 `throw redirect({ to: "/dashboard/settings/integrations" })`;当前 `packages/api/src/features/agent/tools.ts` 只在 provider 支持时提供原生 `web_search`,且明确不是 JSearch 那种结构化职位结果 API。

  plan 11 还给出了恢复职位列表的前置条件清单:integration ownership、disabled-by-default configuration、credential encryption、quotas、429/timeouts、result schema、owner isolation、untrusted job-content handling。

  本设计逐条回应:

     |

        plan 11 的前置条件

     |

     |

        本设计的处置

     |

     |

        integration ownership

     |

     |

        无第三方集成。数据由本实例的用户提交 / 管理员导入,所有权在本实例

     |

     |

        credential encryption

     |

     |

        不适用。不持有任何第三方招聘 API 凭据

     |

     |

        quotas / 429 / timeouts

     |

     |

        不适用。无外部配额;自身入站限流见第七节

     |

     |

        result schema

     |

     |

        自有 Zod schema,落在 `packages/schema`(第六节)

     |

     |

        owner isolation

     |

     |

        查询一律按 `status = published` 过滤,提交者只能看到自己的 `pending` / `rejected`(第七节)

     |

     |

        untrusted job-content handling

     |

     |

        正面处理:输入约束为纯文本、链接协议白名单、公开接口绝不返回联系方式、Logo 不外链直出(第十一节)

     |

     |

        disabled by default

     |

     |

        默认关闭,复用 `instance_setting` 的 `DB > env > 默认` 三级解析(第七节)

     |

  一句话定位:这不是"恢复 JSearch",而是"把 codecv 那种社区维护的岗位板,做成本产品数据库里的一等公民,并把内容治理的账算清楚"。数据是人提交的静态信息,不是机器查询的实时结果。

##
  四、现状盘点(已核实)

     |

        能力

     |

     |

        现状

     |

     |

        位置

     |

     |

        职位申请追踪

     |

     |

        完整:六阶段流水线、看板/表格/洞察三视图、CSV 导入导出、附件

     |

     |

        `apps/web/src/features/applications/`、`packages/api/src/features/applications/`

     |

     |

        申请记录已含外部岗位字段

     |

     |

        已有 `source` / `sourceUrl` / `jobDescription` 三列 —— 正是"外部岗位转入追踪"所需的落点

     |

     |

        `packages/db/src/schema/applications.ts`

     |

     |

        阶段枚举与配色

     |

     |

        已有 `applicationStatusSchema` + `STAGES`(`saved`/`applied`/`screening`/`interview`/`offer`/`rejected`)

     |

     |

        `packages/schema/src/applications/data.ts`

     |

     |

        权限层级

     |

     |

        已有 `publicProcedure` / `protectedProcedure` / `adminProcedure`

     |

     |

        `packages/api/src/context.ts`(67 / 78 / 99 行)

     |

     |

        审计

     |

     |

        已有 `admin_audit_log` + `AUDIT_ACTIONS`(`dotted.verb` 命名)+ `AUDIT_TARGET_TYPES`

     |

     |

        `packages/api/src/audit-actions.ts`

     |

     |

        实例级运行时开关

     |

     |

        已有 三级解析(DB > env > 默认)+ `source` 标注 + TTL 缓存

     |

     |

        `packages/auth/src/instance-settings.ts`

     |

     |

        管理后台

     |

     |

        已有 独立路由树 + `beforeLoad` 守卫

     |

     |

        `apps/web/src/routes/admin/`(overview / users / resumes / audit / settings)

     |

     |

        表格组件

     |

     |

        已有 `@tanstack/react-table` v8 封装

     |

     |

        `packages/ui/src/components/data-table.tsx`

     |

     |

        服务端分页契约

     |

     |

        已有 约定 `{ items, total }` + 排序字段走 zod enum 白名单

     |

     |

        `packages/api/src/dto/admin.ts`

     |

     |

        入站限流

     |

     |

        已有 `createRatelimitMiddleware` 工厂与 7 个现成档位

     |

     |

        `packages/api/src/middleware/rate-limit/index.ts`

     |

     |

        MCP 申请工具

     |

     |

        已有 `list_applications` / `create_application` / `import_applications` 等

     |

     |

        `packages/mcp/src/tools.ts`

     |

     |

        侧边栏导航

     |

     |

        `appSidebarItems`(Resumes / Applications / Agents / ATS Checker)、`adminSidebarItems`

     |

     |

        `apps/web/src/routes/dashboard/-components/sidebar.tsx`

     |

     |

        岗位信息汇总

     |

     |

        完全没有

     |

     |

        ——

     |

  结论:地基全部现成。需要新建的只有"岗位"这一张主表、一层 API 和一个页面,外加把岗位接到 `application` 的那一次点击。

##
  五、产品定位与边界

###
  5.1 与 `applications` 的分工

  两者是漏斗的上下游,不能合并:

     |

     |

        校招信息汇总(本设计)

     |

     |

        职位申请追踪(已有)

     |

     |

        视角

     |

     |

        公共 / 半公共:一份岗位,所有用户可见

     |

     |

        私有:一条申请,只有本人可见

     |

     |

        生命周期

     |

     |

        发布 → 过期 / 下架

     |

     |

        `saved` → `applied` → … → `offer` / `rejected`

     |

     |

        数量级

     |

     |

        实例级共享,可能上千

     |

     |

        用户级,几十条

     |

     |

        写权限

     |

     |

        提交(进审核队列)+ 管理员审核

     |

     |

        本人自由增删改

     |

     |

        典型动作

     |

     |

        筛岗位、看详情、点"加入追踪"

     |

     |

        推进阶段、记录跟进、绑定简历

     |

  唯一的强连接是"加入追踪":把岗位的 `company` / `role` / `locations` / `apply_url` / 摘要预填进一条新的 `application`,`status` 初始为 `saved`,`source` 记录来源。这一步复用现有的 `applications.create`,不新写写入逻辑。

###
  5.2 定位建议

  按\*\*"自托管实例内的半公开岗位板"\*\*设计,而不是"面向公网的招聘站":

  默认关闭,由实例管理员在后台打开 —— 避免自托管用户升级后,自己的站点上凭空多出一个需要治理的内容板块。

  打开后,岗位对所有访客可见(校招信息本身不敏感),但联系方式仅登录用户可见。

  不追求规模。目标场景是"一个实验室 / 一个学院 / 一个公司的内推信息池",不是和 BOSS 直聘竞争。

##
  六、数据模型

###
  6.1 字段映射(codecv → 本设计)

     |

        codecv 字段

     |

     |

        本设计

     |

     |

        变化说明

     |

     |

        `logo`

     |

     |

        `companyLogoUrl`

     |

     |

        保留,但服务端不直出第三方图片(第十一节);缺省走首字母占位

     |

     |

        `job`

     |

     |

        `role`

     |

     |

        与 `application.role` 同名,便于一键转入时直接映射

     |

     |

        `corporation`

     |

     |

        `company`

     |

     |

        同上,与 `application.company` 同名

     |

     |

        `type[]`

     |

     |

        `employmentType[]`

     |

     |

        收敛为 `campus` / `internship` / `summerInternship` / `social`

     |

     |

        `tags[]`

     |

     |

        `tags[]` + `benefits[]`

     |

     |

        拆分:`tags` 留给自由标签,`benefits` 专管福利

     |

     |

        `endTime`(自由文本)

     |

     |

        `deadline`(timestamptz,可空)+ `rolling`(bool)

     |

     |

        结构化。`rolling = true` 即"尽快投递"

     |

     |

        `educational_required[]`

     |

     |

        `educationRequired[]`

     |

     |

        保留,枚举细化(见 6.3)

     |

     |

        `remark`

     |

     |

        `summary`

     |

     |

        改为纯文本简介,不再承载"领导很好,本人亲试"这类主观背书(见第十一节)

     |

     |

        `external_link`(string)

     |

     |

        `applyUrl`

     |

     |

        保留,协议白名单校验

     |

     |

        `external_link`(object)

     |

     |

        `contactKind` + `contactValue`

     |

     |

        不再公开渲染,仅登录可见

     |

     |

        ——

     |

     |

        `batch`

     |

     |

        新增:提前批 / 正式批 / 补录,中国校招的核心时间维度

     |

     |

        ——

     |

     |

        `locations[]`

     |

     |

        新增:独立于公司名的工作城市,否则无法按城市筛选

     |

     |

        ——

     |

     |

        `workMode[]`

     |

     |

        新增:远程 / 混合 / 坐班

     |

     |

        ——

     |

     |

        `source` + `sourceUrl`

     |

     |

        新增:来源标注与溯源

     |

     |

        ——

     |

     |

        `status` + 审核字段

     |

     |

        新增:治理必需

     |

     |

        ——

     |

     |

        `dedupeKey`

     |

     |

        新增:去重

     |

###
  6.2 表结构

  `recruitment_post` —— 岗位(主表)

     |

        字段

     |

     |

        类型

     |

     |

        说明

     |

     |

        `id`

     |

     |

        text PK

     |

     |

        `generateId()`

     |

     |

        `createdBy`

     |

     |

        text FK → `user.id`,on delete set null

     |

     |

        提交者;null 表示管理员导入

     |

     |

        `company`

     |

     |

        text notNull

     |

     |

        公司名称

     |

     |

        `role`

     |

     |

        text notNull

     |

     |

        岗位名称

     |

     |

        `companyLogoUrl`

     |

     |

        text,可空

     |

     |

        公司 logo

     |

     |

        `batch`

     |

     |

        text notNull default `'regular'`

     |

     |

        `early` / `regular` / `supplementary`

     |

     |

        `employmentType`

     |

     |

        text\[\] notNull default `{}`

     |

     |

        `campus` / `internship` / `summerInternship` / `social`

     |

     |

        `workMode`

     |

     |

        text\[\] notNull default `{}`

     |

     |

        `onsite` / `hybrid` / `remote`

     |

     |

        `locations`

     |

     |

        text\[\] notNull default `{}`

     |

     |

        工作城市(多值)

     |

     |

        `educationRequired`

     |

     |

        text\[\] notNull default `{}`

     |

     |

        学历要求枚举(见 6.3)

     |

     |

        `benefits`

     |

     |

        text\[\] notNull default `{}`

     |

     |

        福利标签

     |

     |

        `tags`

     |

     |

        text\[\] notNull default `{}`

     |

     |

        自由标签

     |

     |

        `salaryText`

     |

     |

        text,可空

     |

     |

        薪资(自由文本;校招多为区间或面议,不做结构化)

     |

     |

        `deadline`

     |

     |

        timestamptz,可空

     |

     |

        结构化截止时间

     |

     |

        `rolling`

     |

     |

        boolean notNull default false

     |

     |

        长期招聘 / 尽快投递

     |

     |

        `applyUrl`

     |

     |

        text,可空

     |

     |

        投递链接

     |

     |

        `contactKind`

     |

     |

        text,可空

     |

     |

        `wechat` / `email` / `phone` / `referral`

     |

     |

        `contactValue`

     |

     |

        text,可空

     |

     |

        联系方式值。公开接口永不返回

     |

     |

        `referralCode`

     |

     |

        text,可空

     |

     |

        内推码

     |

     |

        `summary`

     |

     |

        text,可空

     |

     |

        岗位简介(纯文本)

     |

     |

        `source`

     |

     |

        text,可空

     |

     |

        `official` / `referral` / `community`

     |

     |

        `sourceUrl`

     |

     |

        text,可空

     |

     |

        原始公告链接

     |

     |

        `dedupeKey`

     |

     |

        text notNull unique

     |

     |

        归一化去重键

     |

     |

        `status`

     |

     |

        text notNull default `'pending'`

     |

     |

        `draft` / `pending` / `published` / `rejected` / `closed` / `expired`

     |

     |

        `reviewedBy`

     |

     |

        text FK → `user.id`,on delete set null

     |

     |

        审核人

     |

     |

        `reviewedAt`

     |

     |

        timestamptz,可空

     |

     |

     |

        `publishedAt`

     |

     |

        timestamptz,可空

     |

     |

        排序键

     |

     |

        `reportCount`

     |

     |

        integer notNull default 0

     |

     |

        举报计数

     |

     |

        `createdAt` / `updatedAt`

     |

     |

        timestamptz

     |

     |

        仓库惯例

     |

  索引:`(status, publishedAt desc)`、`(deadline)`、`(dedupeKey)`、GIN on `tags` / `locations`。

  `recruitment_report` —— 举报(需独立表,因为它有"谁在什么时候举报了什么理由")

     |

        字段

     |

     |

        类型

     |

     |

        说明

     |

     |

        `id`

     |

     |

        text PK

     |

     |

     |

        `postId`

     |

     |

        text FK → `recruitment_post.id`,on delete cascade

     |

     |

     |

        `reporterId`

     |

     |

        text FK → `user.id`,on delete cascade

     |

     |

     |

        `reason`

     |

     |

        text

     |

     |

        `notHiring` / `fakeInfo` / `kpiFarming` / `duplicate` / `other`

     |

     |

        `detail`

     |

     |

        text,可空

     |

     |

     |

        `handled`

     |

     |

        boolean notNull default false

     |

     |

     |

        `createdAt`

     |

     |

        timestamptz

     |

     |

  唯一约束 `(postId, reporterId)` —— 同一人对同一岗位只能举报一次。

  `recruitment_bookmark` —— 收藏

     |

        字段

     |

     |

        类型

     |

     |

        说明

     |

     |

        `userId`

     |

     |

        text FK → `user.id`,on delete cascade

     |

     |

        复合主键之一

     |

     |

        `postId`

     |

     |

        text FK → `recruitment_post.id`,on delete cascade

     |

     |

        复合主键之一

     |

     |

        `createdAt`

     |

     |

        timestamptz

     |

     |

  `application` 加一列(可选,推荐)

     |

        字段

     |

     |

        类型

     |

     |

        说明

     |

     |

        `recruitmentPostId`

     |

     |

        text FK → `recruitment_post.id`,on delete set null

     |

     |

        让"我投过这个岗位"可反向展示;岗位删除后申请记录存活

     |

  `on delete set null` 与既有 `resumeId` 的处理一致(`packages/db/src/schema/applications.ts`),保持"申请历史永远存活"的既有语义。加列需要迁移,若首期不做,可先用 `sourceUrl` 关联。

###
  6.3 枚举(与 codecv 的对照)

  `educationRequired`:

     |

        本设计取值

     |

     |

        codecv 对应

     |

     |

        `985_211`

     |

     |

        `985/211本科`

     |

     |

        `bachelor`

     |

     |

        `统招本科`

     |

     |

        `associate`

     |

     |

        `专科`

     |

     |

        `upgraded`

     |

     |

        `专升本`

     |

     |

        `no_92_requirement`

     |

     |

        `不强制要求92`

     |

     |

        `case_by_case`

     |

     |

        `优秀可特批`

     |

  `benefits`(从 codecv 混装的 18 项里只取福利语义的):

  `afternoon_tea`(下午茶)、`meal_allowance`(餐补)、`housing_allowance`(房补)、`insurance_5`(五险一金)、`insurance_6`(六险一金)、`flexible_hours`(弹性上班)、`no_clock_in`(不打卡)

  `workMode` 承接 `WLB` / `996` 这类工作时间语义,但改为中性表达 `standard`(标准工时)/ `intensive`(高强度),把"996"这类价值判断留给岗位简介描述。这是与 codecv 的有意分歧:codecv 把 `996` 与 `WLB` 并列成可勾选标签,等于用标签做价值观评价,审核时无法客观判断,也容易变成攻击性标注。

  `AUDIT_ACTIONS` 新增(沿用 `dotted.verb`):

  ```
  recruitment.post.approve
  recruitment.post.reject
  recruitment.post.close
  recruitment.post.delete
  ```

  `AUDIT_TARGET_TYPES` 新增 `recruitment_post`。

##
  七、后端设计

###
  7.1 落位

  按 `AGENTS.md` 的职责归属表:

  ```
  packages/schema/src/recruitment/data.ts          # Zod:枚举、DTO 契约、去重键归一化
  packages/db/src/schema/recruitment.ts            # Drizzle 表定义
  migrations/_*/                               # pnpm db:generate 产出
  packages/api/src/features/recruitment/
    router.ts       # 聚合,挂到 packages/api/src/routers/index.ts 的 recruitment
    crud.ts         # 公开列表 / 详情 / 提交 / 编辑 / 删除
    review.ts       # 管理员审核
    moderation.ts   # 举报 / 收藏 / 下架
    service.ts      # 业务逻辑(不含 DB 之外的依赖)
    convert.ts      # 岗位 → application 的预填映射
    expiry.ts       # 时效判定(读时计算,非定时任务)
  packages/api/src/dto/recruitment.ts              # 输入 / 输出 schema
  packages/api/src/audit-actions.ts                # 追加 4 个动作 + 1 个 target type
  packages/api/src/middleware/rate-limit/index.ts  # 追加 recruitmentSubmissionRateLimit
  ```

  `packages/api/package.json` 新增导出行(枚举要给 web 侧筛选下拉复用,避免硬编码漂移 —— 这是 plan 36 第十四节的既有模式):

  ```json
  "./features/recruitment/options": "./src/features/recruitment/options.ts"
  ```

###
  7.2 时效判定:读时计算,不做定时任务

  这是本设计一个重要的取舍。 本仓库没有 worker / cron / 队列基础设施(`compose.dev.yml` 只有 postgres / redis / seaweedfs,没有调度器)。因此:

  不引入后台任务把过期岗位改写成 `expired`。

  "过期"是一个查询条件,不是持久状态:

    ```
    status = 'published' AND (rolling = true OR deadline IS NULL OR deadline > now())
    ```

  `status = 'expired'` 只在管理员手动下架时写入(用于表达"这个岗位我确认关掉了"),与"自然过期"区分开。

  好处:零新基础设施、无时钟漂移、无"任务没跑起来导致列表陈腐"的静默故障。代价:过期岗位的行仍留在表里(数据量级无害,且便于统计"历史岗位总量")。

###
  7.3 去重键

  `dedupeKey` 由服务端归一化生成,不信任客户端:

  ```
  lower(trim(company)) + '|' + lower(trim(role)) + '|' + (locations 排序后取首个 || '')
  ```

  归一化在 `packages/schema/src/recruitment/data.ts` 里实现并单测(全角/半角、空格、大小写、公司后缀"有限公司"剥离)。

  命中已存在且 `status = published` 的键 → 提交接口返回 `409`,并附上已有岗位 id,前端引导用户去"补充信息"而不是重复提交。

  命中 `rejected` 的键 → 允许重新提交(进审核队列),不静默吞掉。

###
  7.4 API 端点

  公开(`publicProcedure`,带限流,只返回 `published` 且未过期)

     |

        Method

     |

     |

        Path

     |

     |

        说明

     |

     |

        GET

     |

     |

        `/recruitment/posts`

     |

     |

        服务端分页 + 筛选;响应 `{ items, total }`;永不包含 `contactValue` / `referralCode`

     |

     |

        GET

     |

     |

        `/recruitment/posts/{id}`

     |

     |

        详情;联系方式字段按登录状态裁剪

     |

  受保护(`protectedProcedure`)

     |

        Method

     |

     |

        Path

     |

     |

        说明

     |

     |

        POST

     |

     |

        `/recruitment/posts`

     |

     |

        提交岗位,`status` 落 `pending`(若实例关闭审核则直接 `published`)

     |

     |

        PATCH

     |

     |

        `/recruitment/posts/{id}`

     |

     |

        编辑自己提交的岗位;已 `published` 的编辑回退到 `pending` 重新审核

     |

     |

        DELETE

     |

     |

        `/recruitment/posts/{id}`

     |

     |

        撤回自己提交的岗位

     |

     |

        GET

     |

     |

        `/recruitment/mine`

     |

     |

        我的提交(含 `pending` / `rejected` 及驳回理由)

     |

     |

        GET

     |

     |

        `/recruitment/bookmarks`

     |

     |

        我的收藏

     |

     |

        PUT / DELETE

     |

     |

        `/recruitment/posts/{id}/bookmark`

     |

     |

        收藏 / 取消收藏

     |

     |

        POST

     |

     |

        `/recruitment/posts/{id}/report`

     |

     |

        举报(唯一约束防重复)

     |

     |

        POST

     |

     |

        `/recruitment/posts/{id}/to-application`

     |

     |

        一键转入追踪:预填并调用既有 `applications.create` 逻辑

     |

  管理员(`adminProcedure`,统一 `tags: ["Internal"]`,不出现在公开 OpenAPI)

     |

        Method

     |

     |

        Path

     |

     |

        说明

     |

     |

        GET

     |

     |

        `/admin/recruitment/posts`

     |

     |

        审核队列(按 `status` / 举报数 / 提交时间筛选)

     |

     |

        PATCH

     |

     |

        `/admin/recruitment/posts/{id}`

     |

     |

        批准 / 驳回(带理由)/ 下架 / 直接编辑

     |

     |

        DELETE

     |

     |

        `/admin/recruitment/posts/{id}`

     |

     |

        删除

     |

     |

        GET

     |

     |

        `/admin/recruitment/reports`

     |

     |

        举报队列

     |

  要点:

  全部写操作落 `admin_audit_log`(审核类),审计写入不能阻断主操作(plan 36 第十一节第 8 条:先做主操作,再 `recordAudit`,`recordAudit` 内部 try/catch)。

  列表 query 的 `sortBy` / `status` / `educationRequired` 等一律 zod enum 白名单。理由见 plan 36 第十一节第 4 条:排序字段会把列 id 直接写进 URL,后端不认的取值会让整个搜索参数校验失败、页面直接报错。

  提交接口挂新档位 `recruitmentSubmissionRateLimit`(参照 `resumeMutationRateLimit` 的形状),防止有人用脚本刷岗位。

###
  7.5 实例开关

  复用 `packages/auth/src/instance-settings.ts` 的 `DB > env > 默认` 三级解析,新增:

     |

        key

     |

     |

        默认

     |

     |

        说明

     |

     |

        `recruitmentBoardEnabled`

     |

     |

        `false`

     |

     |

        总开关。关闭时公开列表返回 404(不暴露板块存在),不返回 403

     |

     |

        `recruitmentSubmissionEnabled`

     |

     |

        `false`

     |

     |

        是否允许普通用户提交;关闭时只有管理员能录入

     |

     |

        `recruitmentRequireReview`

     |

     |

        `true`

     |

     |

        用户提交是否必须审核后才公开

     |

  默认值全部取"最保守"。总开关为 `false` 时,`/jobs` 路由与 API 都要关掉,不能只是前端隐藏入口。

##
  八、前端设计

###
  8.1 路由

  ```
  apps/web/src/routes/jobs/
    index.tsx          # 公开列表(ssr: "data-only",可被搜索引擎收录)
    $postId.tsx        # 公开详情
  apps/web/src/routes/dashboard/recruitment/
    index.tsx          # 我的提交 / 收藏
  apps/web/src/routes/admin/recruitment/
    index.tsx          # 审核队列(复用 admin/route.tsx 的 beforeLoad 守卫)
  ```

  SSR 约定(`AGENTS.md` 的 Web 应用约定):公开路由用 `ssr: "data-only"`,与既有的 `apps/web/src/routes/$username/$slug.tsx` 一致;`ssr: false` 只留给 builder 预览那类纯浏览器路径。列表页不得在 SSR 路径里碰浏览器 API。

  路由生成物:新增路由文件后必须跑一次 `pnpm --filter web build`(或 `dev`),否则 `routeTree.gen.ts` 里没有 `/jobs/*`,类型检查会认不出来(plan 36 第十节第 5 条)。绝不手改 `routeTree.gen.ts`。

###
  8.2 入口

  侧边栏:`apps/web/src/routes/dashboard/-components/sidebar.tsx` 的 `appSidebarItems` 追加一项(图标建议 `MegaphoneIcon` / `BriefcaseIcon` 系列),文案走 `msg` 宏。

  管理端:`adminSidebarItems` 追加"Recruitment Review",并显示待审数量角标。

  岗位板总开关关闭时,侧边栏项不渲染(数据来自已有的 flags / instance settings context,不额外请求)。

###
  8.3 列表页

  筛选器参照 codecv 的六项,但按语义拆分并全部改为服务端筛选:

     |

        筛选项

     |

     |

        控件

     |

     |

        对应字段

     |

     |

        关键词

     |

     |

        输入框(防抖)

     |

     |

        `company` + `role` + `summary` + `tags` —— 补齐 codecv 漏掉的 `job` 与 `tags`(缺陷 8)

     |

     |

        岗位

     |

     |

        输入框

     |

     |

        `role`

     |

     |

        批次

     |

     |

        下拉

     |

     |

        `batch`

     |

     |

        招聘类型

     |

     |

        多选

     |

     |

        `employmentType`

     |

     |

        学历要求

     |

     |

        多选

     |

     |

        `educationRequired`

     |

     |

        工作地点

     |

     |

        多选

     |

     |

        `locations`

     |

     |

        福利标签

     |

     |

        多选

     |

     |

        `benefits`

     |

     |

        投递状态

     |

     |

        下拉

     |

     |

        派生:`开放中` / `即将截止`(\< 7 天) / `长期招聘`

     |

     |

        排序

     |

     |

        下拉

     |

     |

        `publishedAt desc`(默认)/ `deadline asc`

     |

  分页必须返回真实的 `total` —— 这是 codecv 缺陷 1 的直接修正。

  表格列:`Logo` / `公司` / `岗位` / `批次` / `地点` / `学历要求` / `福利标签` / `投递状态` / `操作`。

  与 codecv 九列的差异:去掉"备注"(搬到详情页,列表不做主观背书展示)、"工作经验"(校招场景基本恒为应届生,信息量低)、"投递通道"(联系方式不公开,改为一个"查看投递方式"按钮,登录后展开)。

  表格实现复用 `packages/ui/src/components/data-table.tsx`;`owner` / `isPublic` 这类服务端不支持的排序字段必须 `enableSorting: false`(plan 36 第十一节第 4 条)。

###
  8.4 详情页与"加入追踪"

  详情页右侧固定面板放主操作:

  ```
  [ 加入我的申请追踪 ]   [ 收藏 ]   [ 举报 ]
  ```

  "加入我的申请追踪"的预填映射:

     |

        `application` 字段

     |

     |

        来源

     |

     |

        `company`

     |

     |

        `post.company`

     |

     |

        `role`

     |

     |

        `post.role`

     |

     |

        `location`

     |

     |

        `post.locations.join(' / ')`

     |

     |

        `salary`

     |

     |

        `post.salaryText`

     |

     |

        `source`

     |

     |

        `post.source`

     |

     |

        `sourceUrl`

     |

     |

        `post.applyUrl ?? post.sourceUrl`

     |

     |

        `jobDescription`

     |

     |

        `post.summary`

     |

     |

        `status`

     |

     |

        固定 `saved`

     |

     |

        `recruitmentPostId`

     |

     |

        `post.id`(若采纳 6.2 的加列方案)

     |

  复用既有的"新建申请"表单(`application-form-sheet.tsx`)并只预填、不静默创建,让用户确认后再保存 —— 避免误点击产生垃圾数据。

###
  8.5 管理端审核页

  复用 `data-table` + plan 36 已建立的列表页模式(搜索防抖 / 状态筛选 / 服务端分页)。审核卡片展示待审岗位的全部字段 + 提交者 + 去重键命中的既有岗位(便于判断是否重复)。批准/驳回落审计;驳回必须填理由,理由回传给提交者在 `/dashboard/recruitment` 里可见。

##
  九、AI 与 MCP

  MCP(`packages/mcp/src/tools.ts`,复用既有 applications 工具的模式):

     |

        工具

     |

     |

        说明

     |

     |

        `search_recruitment_posts`

     |

     |

        按关键词 / 地点 / 学历 / 批次搜索已公开岗位

     |

     |

        `get_recruitment_post`

     |

     |

        读单个岗位详情

     |

     |

        `create_recruitment_post`

     |

     |

        提交岗位(进审核队列)

     |

     |

        `convert_recruitment_post_to_application`

     |

     |

        岗位转申请,复用 8.4 的同一套映射

     |

  岗位工具名要同步登记到 `packages/mcp/src/mcp-tool-names.ts`(该文件是工具名的单一来源,存在 `tool-annotations.test.ts` 校验)。

  AI:不做"自动抓取岗位"这类需要外部联网的能力(与 plan 11 的口径一致)。可做的是复用既有 `applications/ai.ts` 的 `score_application_match`:用户把岗位加入追踪后,用已绑定简历算匹配度 —— 但这属于 P3,且必须由用户显式触发,不做自动跑分。

##
  十、i18n 与文案

  所有用户可见字符串用 `t` / `Trans` / `msg` 包裹,然后 `pnpm --filter web lingui:extract`(它会连带跑 `pdf:translations`)。

  `lingui:extract` 以 `--clean --overwrite` 运行,会连译文一起删。 执行前先看 `git status --porcelain | grep '^ D'` 里只有有意删除的文件;执行后复查空 `msgstr` 数量有没有暴涨。

  默认语言是简体中文(`apps/web/src/libs/locale.ts` 的 `defaultLocale`),所以 `zh-CN.po` 是主战场;`en.po` 需要为下列中国特化枚举提供合理译法,不能直译:

       |

          中文

       |

       |

          建议英文

       |

       |

          提前批

       |

       |

          Early batch

       |

       |

          正式批

       |

       |

          Main batch

       |

       |

          补录

       |

       |

          Supplementary round

       |

       |

          统招本科

       |

       |

          Full-time bachelor's

       |

       |

          不强制要求92

       |

       |

          No 985/211 requirement

       |

       |

          优秀可特批

       |

       |

          Exceptions for strong candidates

       |

       |

          内推码

       |

       |

          Referral code

       |

  校招 / 985 / 211 这类概念在非中文语境下没有对应物,译文要描述性而不是音译。

##
  十一、安全、治理与合规

  这是本设计与 codecv 差距最大的一节 —— codecv 的治理是一句 README 警告,本设计要把它变成机制。

###
  11.1 内容不可信(plan 11 的 `untrusted job-content handling`)

     |

        风险

     |

     |

        处置

     |

     |

        岗位简介里塞 HTML / 脚本

     |

     |

        `summary` 限制为纯文本(zod `z.string()` + 长度上限),不做 HTML 存储。注意 `packages/api` 已在 plan 36 第十四节把 `sanitize-html` 依赖删除(knip 判定未用),`sanitize-html` 现在只存在于 `apps/server` —— 所以不要为了这个功能把依赖加回 api,纯文本约束更简单也更安全

     |

     |

        链接钓鱼 / `javascript:` 协议

     |

     |

        `applyUrl` / `sourceUrl` 服务端校验:只允许 `http:` / `https:`,其余一律拒绝(不是清洗,是拒绝)

     |

     |

        外链 tabnabbing

     |

     |

        前端一律 `rel="noopener noreferrer"`,补上 codecv 缺的属性(缺陷 3)

     |

     |

        第三方 Logo 泄露访客信息

     |

     |

        不用 `` 直出(等于把每个访客的 IP 送给第三方)。方案:首字母占位为默认,外部 logo 走实例内已有的存储服务代理(复用 `packages/api/src/features/storage`)缓存后返回,或干脆首期不做 logo

     |

     |

        联系方式被抓取

     |

     |

        `contactValue` / `referralCode` 不进公开接口的响应 schema(不是"前端不渲染",是服务端不返回),仅登录用户可见;并对详情接口加限流

     |

     |

        恶意提交刷屏

     |

     |

        提交接口限流 + 去重键 + (可选)账号需完成邮箱验证

     |

###
  11.2 治理机制(把 codecv 的"黑名单册"落到实处)

  codecv 的规则是"刷 KPI 的被发现将加入黑名单册",但没有实现黑名单,只有一句警告。本设计:

     |

        机制

     |

     |

        实现

     |

     |

        审核队列

     |

     |

        默认所有用户提交进 `pending`,管理员批准后才公开(`recruitmentRequireReview` 默认 `true`)

     |

     |

        举报

     |

     |

        `recruitment_report` 表 + 唯一约束;公开列表不展示举报数(避免被人当武器用),仅管理端可见

     |

     |

        重复提交

     |

     |

        `dedupeKey` 唯一约束,服务端 409 + 指向已有岗位

     |

     |

        主观背书

     |

     |

        `remark` 改 `summary`,明确限定为客观岗位信息。codecv 示例里的"领导很好,本人亲试"这类内容不进本项目

     |

     |

        拒稿理由

     |

     |

        驳回必须填理由,回传给提交者 —— 不做"静默消失"

     |

     |

        溯源

     |

     |

        `source` + `sourceUrl` 必填其一,便于核实真伪

     |

  明确不做的:不建"用户黑名单"表。理由:自托管实例的规模下,管理员直接禁用账号(Better Auth admin 插件已有 `setBan`)就够了,再建一套平行机制是重复建设。

###
  11.3 权限与可见性矩阵

     |

        数据

     |

     |

        未登录访客

     |

     |

        登录用户

     |

     |

        管理员

     |

     |

        `published` 岗位列表 / 详情

     |

     |

        ✅

     |

     |

        ✅

     |

     |

        ✅

     |

     |

        `contactValue` / `referralCode`

     |

     |

        ❌

     |

     |

        ✅

     |

     |

        ✅

     |

     |

        自己提交的 `pending` / `rejected`

     |

     |

        ❌

     |

     |

        ✅

     |

     |

        ✅

     |

     |

        他人提交的 `pending` / `rejected`

     |

     |

        ❌

     |

     |

        ❌

     |

     |

        ✅

     |

     |

        举报队列 / 提交者身份

     |

     |

        ❌

     |

     |

        ❌

     |

     |

        ✅

     |

##
  十二、已定决策

     |

        决策项

     |

     |

        结论

     |

     |

        是否接第三方招聘 API

     |

     |

        不接。数据由社区提交 / 管理员导入(第一节、第三节)

     |

     |

        默认是否开启

     |

     |

        默认关闭,实例级开关 `recruitmentBoardEnabled`(第七节)

     |

     |

        岗位可见范围

     |

     |

        岗位信息对所有访客可见,联系方式仅登录可见

     |

     |

        时效判定

     |

     |

        读时计算,不做定时任务、不引入调度器(第七节 7.2)

     |

     |

        内容形态

     |

     |

        简介为纯文本,不存 HTML,不把 `sanitize-html` 加回 `packages/api`(第十一节)

     |

     |

        与 applications 的关系

     |

     |

        单向连接:岗位 → 一键预填申请记录,复用既有 `applications.create`(第八节 8.4)

     |

     |

        审核

     |

     |

        默认开启,用户提交进审核队列;驳回必填理由

     |

     |

        "996 / WLB" 标签

     |

     |

        不采纳 codecv 的做法,改中性 `workMode`,不作价值观标注(第六节 6.3)

     |

     |

        Logo

     |

     |

        默认首字母占位,不直出第三方外链图(第十一节)

     |

     |

        用户黑名单

     |

     |

        不做,复用 Better Auth 的账号封禁(第十一节 11.2)

     |

##
  十三、分阶段实施

     |

        阶段

     |

     |

        内容

     |

     |

        产出

     |

     |

        P0 基座

     |

     |

        `packages/schema` 契约 + `packages/db` 三张表 + 迁移;实例开关三个;公开列表与详情 API(服务端分页筛选、字段裁剪);`/jobs` 列表与详情页;`/admin/recruitment` 审核队列;审计动作

     |

     |

        管理员能录入并公开岗位,访客能浏览筛选

     |

     |

        P1 提交与治理

     |

     |

        用户提交(限流 + 去重 + 进队列);我的提交页;编辑回退重审;举报;收藏;时效与"即将截止"派生;驳回理由回传

     |

     |

        社区可以贡献数据,治理闭环成立

     |

     |

        P2 与申请追踪打通

     |

     |

        "加入我的申请追踪"预填;`application.recruitmentPostId` 加列(若采纳);岗位上显示"已投递"标记;侧边栏角标

     |

     |

        校招信息真正接入漏斗

     |

     |

        P3 AI / MCP 增强

     |

     |

        4 个 MCP 工具;复用 `score_application_match` 做显式触发的匹配度;按用户简历技能做岗位推荐

     |

     |

        从"人找岗位"到"岗位找人"

     |

  建议顺序:P0 必须先用管理员手动录入 + 公开列表跑通完整链路(含字段裁剪与开关门禁),再开放用户提交 —— 否则治理机制还没建好就放开了写入面。

##
  十四、验收标准

     |

        #

     |

     |

        检查项

     |

     |

        通过标准

     |

     |

        1

     |

     |

        开关默认生效

     |

     |

        全新实例启动后 `/jobs` 返回 404,侧边栏无入口,API 不可用

     |

     |

        2

     |

     |

        打开开关

     |

     |

        管理员在后台打开后,无需重启即可访问(复用 instance-settings 的写后失效)

     |

     |

        3

     |

     |

        公开列表不泄露联系方式

     |

     |

        未登录请求列表与详情的响应体里搜不到 `contactValue` / `referralCode` 的字段与值

     |

     |

        4

     |

     |

        分页正确

     |

     |

        造 25 条已公开岗位,列表 `total = 25`,`pageSize = 8` 时共 4 页,第 4 页 1 条(直接覆盖 codecv 缺陷 1)

     |

     |

        5

     |

     |

        关键词可搜岗位名

     |

     |

        搜岗位名关键词能命中(覆盖 codecv 缺陷 8)

     |

     |

        6

     |

     |

        时效

     |

     |

        `deadline` 已过的岗位不出现在默认列表;`rolling = true` 的始终出现

     |

     |

        7

     |

     |

        去重

     |

     |

        同一公司 + 岗位 + 城市重复提交返回 409,响应含既有岗位 id

     |

     |

        8

     |

     |

        链接协议

     |

     |

        提交 `javascript:alert(1)` 作为 `applyUrl` 被服务端拒绝

     |

     |

        9

     |

     |

        纯文本

     |

     |

        简介里写 `` 存库为字面文本,页面不执行、不解析为 HTML

     |

     |

        10

     |

     |

        审核链路

     |

     |

        用户提交 → `pending` 他人不可见 → 管理员驳回(填理由)→ 提交者能看到理由 → 修正后再提交可进队列

     |

     |

        11

     |

     |

        独立数据可见性

     |

     |

        同一岗位的 `pending` 岗位,只有提交者与管理员能通过 API 取到

     |

     |

        12

     |

     |

        一键转申请

     |

     |

        点击后表单预填 8.4 表中全部字段,保存后申请记录 `source` / `sourceUrl` 正确,且预填不静默创建

     |

     |

        13

     |

     |

        审计

     |

     |

        批准 / 驳回 / 下架 / 删除四条动作各落一条 `admin_audit_log`,审计失败不影响主操作

     |

     |

        14

     |

     |

        限流

     |

     |

        短时间高频提交被 `recruitmentSubmissionRateLimit` 拒绝

     |

     |

        15

     |

     |

        i18n

     |

     |

        `pnpm --filter web lingui:extract` 后无新增空 `msgstr` 暴涨,`zh-CN.po` 无残留英文硬编码

     |

     |

        16

     |

     |

        检查

     |

     |

        `pnpm --filter @reactive-resume/api test`、`pnpm --filter web typecheck`(按"我改的文件有没有新增错误"判断)、`pnpm exec biome check <改动文件>`、`pnpm exec turbo boundaries` 通过

     |

##
  十五、风险与注意

  最大的风险是"被当成 JSearch 复活"。 本设计与外部数据源无关,PR 描述里必须把第三节的对照表放上去,否则极易被 reviewer 直接以 plan 11 的理由关掉。

  治理成本是主要成本,不是开发量。 代码量不大,但"谁审、审多快、驳回怎么解释"是长期负担。自托管单人实例上管理员就是唯一的审核人 —— 这也是 `recruitmentBoardEnabled` 默认 `false` 的原因:不该让用户凭空多出一个需要维护的内容板块。

  `contactValue` 泄露是最容易犯的单点错误。 不是"前端不渲染"就算安全,必须在输出 schema 层就不包含该字段。验收第 3 条就是为此设计的。

  不要把 `sanitize-html` 加回 `packages/api`。 plan 36 第十四节刚把它作为 unused dependency 清掉,再加回来等于把 knip 从绿打回红。纯文本约束是更小的方案。

  `deadline` 的时区要注意:仓库惯例是 timestamptz,前端展示需按用户本地时区渲染;`即将截止` 的判定放在服务端统一算,避免各端算法漂移(可参考 plan 36 第十三节第 9 条的教训:日期表达式显式钉 UTC)。

  路由与 plan 08 / 10 的既有约定不要冲突。 `/jobs` 是新占的公开路径,落地前先确认没有被 root-public-resume 或既有公开路由占用。

  `application.recruitmentPostId` 加列会触发迁移。 若希望 P2 零迁移,首期可用 `sourceUrl` 关联,把加列推迟;但要注意 `sourceUrl` 可空,关联不保证唯一。

  严格照 `AGENTS.md` 的"跨多处改动"核对:schema → API DTO → DB → web 表单的顺序;新增环境变量(若引入)必须同时登记 `packages/env/src/server.ts` 与 `turbo.json` 的 `globalEnv`,否则 Turborepo 严格模式下子进程拿到 `undefined`。

  `lingui:extract` 是破坏性命令,在岗位板上线前后各跑一次,中间不要夹带删除文件的改动。

  CRLF:仓库行尾是 CRLF,用脚本做整行替换前先归一化换行,否则静默失配。

  规模假设要诚实。 本设计假设实例级岗位数量在千级以内(服务端分页 + B-tree 索引足够)。若真要支持"全网站"级别数据量,索引策略与缓存方案都要重新设计 —— 但那不是本项目该做的事。

##
  十六、待维护者拍板的开放问题

  以下问题没有足够清楚的推荐答案,需要产品方向决策,不能由执行者自选:

  岗位来源边界:只允许用户提交 + 管理员单个录入,还是也要支持管理员批量导入(CSV / JSON)?

    支持批量导入会立刻带出"导入模板设计 + 字段校验 + 部分失败回滚策略"三个子问题,工作量不小。

  是否允许匿名(未登录)提交?

    允许:贡献门槛最低,但治理成本最高(无账号可封)。建议不允许,但这改变了"低门槛贡献"这个借鉴 codecv 的初衷。

  是否需要"内推码 / 内推人"独立字段?

    中国校招里内推码是核心信息,但涉及"谁的内推码"这类身份信息,存储与展示都有隐私考量。

  联系方式直接展示微信是否可以接受?

    实用价值高(国内投递主流),但公开微信等于公开个人身份,且必然被爬。当前的方案是"仅登录可见",是否需要更严(如"仅登录且完成邮箱验证可见")?

  P2 是否接受给 `application` 表加列?

    加列能让"我投过这个岗位"可靠展示,但动了一张已经在用的核心表。

  岗位板是否需要跨实例共享 / 内置初始数据集?

    若内置一份初始岗位数据,就必须回答"谁来维护它" —— 这正是 codecv 用 PR 模式在解决的问题。默认建议:不内置,空板起步。

KS_DOC_REVIEWS	wz9W2ITA2rtqlyDcoD6QRO	145738	https://www.workbuddy.cn/space/d/wz9W2ITA2rtqlyDcoD6QRO
