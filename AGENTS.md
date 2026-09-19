<!-- intent-skills:start -->
## Skill Loading

Before editing files for a substantial task:
- Run `pnpm dlx @tanstack/intent@latest list` from the workspace root to see available local skills.
- If a listed skill matches the task, run `pnpm dlx @tanstack/intent@latest load <package>#<skill>` before changing files.
- Use the loaded `SKILL.md` guidance while making the change.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.
<!-- intent-skills:end -->

<!-- caveman-begin -->
Respond terse like smart caveman. All technical substance stay. Only fluff die.

Rules:
- Drop: articles (a/an/the), filler (just/really/basically), pleasantries, hedging
- Fragments OK. Short synonyms. Technical terms exact. Code unchanged.
- Pattern: [thing] [action] [reason]. [next step].
- Not: "Sure! I'd be happy to help you with that."
- Yes: "Bug in auth middleware. Fix:"

Switch level: /caveman lite|full|ultra|wenyan-lite|wenyan-full|wenyan-ultra
Stop: "stop caveman" or "normal mode"

Auto-Clarity: drop caveman for security warnings, irreversible actions, user confused. Resume after.

Boundaries: code/commits/PRs written normal.
<!-- caveman-end -->

<!-- graphify-begin -->

## 智能体技能

- 议题与规格:上游仓库 `reactive-resume/reactive-resume` 的 GitHub Issues,详见 `docs/agents/issue-tracker.md`。
- 领域文档采用多上下文布局,详见 `docs/agents/domain.md`。
- 本地 skill:`skills/resume-builder`(`SKILL.md` 与 `references/schema.md`)—— 改动简历数据结构或 PDF 模板前先加载它。

## 概览

Reactive Resume 是一个 pnpm monorepo(Turborepo),包含两个可部署应用:`apps/web`(TanStack Start / React 19 / Vite)与 `apps/server`(Hono / Node.js)。生产 Docker 镜像以单 Node 进程运行在 3000 端口;`apps/server` 挂载 API / 鉴权 / MCP / 静态路由,并提供构建好的前端应用。

内部包通过 `package.json` 的 export map 直接消费 `src` 源码。除非某个包显式声明,否则不要假定存在包内的 `dist` 产物。

前置条件:**Node.js 24**(`.nvmrc` 指定,与 Dockerfile 的 `ARG NODE_VERSION=24` 一致)、**pnpm 12.3.4**(根 `package.json` 的 `packageManager` 指定;pnpm 会自举到该版本,因此任意较新的 pnpm 都能启动 —— Dockerfile 的 `ARG PNPM_VERSION` 只决定基础镜像)([安装说明](https://pnpm.io/installation)),以及 **Docker**(用于 PostgreSQL;守护进程没起时先 `sudo dockerd &`)。

## 职责归属

各类改动归属何处、新代码写到哪里:

| 领域 | 归属 |
|------|------|
| Web 路由、loader、面向用户的工作流 | `apps/web/src/routes`、`apps/web/src/features`(基于文件,切勿手改 `routeTree.gen.ts`) |
| 服务端 HTTP 路由/适配器、启动检查、静态处理、MCP 传输层、OpenAPI/well-known | `apps/server/src/{http,rpc,mcp,openapi,static,startup}` |
| 需鉴权的 API 契约与业务逻辑 | `packages/api/src/features/*`(现有 `agent`、`ai`、`ai-providers`、`applications`、`auth`、`flags`、`resume`、`statistics`、`storage`;oRPC 路由、DTO、限流;在 `@reactive-resume/api/routers` 聚合后供 `/api/rpc` 使用) |
| 鉴权 | `packages/auth`(Better Auth 配置/辅助/类型;`apps/server/src/http/auth.ts` 委托给 `auth.handler`) |
| 数据库客户端与 schema | `packages/db`(Drizzle;迁移位于仓库根 `migrations/`) |
| 服务端环境变量校验 | `packages/env`(自动加载根目录 `.env`) |
| 简历/页面/模板的 Zod schema | `packages/schema` |
| 纯简历领域行为(不依赖 DB/HTTP/DOM/渲染器) | `packages/resume`(JSON Patch 辅助、社交网络图标) |
| 简历 PDF 渲染 | `packages/pdf`(React PDF 文档、字体注册、模板原语、浏览器/服务端适配器) |
| PDF.js 查看器/画布 UI | `apps/web/src/features/resume` —— 绝不放进 `packages/pdf` |
| DOCX 导出 | `packages/docx` |
| MCP 工具/提示词/资源/server-card | `packages/mcp` |
| 通用 UI 原语与 hooks | `packages/ui`(Base UI / shadcn 风格);特定业务的 UI 留在所属的 web feature 内 |
| 专用支撑面 | `packages/fonts`、`packages/email`、`packages/import`、`packages/ai`、`packages/utils`、`packages/config` —— 优先复用现有导出,不要跨包抄近路 |
| DeepSeek Harness 插件(MCP 桥接,仅打包用) | `packages/dsh-plugin` |
| 仅开发期使用的脚本 | `tooling/`,而不是 `packages/`,以保证包内只有运行时代码 |

窄口径的跨领域辅助函数,只有在确认没有更合适的领域包之后才放进 `packages/utils`。具体而言:简历 JSON Patch 属于 `@reactive-resume/resume/patch`,DOCX 构建器属于 `@reactive-resume/docx` —— 都不属于 `@reactive-resume/utils`。

## Web 应用约定

- `apps/web/src/router.tsx` 用 `queryClient`、`orpc`、`theme`、`locale`、`session`、`flags` 初始化路由上下文。复用路由上下文,不要临时重新拉取这些数据。
- Builder 外壳:`apps/web/src/routes/builder/$resumeId`。其嵌套的预览路由仅客户端渲染(`ssr: false`);公开简历路由 `apps/web/src/routes/$username/$slug.tsx` 使用 `ssr: "data-only"`。
- **侧边栏分区只在一处注册**:`apps/web/src/libs/resume/section.tsx` 定义了 `LeftSidebarSection`/`RightSidebarSection` 联合类型、`leftSidebarSections`/`rightSidebarSections` 数组,以及 `getSectionTitle`/`getSectionIcon`。增删一个 builder 侧边栏分区需要同时改这四处(外加 `apps/web/src/routes/builder/$resumeId/-sidebar/{left,right}/index.tsx` 里的 `match`);这两个数组同时驱动面板列表和图标栏。
- 仅浏览器的预览代码:`apps/web/src/features/resume/preview`。公开 PDF 查看器:`apps/web/src/features/resume/public`。SSR 路径中不要出现 PDF.js / canvas / 浏览器 API。
- 同构 oRPC 客户端:`apps/web/src/libs/orpc/client.ts` —— 服务端调用走进程内路由客户端,浏览器调用走 `/api/rpc` 并携带凭据。
- 带显式 props 的 React 组件,使用具名的 props 类型(如 `type FooProps = {...}` 配 `function Foo(props: FooProps)`),不要用内联对象注解,尤其是字段多于一个或带泛型时。

## 包边界

可执行检查是 `pnpm exec turbo boundaries`。规则:

- 工作区依赖通过包名与 export map 引用。绝不用仓库相对路径、`@reactive-resume/*/src/*` 或 TS 路径别名去导入另一个工作区的 `src`。
- 各工作区的 `turbo.json` 声明粗粒度标签:`app:web`、`app:server`、`runtime:server`(仅服务端包:API/auth/db/env/email/MCP)、`runtime:browser`(仅浏览器共享 UI)、`runtime:universal`(环境无关领域包),外加表达意图的 `role:domain|infra|adapter|api|rendering|tooling`。
- 运行时相关代码放在显式子路径导出之后(`@reactive-resume/pdf/browser`、`@reactive-resume/pdf/server`、`@reactive-resume/env/server`)。除非该包本身就是服务端专用,否则根导出应保持环境无关。
- 通配符导出仅允许用于刻意做成"文件式"表面的叶子库 —— 目前是 `@reactive-resume/ui/components/*`、`@reactive-resume/ui/hooks/*` 以及 schema 的简历模型文件。承载运行时行为的包应优先使用显式导出。
- 需鉴权的 procedure 优先使用 `packages/api/src/context.ts` 的 `protectedProcedure`。只通过 `packages/api/package.json` 暴露有意为之的公开面。
- 共享的 PDF 分区过滤:`packages/pdf/src/templates/shared/filtering.ts`。模板专属的视觉例外留在所属模板目录,除非多个模板都需要该行为。`packages/pdf/src/hooks/use-register-fonts.ts` 负责字体注册、标准 PDF 字体、CJK 回退字体栈与全局断词。

## 跨多处改动

- **简历数据结构**:先改 `packages/schema/src/resume/*`,再依次改 API DTO、导入器、PDF 渲染,最后是消费它的 web 表单。
- **新增模板**:`packages/schema/src/templates.ts`、`packages/pdf/src/templates/index.ts`,源码放在 `packages/pdf/src/templates/<name>/`,预览图放在 `apps/web/public/templates/{jpg,pdf}`。
- **新增数据库字段/表**:`packages/db/src/schema/*`,然后 `pnpm db:generate`。
- **新增环境变量**:`packages/env/src/server.ts` **以及** `turbo.json` 里的 `globalEnv` 数组。Turborepo 2.x 的严格环境变量模式会过滤未登记的变量,因此即使操作系统/容器里已正确设置,子进程运行时拿到的仍是 `undefined`。
- **UI 文案(任何用户可见字符串)**:用 `t`/`Trans` 包裹,然后跑 `pnpm --filter web lingui:extract`(它会连带执行 `pnpm pdf:translations`)。切勿手改 `apps/web/src/routeTree.gen.ts` 和 PDF 章节标题目录,两者都是生成物。
- **删除功能**:先跨 `apps/`、`packages/`、`docs/` grep 一遍再删 —— 若持有某字符串的文件被删,i18n 抽取器会把该字符串连同译文一起静默丢弃。

## 环境与数据库

把 `.env.example` 复制为 `.env.local`。三个必需变量:`APP_URL`(默认 `http://localhost:3000`)、`DATABASE_URL`(默认 `postgresql://postgres:postgres@localhost:5432/postgres`)、`AUTH_SECRET`(任意非空字符串)。

- **S3/SeaweedFS 可选。** 若 `S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY`、`S3_BUCKET` 三者都设置,应用使用 S3 兼容存储。`.env.example` 自带 SeaweedFS 默认值,因此要么启动 `seaweedfs` compose 服务,要么注释掉这些变量以使用 `<workspace>/data` 下的本地文件系统存储。`LOCAL_STORAGE_PATH` 若设置必须为绝对路径。
- **`REDIS_URL` 与 `ENCRYPTION_SECRET`** 对核心简历流程是可选的,但保存 AI 提供商与已鉴权的 `/agent` 工作区需要两者。宿主机运行 dev 时用 `REDIS_URL=redis://localhost:6379`;容器内运行时用 `redis://redis:6379`。
- **`drizzle-kit`(`pnpm db:migrate` / `db:generate` 使用)自身不加载 `.env`**,但 `packages/db/drizzle.config.ts` 会用 `process.loadEnvFile()` 主动加载仓库根的 `.env.local` 与 `.env`,所以这两个命令可以直接跑,不必再套 `dotenvx`。**已有的环境变量优先**(`loadEnvFile` 不覆盖),CI/生产注入的值不受影响。
- 生产服务器会在启动、对外提供服务之前自动执行迁移,因此手动 `pnpm db:migrate` 主要用于首次初始化、排查迁移问题,或在不启动应用的情况下应用迁移。

## 命令

开发服务器前加 `dotenvx run -f .env.local --`;迁移命令不需要(见上)。测试、类型检查、lint、边界检查和 `pnpm build` 不需要;若某个命令因缺少环境变量失败,加上前缀重跑。

```
sudo docker compose -f compose.dev.yml up -d postgres                                    # 仅数据库
sudo docker compose -f compose.dev.yml up -d postgres redis seaweedfs seaweedfs_create_bucket   # 完整基础设施
dotenvx run -f .env.local -- pnpm dev            # 3000 端口(dev:web 仅启动 web)
pnpm db:generate                                 # db:migrate 用于应用(两者都已自带 env 加载)
pnpm --filter web lingui:extract                 # 重新抽取 UI 文案(含 pdf:translations)
pnpm check                                       # Biome + markdownlint + actionlint —— 会写入文件
pnpm test | pnpm typecheck | pnpm build | pnpm exec turbo boundaries
pnpm knip                                        # 未使用的文件/导出/依赖
pnpm docs:gen                                    # 重新生成 docs/spec.json
pnpm test:e2e                                    # Playwright
```

优先用包过滤器而不是全仓库运行,例如 `pnpm --filter web typecheck`、`pnpm --filter @reactive-resume/pdf test`。Vitest 路径是包内相对路径,用法为 `pnpm --filter <package> test -- <path>`。

注意:`compose.yml` 中的应用是**从源码构建**(`build: .`),发布镜像那两行是注释。`compose.dev.yml` 使用 `Dockerfile.dev` 并带 watch 同步。

## 注意事项

- 发送邮件需要 SMTP 配置;未配置时邮件只打印到控制台。开发仍可进行 —— 验证链接会出现在服务端日志里。
- `lefthook.yml` 的 pre-commit 会检查合并冲突标记并对暂存文件跑 Biome。提交前先跑 `pnpm check`。
- `pnpm check` **会写入文件**,并且除 Biome 外还会跑 `markdownlint-cli2 --fix` 与 `github-actionlint`。使用它时要说明这一点;若只想做不修改的检查,用范围更窄的 Biome 命令。
- Biome:制表符缩进、双引号、行宽 120、导入分组有序、`clsx`/`cva`/`cn` 中的 Tailwind 类名排序。
- 多数包用 `tsgo --noEmit` 做类型检查,用 `vitest run --passWithNoTests` 跑测试。
- **`lingui:extract` 具有破坏性。** 它以 `--clean --overwrite` 运行,凡是在 `apps/web/src` 中找不到的 message,都会**连同译文一起删除**。执行前先确认 `git status --porcelain | grep '^ D'` 里只有你有意删除的文件 —— 一旦有目录缺失,抽取器会抹掉几百条译文。执行后要复查空 `msgstr` 条数有没有暴涨。它只扫描 `apps/web/src`,`packages/*` 里的字符串不会被抽取,因此判断"废弃条目"要用全仓库 grep 复核。
- **行尾是 CRLF**,`apps/web/src` 与 `docs/` 大多如此。用脚本做整行精确替换前先归一化换行,否则会静默失配。
- `pnpm docs:gen` 会依据当前 oRPC 契约重新生成 `docs/spec.json`。生成器输出与仓库内文件存在非确定性差异(数组顺序、`minLength`/`maxLength` 有无),因此改 `docs/spec.json` 用手改最小 diff,不要整份覆盖。
- 工作区里可能存在与你无关的本地改动。先 `git status --short`;不要回滚你没有碰过的文件。
