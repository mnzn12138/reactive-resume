# 42 · 项目整体方案(国产化为主 · 迁移最小化)

> 编制日期:2026-09-23 · 开发:1 人 · 周期:约 3 个月(≈65 工作日)
> 前置:37~41 号文档已于 2026-09-23 全部作废并删除,本文为重新评估后的新方案
> 输入:三份功能设计书(源文档存于 `plans/_sources/`)

## 0. 结论先行

| 问题 | 结论 |
|---|---|
| 重心 | **国产化功能改造**。迁移只为满足课程要求,做**最小集** |
| 迁移范围 | **只迁简历 CRUD** 到 Python,其余全部留 Node |
| 迁移成本 | **14~20 天** |
| 国产化 | 18 个功能点中 **16 项做**(A 档 12 + B 档 4),2 项不做 |
| 需资质功能 | **实现完整**(含真实驱动代码),只是无企业资质无法真实调用 |
| 开发顺序 | **迁移前 14 项**(约 17~23 天)→ 迁移 → **迁移后 3 项**(约 11~14 天) |
| 总计 | **约 43~60 天**,对 65 工作日可行,但上限时缓冲仅约 5 天 |

## 1. 重心判定

用户明确:迁移是**课程要求**,不是工作重心;国产化改造才是。据此调整:

- **迁移从"全量"降为"最小集"**:只迁简历 CRUD。导入解析、管理后台、applications、AI、MCP 全部留 Node。
- **省下的前端改造量很可观**:原方案要一次改造 124 处 `orpc.` 调用(分布 80 个文件),现在只需切迁走的那几个接口。
- **大部分国产化功能可在迁移前做**:它们落在 `packages/pdf`、`schema`、`auth`、`fonts`、`ai/src/prompts` 与前端 —— 恰恰是迁移**不碰**的区域(`packages/pdf` 13111 行明确保留 Node,鉴权整体留 Node)。

## 2. 三份文档评估:合并去重后的 18 项

| 来源 | 内容 | 处理 |
|---|---|---|
| doc2(国产化功能设计书) | 15 个功能点,五分类 | 主体 |
| doc1(37 校招信息汇总板) | 岗位板 + 3 张表设计 | 采纳,排迁移后 |
| doc3(大模型简历系统 PRD) | 14 章完整 PRD | 取"国内市场适配""大模型引擎""ATS"部分;商业化/运营剔除 |

**重叠项(三份都出现,已合并)**:手机号登录、微信登录、中文模板、国内字段、国产大模型、ATS 规则。

### 2.1 A 档 · 直接可行,无需外部资质(12 项,全做)

| # | 功能 | 落点 | 迁移是否碰 | 天数 |
|---|---|---|---|---|
| A1 | 中文模板族(3~4 套) | `packages/pdf/src/templates/`、**`packages/schema/src/templates.ts`** | 否 | 4~6 |
| A2 | 国内字段扩展(含 `key`) | `packages/schema/src/resume/data.ts` + 前端 | 否(契约层) | 1.5 |
| A3 | 中文字体取字通道 | `packages/fonts` | 否 | 0.5~2.5 |
| A4 | 国内分区预设 | `packages/schema` | 否 | 0.5 |
| A5 | 国产大模型预设 | `packages/ai`(纯数据) | 否 | 0.5 |
| A6 | 中文提示词与事实锚定 | `packages/ai/src/prompts/` | 否(纯资源) | 1~2 |
| A7 | 结构化文本导出 | 前端 + 现有导出 | 否 | 1 |
| A8 | 二维码名片 | 前端(纯客户端) | 否 | 0.5 |
| A9 | 简历图片卡 | 前端 | 否 | 1~1.5 |
| A10 | 中文隐私政策与用户协议 | 前端 + `user_consent` 表 | 表要落库 | 1~1.5 |
| A11 | ATS 国内可解析性规则 | `packages/api/src/features/ai/` | **是** | 1.5 |
| A12 | 招聘平台格式适配 | 导出层 | 部分 | 2~3 |

### 2.2 B 档 · 需企业资质,但代码完整实现(4 项,全做)

> **实现原则(用户 2026-09-23 明确)**:照样实现好,能不能用不重要。
> 即:配置页、驱动接口、实例开关、UI 入口、以及**真实服务商的接入逻辑(签名算法、OAuth 流程)全部写完整**;只是拿不到企业资质,无法真实调用。
> 与"只做 mock"的区别:mock 只跑通流程,真实驱动代码留空;本档要求真实驱动代码也完整。

| # | 功能 | 实现要点 | 迁移是否碰 | 天数 |
|---|---|---|---|---|
| B1 | 微信扫码登录 | `genericOAuth` 插件已存在;写完整微信 OAuth 流程 | 否(`packages/auth`) | 1.5 |
| B2 | 手机号 + 短信验证码 | better-auth 官方 `phoneNumber` 插件已核实存在;写阿里云/腾讯云**完整签名驱动** | 否 | 2~3 |
| B3 | 支付宝扫码登录 | 同 `genericOAuth` | 否 | 1 |
| B4 | 国产对象存储(OSS/COS/OBS) | `@aws-sdk/client-s3` 已用;三者均 S3 协议兼容,改 endpoint 即可 | 视是否迁 storage | 0.5 |

### 2.3 C 档 · 本期不做(2 项)

| 功能 | 不做的理由 |
|---|---|
| OCR 图片导入 | 需第三方 OCR API(资质);本地 OCR 效果差,性价比低 |
| 商业化订阅计费 | 需支付资质 + 配额体系,与课程目标无关 |
| 实名认证 | 敏感个人信息,合规风险高;doc2 标为"低"优先级,用户本次未选 |

## 3. 迁移方案(最小集:只迁简历 CRUD)

### 3.1 范围

**迁到 Python**:简历 CRUD(list / get / create / update / delete)、公开简历页数据。

**留在 Node**:导入解析、管理后台、applications(投递追踪)、AI、MCP、统计、Agent、以及全部鉴权与渲染。

### 3.2 步骤与成本

| # | 步骤 | 天数 | 要点 |
|---|---|---|---|
| M1 | 契约导出(只切要迁的接口) | 2~3 | **已完成(2026-09-29)**。`services/resume-api/tools/export_contract.mjs` 拉 `/api/openapi/spec.json`(注意**必须带 `/spec.json`**,裸 `/api/openapi` 是 404),白名单切出 7 个 operationId;忽略 64 个。脚本幂等(连跑两次 md5 相同),白名单缺项报错 |
| M2 | Alembic 基线 + SQLAlchemy 模型 | 2~3 | **已完成(2026-09-29)**。基线 `0001` = `pg_dump --schema-only` 全部 28 张表;模型只建 `resume` / `user` / `session`(只读,认人用)/ `resume_statistics`。空库 upgrade→downgrade→upgrade 已验,临时库已 DROP。**生产库还没 stamp,真交接前要 `alembic stamp 0001`** |
| M3 | Python 取身份 | 1 | **已完成(2026-09-29)**。`services/resume-api/app/identity.py`,cookie `better-auth.session_token` → `session JOIN user`,8 个 pytest 覆盖有效/过期/无 cookie/伪造 |
| M4 | 简历 CRUD 迁 Python | 4~6 | 核心工作量 |
| M5 | PDF / DOCX 联调 | 2~3 | 渲染仍调 Node 内部端点,`packages/pdf` 一行不改 |
| M6 | 部署 + 验收 | 3~4 | 两边环境变量名必须一字不差(尤其 `AUTH_SECRET`) |
| | **合计** | **14~20** | |

### 3.3 硬约束

1. **PDF 输出不变**是唯一硬验收:迁移前后各导出 15 套 PDF 逐页像素 diff。因此在动 `packages/pdf` / `packages/fonts` 之前,必须先跑一次基线快照。
2. `packages/api` 的 `getModel()` 是 `.exhaustive()` match(`service.ts:158`),**不要扩 `AI_PROVIDERS` 枚举** —— 加成员不补分支 typecheck 直接红。国产模型用纯数据预设即可。
3. **B2(手机号 + 短信验证码)必须排在简历 CRUD 迁 Python 之前完成。** 依据(`plans/45-b-dang-design.md` §6,已核实源码):better-auth 的 `phoneNumber` 插件要求 `user` 表新增 `phoneNumber` / `phoneNumberVerified` 两列,而 `packages/db/src/schema/auth.ts` 现在**没有**这两列,需要一条新的 Drizzle 迁移。§3.2 计划迁移后 Drizzle 停更 —— 若先迁移,同一张 `user` 表要在两套 ORM 里各写一次,且 Python 侧的 Alembic 基线(`pg_dump --schema-only` 导出的 DDL)会缺列。

## 4. 开发顺序:迁移前 / 迁移后

### 4.1 迁移前(14 项,约 17~23 天)

判定依据:落在 `packages/pdf`、`fonts`、`schema`、`auth`、`ai/src/prompts` 与前端 —— **迁移不碰**,做完即可见效果。

1. **PDF 基线快照**(必须最先,早于一切 pdf/fonts 改动) —— **已完成,见 4.5**
2. **A1 中文模板族(4~6) —— 已完成(2026-09-28):3 套(`zhuque`/`qinglong`/`xuanwu`)已注册 18 套,预览图与 i18n 描述已补,全量测试通过(见 4.6)
3. **A2 国内字段扩展 + A4 分区预设(2) —— 已完成(2026-09-28),见 4.7**
4. **A5 国产大模型预设 + A6 中文提示词(1.5~2.5) —— 已完成(2026-09-28),见 4.8**
5. **A7 结构化文本导出 + A8 二维码名片 + A9 简历图片卡(2.5~3) —— 已完成(2026-09-28),见 4.9**
6. **A10 中文隐私与用户协议(1~1.5) —— 已完成(2026-09-28),见 4.10**
7. **B1 微信 + B3 支付宝 + B2 手机号短信**(4.5~5.5) —— **已完成(2026-09-29)**
8. **B4 国产对象存储(0.5) —— 已完成(2026-09-29)**:`packages/api/src/features/storage/presets.ts` 三家预设,显式 `S3_ENDPOINT` 永远赢,冲突打 warn;健康检查 `type` 扩到 `local/s3/oss/cos/obs`。见 `DEPLOYMENT.md` 3.4.1
9. **A3 中文字体通道(0.5~2.5) —— 已完成(2026-09-29)**:中文回退权重收敛到 400/700 ⇒ 40.3 MiB → **20.1 MiB**;配子集化 + 自托管覆盖表 ⇒ **4.2 MiB 且可离线**。⚠️ **不要**改回「CJK 不注册 italic」——`@react-pdf/font@4.1.2` 按 `fontStyle` 精确匹配且无回退,中文里一个 `<em>` 就会抛 `Could not resolve font`,已实测。见 `DEPLOYMENT.md` 3.5

### 4.2 迁移后(3 项,约 11~14 天)

判定依据:属新业务或落在 `packages/api` 业务层,迁移后归 Python 一次成型,避免写两遍。

1. **A11 ATS 国内可解析性规则(1.5) —— 已完成(2026-09-29)**:6 个维度盘点后新增 9 条 code(双栏页、表格内条目、纯图片条目、图标字段、半截时间、缺职位、私用区字符、全角日期、非标准项目符号)。「页眉页脚」与「图形化时间轴」**缺数据字段、做不了数据级判定**,交给已有的文件级规则(`TEXT_IN_MARGIN_ZONE`).顺带修了 `2020.03 - 2022.06` / `2020年3月` 这类国内写法被判为不可解析的误报
2. 校招岗位板(doc1,6~7 天,新建 `recruitment_post` / `_report` / `_bookmark` 三表)
3. A12 招聘平台格式适配(2~3)

### 4.3 用户追加选做

- **一页纸自动压缩**(doc3 的 P0,3~5 天):技术难度较高,需排版引擎支持。已列入,但超期时优先砍。

### 4.5 PDF 基线快照 · 已交付(2026-09-28)

> 这是迁移前第 1 项,**已完成**。迁移后要靠它判定"PDF 输出有没有变",命令与判据写在这里,避免三个月后找不到。

#### 工具

脚本:`tooling/scripts/pdf-baseline.ts`

```bash
# 拍快照(默认输出到 tooling/baseline/pre-migration/)
pnpm --dir tooling exec tsx scripts/pdf-baseline.ts

# 指定目录 / 只跑部分模板
pnpm --dir tooling exec tsx scripts/pdf-baseline.ts --out <dir>
pnpm --dir tooling exec tsx scripts/pdf-baseline.ts -t onyx,pikachu

# 迁移后对比:左=迁移前,右=迁移后
pnpm --dir tooling exec tsx scripts/pdf-baseline.ts compare <pre-migration-dir> <post-migration-dir>
```

产出:15 个 PDF + `manifest.json`(每份的页数、字节数、每页光栅 SHA256,rasterScale=1.5)。全量约 43 秒。

#### 验收判据(实测确定,不要改用字节 diff)

**字节 diff 永远不可能通过。** 同一数据连续渲染两次,差异固定出现在两处元数据:

1. `/CreationDate` —— 源自 `packages/pdf/src/document.tsx:37` 的 `new Date()`
2. trailer `/ID [<16B hex> <16B hex>]`

但 `startxref` 偏移两次完全相同(235869)→ **内容流字节一致**;pdfjs 光栅化后逐像素比对 `differingPixels=0, maxChannelDelta=0`。

因此验收走**像素对比**:`compare` 子命令已按此实现,实测(1)两次独立全量渲染对比 15/15 PASS,(2)故意换模板 FAIL(`differingPixels=1141066, maxDelta=255`),(3)缺文件报 missing。失败时 exit 1。

**不要试图改 `packages/pdf` 来消除非确定性** —— 它一行不改是硬约束,且 `/ID` 也改不掉。

#### 已拍基线位置

`tooling/baseline/pre-migration/`(15 个 PDF + manifest.json,约 3.5 MB)。

固定名不用时间戳,便于迁移后自动取用;该目录**已被 git 跟踪**(`git check-ignore` 退出 1)。⚠️ 不要移到 `tmp/` —— `.gitignore:43` 忽略 `tmp`,会导致基线被 `git clean -xfd` 清理。

#### 15 套模板页数(对照基线用)

| 页数 | 模板 |
|---|---|
| 5 | bronzor、kakuna、lapras、meowth、onyx、rhyhorn、scizor |
| 3 | azurill、chikorita、ditgar、ditto、gengar、glalie、leafish、pikachu |

3 vs 5 是栏位布局差异(双栏更密),不是内容丢失。

#### 提醒

中文模板最终为 3 套，总数变 18 套 —— 但**迁移对照仍只用这原始 15 套**，中文模板不参与。所以脚本保留 `-t` 筛选是硬要求，不要改成无脑全量。

## 4.6 中文模板族 · 已交付(2026-09-28)

按 `plans/43-cn-templates-design.md` 实现 3 套：

- `zhuque`：单页标准版，证件照在右侧，联系信息横向一行，章节标题主题色下划线。
- `qinglong`：应届生校园招聘版，复用 meowth 的 inline-item-header，教育与实习条目压缩为一行。
- `xuanwu`：国企/事业单位版，头部姓名下方两栏个人信息带(政治面貌、民族、籍贯、出生年月、性别)，证件照在右侧。

注册点：schema enum、`packages/pdf/src/templates/index.ts`、semantic manifest 聚合、`apps/web/src/dialogs/resume/template/data.ts`、`packages/docx/src/builder.ts`、日期布局 artifact、all-templates-presentation 快照、首页 playground 测试、`contact-item.tsx` 新增 `CnFieldContactItem`。

验证：

- PDF：86 文件 / 1123 测试通过(含新增 `cn-templates.integration.test.tsx` 真渲染断言)。
- Web：132 文件 / 933 测试通过。
- Schema：9 文件 / 129 测试通过；DOCX：8 文件 / 74 测试通过。
- 预览图与 PDF 已生成到 `apps/web/public/templates/{jpg,pdf}/`。
- i18n 描述已提取并补译到 `zh-CN.po` / `zh-TW.po`。
- `tooling/baseline/pre-migration/` 保持 15 套未污染。

新增开发脚本:`tooling/scripts/template-preview.ts` —— 渲染指定模板的中文预览图(PDF + JPG)。

## 4.7 A2 国内字段扩展 + A4 分区预设 · 已交付(2026-09-28)

**A2 —— `customField` 加可选 `key`(后续功能的地基)**

- `packages/schema/src/resume/data.ts` 新增 `customFieldKeySchema`(8 个 key:性别/出生年月/民族/政治面貌/籍贯/户籍/婚姻状况/身高)与 `customFieldKeyLabels`(标签白名单),`customFieldSchema` 增加可选 `key`。
- **单一来源**:`packages/pdf/src/templates/shared/cn-fields.ts` 不再自造枚举,改为复用 schema 的 `customFieldKeySchema.options` 与 `customFieldKeyLabels`;`resolveCnFieldKey` 去掉类型强转。key 优先、冒号嗅探兜底的行为不变,旧简历零迁移。
- 分隔符下沉为 `customFieldKeySeparator`(schema),web 与 pdf 共用 —— 之前 `CN_FIELD_SEPARATOR` 在 pdf 内部,pdf 的 export map 不暴露,web 拿不到。
- 前端:自定义字段面板新增"添加国内字段"下拉,一键写入 `key` + `标签：` 前缀。
- `packages/schema/schema.json` 同步补 `key`(用真实 `z.toJSONSchema` 输出对齐后按文件风格插入)。

**A4 —— 国内分区预设**

- `packages/schema/src/resume/section-presets.ts`:4 套预设 `standard` / `cnCampus`(教育优先、隐藏推荐人与著作)/ `cnExperienced`(经历优先、隐藏校园与兴趣)/ `cnPublicSector`(奖惩进正文、隐藏项目)。每个预设覆盖全部 13 个内置分区,不重不漏(有测试守着)。
- `packages/resume/section-presets` 新增纯函数 `applySectionPreset` / `findMatchingSectionPreset`:**自定义分区不会被删**(追加到主栏末尾),多页简历只改第 1 页。
- 前端:布局编辑器顶部新增"分区预设"选择器,显示当前匹配(不匹配则显示"自定义")。

验证:schema 144 测试、resume 新增 8 测试(preset 数据 4 + apply 8,含幂等与自定义分区保留)、web / pdf / docx 全量通过;i18n 新增 6 条已补译,missing 0。

## 4.8 A5 国产大模型预设 + A6 中文提示词 · 已交付(2026-09-28)

**A5 —— 12 家国产大模型预设**

- `packages/ai/domestic-models`:`DOMESTIC_MODEL_PRESETS` 共 12 家 —— deepseek、qwen(通义千问)、glm(智谱)、doubao(豆包)、kimi、hunyuan(混元)、ernie(文心)、spark(星火)、minimax、baichuan、yi(零一万物)、stepfun(阶跃星辰)。
- **不扩 `AI_PROVIDERS` 枚举**:`packages/api/src/features/ai/service.ts` 的 `.exhaustive()` match 会因新增成员直接编译失败;除 deepseek 外全部复用 `openai-compatible` + 预填 `baseURL`,纯数据预设,零分支改动。
- 无法核实的(文心 / 星火 / MiniMax / 阶跃)写 `defaultModel: ""` 并在 `notes` 里注明,**不猜模型名**。
- 前端:AI 设置页新增「国产模型快捷配置」下拉,选中后一次填好 provider / baseURL / model / label,并展示 `notes` 与官方文档链接。
- 测试 41 条:id 唯一、provider 必须存在于 `aiProviderSchema`、非 deepseek 必须有显式 baseURL、https 且无尾斜杠、`defaultModel === ""` 的必须带 `notes`。

**A6 —— 提示词中文化 + 事实锚定**

- `packages/ai/src/prompts/` 新增 6 份 `.zh-CN.md`(ats-review-system / ats-review-user / chat-system / parser-system / pdf-parser-user / docx-parser-user),与英文版同结构、同段落顺序,且全部 CRLF,便于逐行对照。
- `packages/ai/src/prompts.ts` 重写为按 locale 装载:`loadPrompts(locale?)` 返回 7 个提示词;`resolvePromptLocale` 把 `zh-TW` 映射到 `zh-CN`(两套目录只有 UI 措辞差异,再养一份近似提示词只会漂移)。**默认 `zh-CN`** —— 本 fork 的 UI 默认语言就是 zh-CN,调用方漏传也能拿到用户读得懂的指令。
- 解析器的 6 个变量(`FORMAT_HEADER` / `FORMAT_NOUN` / `ALLOWED_INPUT` / `URL_CLAUSE` / `EXTRA_RULES` / `FALLBACK_CLAUSE`)同步做了中文版;parser-system 模板仍是单份 + 按来源替换,产出文本对每种来源保持一致。
- **事实锚定**:中文解析提示词明确禁止臆测政治面貌、民族、籍贯、出生年月、婚姻状况等国内常见字段(原文没有就留空),并要求日期照抄、不得换算成年月格式。
- 机器解析的 token 一律保留英文:JSON key、`"high"|"medium"|"low"`、`propose_resume_patches`、`/items/-`、UUID 形状、HTML 标签、简历顶层 key。
- locale 打通到 API:`parsePdf` / `parseDocx` / `chat` / `atsReview` 四个 procedure 均接受可选 `locale`,前端用 `getLocale()` 传入。DOCX 转纯文本那句提示语也跟着 locale 走(原来硬编码英文)。

验证:ai 9 文件 / 86 测试、api AI 9 文件 / 53 测试全绿;ai + api + web typecheck 绿;biome、markdownlint(仓库 222 文件 0 issue)、knip 均通过。

遗留:`ai.chat` 目前没有前端调用点(agent 走的是另一条传输链),router/service 已接受 `locale` 但无人传值,落回 zh-CN 默认 —— 正是本 fork 想要的行为。
## 4.9 A7 结构化文本导出 + A8 二维码名片 + A9 简历图片卡 · 已交付(2026-09-28)

### A7 —— 结构化文本导出(.txt)

- 依据源设计书 `plans/_sources/doc3.txt:315,802,882`:招聘网站是「在线表单逐字段填写」,要的是**按表单字段顺序输出、便于逐项复制**的纯文本。这与现有 Markdown 导出(整篇散文,喂给 AI 用)是两回事,**并存不替换**。
- `packages/resume/structured-text` 新增纯函数 `buildStructuredSections` / `buildStructuredText`。`STRUCTURED_SECTION_ORDER`(基本信息 → 求职意向 → 教育 → 经历 → 项目 → 技能 → 证书 → 奖项 → 自我评价)是顺序的唯一定义处;名单外的分区按 layout 顺序追加在末尾。
- 基本信息按 `customFieldKeySchema` 枚举顺序输出国内字段(性别/出生年月/民族/政治面貌/籍贯/户籍/婚姻状况/身高),标签取 `customFieldKeyLabels`,**复用 A2 的 `key`**;不碰 `packages/pdf`(其 export map 不暴露 `templates/shared`)。无 `key` 的自定义字段照常输出;空值整行省略(绝不出现裸「标签：」);日期照抄;富文本走 `htmlToMarkdown`。
- **刻意不按 layout pages 过滤**:PDF 只渲染 layout 里的分区,而招聘表单要的是全字段。验收提出过,判定为符合设计意图,保留现状。
- 出口:`useResumeExport` 新增 `onDownloadText`,带 try/catch + `setIsExporting` + 错误 toast(**补上了 JSON / Markdown 两条老路径缺的**,但没去改那两条);文件名走 `generateLocalizedFilename`;**空简历不再静默下载 0 字节文件**,改为提示。
- ⚠️ **导出格式清单有两份**:`features/resume/export/download-dialog.tsx`(手写 JSX 行)与 `features/homepage/export-playground.tsx`(数组 + Map 分发)。加了新格式必须两处都改,否则会静默漂移。导出按钮那句话变了,`export.test.tsx` 里靠字面量点开对话框的断言也要同步改。

### A8 —— 公开简历二维码名片

- `apps/web/src/features/resume/sharing/qr-card.*`:Sharing 区「复制公开链接」旁边加按钮,弹名片预览 + 下载。
- 用**已安装**的 `qrcode.react@4.2.0`(`QRCodeCanvas` 有真实 canvas ref,可以直接 `drawImage`),**没加任何新依赖**;也可以用 `QRCodeSVG` 但那样得多一步 serialize→Image→canvas。
- 名片 = 900×1200 竖向卡片:姓名 / 求职意向 / 联系方式 + 居中二维码 + 「扫码查看完整简历」。几何与绘制抽成纯函数(`getQrCardLayout` / `drawQrCard` 接受结构化 context 便于测试),25 条单测。
- 简历未公开时按钮禁用并说明原因(`isQrCardAvailable` 看 `resume.isPublic`)。

### A9 —— 简历图片卡

- `apps/web/src/features/resume/sharing/image-card.*` + `canvas.ts`:**复用**浏览器端已有的 PDF→PNG 管线(`pdf-thumbnail.ts`,pdfjs 渲染 + `canvasToBlob`),把缩略图那套重构成 `createPdfPageCanvases(file, { pages, resolveRenderSize })`,`createPdfFirstPageImageUrl` 行为不变 —— 仪表盘缩略图零回归,8 条测试守着。
- 单页图 + **长图**两种模式都做了(长图 = `pages:"all"` + 竖向拼接)。`IMAGE_CARD_SCALE = 2`。
- **没用 `@napi-rs/canvas`**:它是 `packages/pdf` 的 Node-only devDependency,web 侧 `MODULE_NOT_FOUND`,且被 turbo boundaries 挡着。

### 新增公共能力

- `packages/utils/file` 加 `generateLocalizedFilename`:`slugify("张三-名片")` 会被换成随机动物名(`string.ts:18-22`),中文文件名必须走这条。已验证 `..\..\evil` / `a/b` / 控制字符都被清掉;`generateFilename` 本身一个字节没改。

验证:web 全量 **136 文件 / 979 测试**、resume 1393、utils 226、ai 86、api AI 53 全绿(唯一红的是 `packages/resume` 的 `selector.esm.test.ts`,Windows `spawnSync` EBUSY,环境性问题非回归);web / resume / utils / ai / api typecheck 全绿;knip、biome、i18n(zh-CN / zh-TW missing 0)均通过。
## 4.10 A10 中文隐私政策与用户协议 · 已交付(2026-09-28)

### 契约层

- `packages/schema/legal` 新增:`legalDocumentSchema`(`privacy` / `terms`)、`legalDocumentVersion`(`2026-09-28`,改文案就 bump)、`legalDocumentRoutes`、`legalConsentSchema`(`accepted` 是 `z.literal(true)`,客户端无法谎报)。schema 是唯一能被 web 与 auth 同时引用的层(db 是服务端专用包,web 拿不到)。

### 数据层

- `packages/db/src/schema/legal.ts`:`userConsent` —— 文本主键 + `generateId()`、`user_id` 外键 **cascade**、`document` / `version` 文本(不用枚举,沿用仓库约定)、`source`、`metadata` jsonb(IP / UA)、`created_at`,**没有 `updatedAt`**(append-only)。唯一索引 `(user_id, document, version)` 让重复同意幂等,bump 版本则插新行。
- **cascade 与 `admin_audit_log` 的 set null 故意相反**:同意记录是用户本人的个人数据,账号删了就该一起删(这也才满足删除请求)。
- 迁移 `migrations/20260928123507_amazing_spectrum/`(第 35 个)。`pnpm db:generate` **不需要活库**,只要根 `.env` 里的 `DATABASE_URL`(`drizzle.config.ts` 自己加载)。

### 鉴权层(两处,顺序别搞反)

- **门禁**在 `hooks.before`,只对 `/sign-up/email` 生效:没有 `legalConsent` / `accepted:false` / 版本过期 → 403。已实测 better-auth 的 zod 不会剥掉未知字段,所以 `ctx.body.legalConsent` 读得到,门禁不是「看起来有、实际没跑」。
- **落库**在 `hooks.after`(不在 `databaseHooks.user.create.after`):`hooks.after` 同时拿得到新建用户与请求上下文(IP/UA 从 `newSession.session` 读,better-auth 已经解析过)。
- ⚠️ **只对真正被门禁拦住的路径写同意记录**。`consentSourceFor` 现在**只认 `/sign-up/email`**。最初版本还认 `/callback/`(社交/OAuth 建号处),但用户在第三方跳转里根本没看到勾选框 —— 那样写一行等于伪造「已同意」,比没有记录更糟,已修掉。
- 因此社交注册用户**没有**同意记录:不伪造,但也无从举证;`legalDocumentVersion` bump 后老用户目前也不会被重新提示。这两点是有意的取舍,后续若要补「重新同意」入口就落在 `ConsentSource: "manual"`(已预留)。
- `auth.api.signUpEmail()`(服务端直调)**不走 hooks**,只有 HTTP / `dispatchAuthEndpoint` 才走 —— 写测试时要知道。

### 前端与服务端

- `apps/web/src/routes/_home/privacy.tsx` / `terms.tsx`:公开路由,默认 SSR,`head()` 给出 title/description/canonical/OG。文案全中文、走 Lingui,生效日期绑定 `legalDocumentVersion`(不是手打日期)。已用真实 catalog 渲染验证:zh-CN 出「隐私政策」、zh-TW 出「隱私權政策」、en-US 出英文。
- ⚠️ **生产 404 陷阱**:新公开路由必须在 `apps/server/src/static/web.ts` 的 `indexableAppPaths` 登记,否则 dev 一切正常、生产返回 404(`handleWebApp` 对不在集合里的路径直接 404)。同时加进 `reservedPublicResumeSegments`,免得有人抢注 `privacy` / `terms` 用户名把页面顶掉。已实测 `GET /privacy` → 200 无 `X-Robots-Tag`,`/privacy/foo` → 404。
- `routeTree.gen.ts` 由 `tanstackRouter()` Vite 插件在 dev/build 时生成,**不能手改**;没有独立的 generate 脚本。
- 注册表单新增必勾的同意框(勾了才发 `legalConsent`),页脚加了法务链接。
- sitemap 补上两个页面(`SITEMAP_PATHS`);服务端 shell 也补了按页 SEO(title/description/canonical/OG/JSON-LD),**字符串直接取自 zh-CN catalog**,与客户端 `head()` 一致。llms.txt 故意不加(它是指针清单,不是页面索引,已用反向断言锁住)。

验证:web **137 文件 / 983 测试**、server 117、auth 30、db 6、schema 144 全绿;web / server / auth / db / schema typecheck 全绿;knip、`turbo boundaries`、biome 均过;i18n 三个 catalog 1688 条、zh-CN / zh-TW missing 0。

**遗留(非阻塞)**:门禁与落库没有 CI 层回归测试(都要活库,`oauth-flow.integration.test.ts` 整体 skip);社交注册无同意记录;本机 `fs.symlink` 静默失败导致 `packages/auth/node_modules/@reactive-resume/schema` 是手工 junction(`package.json` 与 lockfile 都对,换台能建符号链接的机器 `pnpm install` 即正常)。
## 5. 时间账

| 块 | 天数 |
|---|---|
| 迁移最小集 | 14~20 |
| 国产化(迁移前) | 17~23 |
| 国产化(迁移后) | 11~14 |
| **合计** | **42~57 天** |

对 65 工作日 **有余量**;但取上限时缓冲仅约 8 天,且一页纸压缩可能再占 3~5 天。

### 5.1 超期削减顺序

1. 一页纸自动压缩(3~5 天,技术难度最高)
2. 招聘平台格式适配(2~3 天)
3. 校招岗位板精简为"列表 + 筛选 + 加入追踪"(省 3~4 天)
4. 中文字体完整自托管降级为取字通道(省 2 天)

**不建议砍**:中文模板族(门面)、国内字段扩展(后续功能的地基,`key` 一晚定型则模板取舍与 ATS 检查器都要返工)、中文合规文案。

## 6. 待办与风险

1. **中文字体体积补测**:仅实测 `Noto Sans SC` 400 字重(10,559,284 字节),其余字重 / 字族未测。不得按单样本外推。
2. **PDF 基线快照必须先做**:否则"15 套模板像素 diff 全等"这条硬验收失去对照物。
3. **B 档的真实驱动无法自测**:没有企业资质,签名算法写完也无法验证正确性 —— 需在报告中说明这是"实现完整但未经真实调用验证"。
4. **`customField.text` 是自由文本无稳定标识**:15 套模板全是 `customFields.map()` 无差别渲染,"按模板取舍字段"做不到。A2 必须加可选 `key` 字段(已在 1.5 天内)。
5. **一页纸压缩预研已过(见 4.4)**:页数读取与字体缓存均已实锤,剩余风险收敛为「CJK 与 15 套模板的压缩参数兜底」。
