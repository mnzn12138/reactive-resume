# 部署指南

这份文档面向**拿到本仓库要把它跑起来的同学**。照着做即可，不需要提前了解项目结构。

应用本身跑在**宿主机**（用 pnpm），Docker 只用来起 PostgreSQL、Redis、存储这几个基础设施。

想深入改代码，看完这份之后再读 [`AGENTS.md`](./AGENTS.md)（包边界、命令约定、注意事项）和 [`docs/contributing/architecture.mdx`](./docs/contributing/architecture.mdx)。

---

## 目录

- [1. 前置条件](#1-前置条件)
- [2. 本机运行（pnpm）](#2-本机运行pnpm)
- [3. 环境变量说明](#3-环境变量说明)
- [4. 首次启动后必做：创建管理员](#4-首次启动后必做创建管理员)
- [5. 常用运维命令](#5-常用运维命令)
- [6. 部署验收清单](#6-部署验收清单)
- [7. 已知坑](#7-已知坑)
- [8. 目录结构速览](#8-目录结构速览)

---

## 1. 前置条件

| 依赖 | 版本要求 | 说明 |
| --- | --- | --- |
| Node.js | **>= 24** | 见根 `package.json` 的 `engines` |
| pnpm | **12.3.4** | 仓库锁了 `packageManager` 字段，用 `corepack enable` 可自动匹配 |
| Docker + Docker Compose | 最新稳定版 | 只用来起数据库等基础设施，应用跑在宿主机 |
| Git | 任意 | 拉代码 |

Node 版本不对会在安装或启动时报奇怪的错，先确认：

```bash
node -v   # 应 >= 24
pnpm -v   # 应为 12.x
```

Linux 上如果 Docker 需要 root，本文所有 `docker compose` 命令前加 `sudo`。

---

## 2. 本机运行（pnpm）

### 2.1 拉代码并安装依赖

```bash
git clone https://github.com/mnzn12138/reactive-resume
cd reactive-resume
pnpm install
```

装完如果报 `Cannot find package 'X'`，先看第 7.1 节。

### 2.2 起基础设施

```bash
docker compose -f compose.dev.yml up -d postgres redis seaweedfs seaweedfs_create_bucket
```

启动的是：

- **PostgreSQL** — 数据库，端口 `5432`
- **Redis** — AI Agent 工作区的流与状态，端口 `6379`
- **SeaweedFS** — S3 兼容存储，端口 `8333`（`seaweedfs_create_bucket` 只负责建桶，跑完就退出）

等所有服务 healthy 再往下：

```bash
docker compose -f compose.dev.yml ps
```

### 2.3 准备环境变量

```bash
cp .env.example .env
```

编辑 `.env`，本机运行要把**主机名改成 `localhost`**（`.env.example` 里写的是容器内的服务名，直接用会连不上）：

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres"
S3_ENDPOINT="http://localhost:8333"
REDIS_URL="redis://localhost:6379"
```

另外**必须换掉** `AUTH_SECRET`：

```bash
AUTH_SECRET="<用 openssl rand -hex 32 生成一串>"
```

### 2.4 启动开发服务器

```bash
pnpm dev
```

打开 <http://localhost:3000>。开发模式下 Vite 占 `PORT`（默认 3000），Hono 服务端占 `SERVER_PORT`（默认 3001），Vite 会把 API 请求代理过去，所以**只用 3000 端口访问即可**。

只跑前端可以用 `pnpm dev:web`。

> **为什么不用 `dotenvx run -f .env.local -- pnpm dev`？**
>
> 那个前缀的作用是把 `.env.local` 注入进程。而应用运行时本来就只读根目录的 `.env`（见 3.1），
> 本仓库的配置也都写在 `.env` 里，所以**直接 `pnpm dev` 就够了**。
>
> 更关键的是：注入进来的变量优先级**高于** `.env`。一旦 `.env.local` 里某个变量是空值，
> 它会把 `.env` 里配好的真实值**覆盖成空**，而且不报任何错（实测见 3.1）。
>
> 另外 `dotenvx` 不是本项目依赖 —— `package.json` 里没有它，用之前得自己另外装。

### 2.5 跑生产模式（可选）

```bash
pnpm build
pnpm start
```

`pnpm build` 构建前端与服务端产物，`pnpm start` 直接跑构建好的服务端。

### 2.6 数据库迁移

一般情况下**不用手动迁移** —— 服务端启动时会先跑迁移再对外提供服务。

需要手动执行时（首次初始化、排查迁移问题、不启应用直接应用迁移）：

```bash
pnpm db:migrate
```

改了 `packages/db/src/schema/*` 之后生成迁移文件：

```bash
pnpm db:generate
```

> 这两个命令**不需要**加 `dotenvx` 前缀 —— `packages/db/drizzle.config.ts` 自己会加载根目录的 `.env`（`.env.local` 若存在也会读，但本仓库已不维护）。已经存在的环境变量优先，不会被文件覆盖。

### 2.7 停止 / 清理

```bash
docker compose -f compose.dev.yml down          # 停掉基础设施，保留数据卷
docker compose -f compose.dev.yml down -v       # 连数据卷一起删（数据库数据会丢）
```

---

## 3. 环境变量说明

完整清单和注释看 [`.env.example`](./.env.example)，这里只讲容易出错的。

### 3.1 只维护 `.env` 一个文件

应用运行时**只**加载仓库根目录的 `.env`（`packages/env/src/server.ts`）。本仓库就维护这一个文件，不要另建 `.env.local`。

历史上这里并存过 `.env.local`，现在**已删除**（备份留在 `.env.local.bak`，同样被 gitignore）。它为什么危险：

| 文件 | 谁读它 | 现状 |
| --- | --- | --- |
| `.env` | 应用运行时、drizzle 配置 | **唯一维护的文件** |
| `.env.local` | 只有 `dotenvx run -f .env.local --` 注入时才生效；drizzle 配置也会读 | 已删除，别再建 |

关键点：

- 运行时**只**加载 `.env`，**不读** `.env.local`。
- `process.loadEnvFile()` 不会覆盖**已存在**的环境变量 —— 所以 `dotenvx` 注入的值优先级**高于**文件。
- 直接 `pnpm dev`（不加前缀）读的就是 `.env`；此时你去改 `.env.local` **不会生效**。
- `env` 在模块加载时解析，**改完必须重启服务**，热更新不会重载。

**实测过的坑**：当时 `.env` 已配好 SMTP，而 `.env.local` 里 `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` 是**空字符串**。一旦套 `dotenvx run -f .env.local --` 启动，这些空值被注入进程，而 `loadEnvFile` 又覆盖不回来 —— 结果 SMTP 四个变量缺三个，应用**不报错、也不发信**（静默失效，见 3.3）。这正是删掉它的原因。

### 3.2 必需的三项

缺任何一个，应用启动就会报错：

| 变量 | 示例 | 说明 |
| --- | --- | --- |
| `APP_URL` | `http://localhost:3000` | 对外访问地址，用于 OAuth 回调、OpenGraph、上传 URL |
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/postgres` | 本机运行用 `localhost` 作主机名 |
| `AUTH_SECRET` | `openssl rand -hex 32` 的结果 | 会话密钥，生产环境必须换掉 |

### 3.3 邮件（SMTP）

配了才能发验证邮件、重置密码邮件。

判定条件是 **`SMTP_HOST` + `SMTP_USER` + `SMTP_PASS` + `SMTP_FROM` 四者齐全**；缺任意一个，应用**不会报错**，只会把邮件内容打印到服务端日志 —— 这个"静默失败"最容易被误判成配置生效了。

参考配置（Gmail）：

```bash
SMTP_HOST="smtp.gmail.com"
SMTP_PORT="465"
SMTP_SECURE="true"
SMTP_USER="<你的 Gmail 地址>"
SMTP_PASS="<应用专用密码，不是登录密码>"
SMTP_FROM="Reactive Resume <你的 Gmail 地址>"
```

注意：

- 465 端口配 `SMTP_SECURE="true"`；587 用 STARTTLS 则配 `false`。
- 密码栏填**授权码 / 应用专用密码**。Gmail 需要先开两步验证，再去 `myaccount.google.com/apppasswords` 生成 16 位密码。
- `SMTP_FROM` 的邮箱地址要和账号一致，否则会被服务商拒收。
- 后台 `/admin/settings` 页面的 "Outbound email" 会用同样的四个条件显示 `Configured` / `Not configured`，可以拿来快速确认。

### 3.4 存储

- `S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY`、`S3_BUCKET` **三者都设置**才会走 S3 兼容存储（这里是 SeaweedFS）。
- 三者任一缺失 → 用本地文件系统，默认写在仓库的 `data/` 目录，可用 `LOCAL_STORAGE_PATH` 改，**必须是绝对路径**。
- `.env.example` 自带 SeaweedFS 的默认值。如果**不打算起 seaweedfs 容器**，就把这几个 `S3_*` 注掉，否则上传会失败。

### 3.5 功能开关

| 变量 | 作用 |
| --- | --- |
| `FLAG_DISABLE_SIGNUPS` | 禁止新注册（含社交登录） |
| `FLAG_DISABLE_EMAIL_AUTH` | 关闭邮箱密码登录、邮箱验证、找回密码；社交登录仍可用 |
| `FLAG_DISABLE_IMAGE_PROCESSING` | 关掉图片处理，低配机器（如树莓派）可用 |
| `FLAG_DISABLE_API_RATE_LIMIT` | 关闭认证接口限流（生产默认开启，不建议关） |
| `FLAG_ALLOW_UNSAFE_OAUTH_REDIRECT_URI` | 允许任意 OAuth 回调地址，**公网多租户部署有钓鱼/令牌泄露风险**，只在可信自托管环境开 |
| `FLAG_ALLOW_UNSAFE_AI_BASE_URL` | 允许 AI 供应商填任意 base URL，**多租户下有 SSRF 风险**，同上 |

前两项也可以在后台 `/admin/settings` 里**运行时开关**，不用重启。

### 3.6 只在用 AI/Agent 功能时才需要

`REDIS_URL` 和 `ENCRYPTION_SECRET` 对核心简历流程是可选的，但**保存 AI 供应商配置**和**已登录的 `/agent` 工作区**需要两者。

---

## 4. 首次启动后必做：创建管理员

管理后台 `/admin` 要求账号角色是 `admin`，而**注册出来的第一个账号默认是普通用户**。所以必须用命令行提升一个：

```bash
# 1. 先在网页上注册一个账号
# 2. 再把它提升为管理员
pnpm admin:promote -- you@example.com
```

也可以传用户名。撤销管理员：

```bash
pnpm admin:promote -- you@example.com --revoke
```

忘了密码（且**没配 SMTP**，走不了邮件重置）：

```bash
pnpm admin:reset-password -- you@example.com 'new-password'
```

密码要求 8–64 位。对纯社交登录注册的账号，这个脚本会自动补建凭证记录。

管理后台四项功能：概览（统计与注册趋势）、用户（改角色/封禁/删除）、简历（锁定/删除）、审计（操作日志）+ 设置（运行时开关、SMTP 状态）。**所有写操作都会落审计日志**。

---

## 5. 常用运维命令

| 命令 | 用途 |
| --- | --- |
| `pnpm admin:promote -- <邮箱或用户名>` | 提升为管理员（`--revoke` 撤销） |
| `pnpm admin:reset-password -- <邮箱或用户名> '<新密码>'` | 重置密码 |
| `pnpm db:migrate` / `pnpm db:generate` / `pnpm db:studio` | 迁移相关（自带 env 加载，不用套 dotenvx） |
| `pnpm build` / `pnpm start` | 构建 / 启动生产服务 |
| `pnpm typecheck` | 类型检查（应 19/19 通过） |
| `pnpm test` | 全仓库测试（约 5 分钟） |
| `pnpm --filter web lingui:extract` | 重新抽取 UI 文案 |
| `pnpm check` | Biome + markdownlint + actionlint，**会写入文件** |
| `pnpm knip` | 检查未使用的文件/导出/依赖 |

只想做不修改的检查，用 `pnpm exec biome check .` 代替 `pnpm check`。

⚠️ **`pnpm db:reset` 会执行 `DROP SCHEMA public CASCADE`，清空整个数据库。** 名字很有误导性，它**不是**"重置密码"，别乱用。

---

## 6. 部署验收清单

按顺序过一遍，确认部署真的成功了：

| # | 检查项 | 怎么做 | 通过标准 |
| --- | --- | --- | --- |
| 1 | 服务健康 | `curl -i http://localhost:3000/api/health` | HTTP **200**。返回的 JSON 里 `status` 为 `healthy`，且 `database`、`storage` 两项都是 `healthy`（任一项不健康时会返回 503，并带 `error` 字段说明是哪一项） |
| 2 | 首页可访问 | 浏览器打开 `APP_URL` | 页面正常渲染 |
| 3 | 注册 + 登录 | 注册一个账号并登录 | 能进入仪表盘 |
| 4 | 管理后台 | 执行 `pnpm admin:promote`，再访问 `/admin` | 能看到概览页，不被重定向 |
| 5 | 邮件（若配了 SMTP） | `/auth/forgot-password` 走一遍 | 收到重置邮件；`/admin/settings` 显示 `Configured` |
| 6 | 文件上传 | 简历里上传一张图片 | 图片能保存并显示 |
| 7 | 导出 | 导出一份 PDF | 能下载，内容正常 |

第 4 步最容易漏 —— 没提升管理员的话 `/admin` 会被重定向到仪表盘，看起来像"后台没部署上"。

---

## 7. 已知坑

### 7.1 `pnpm install` 后出现 `Cannot find package`

沙箱/部分环境下 pnpm 建了目录但没建出指向 `.pnpm` 的链接，留下空目录。症状就是找不到包。

处理：删掉 `packages/*/node_modules` 里对应的空目录再重装。注意 scope 包（`@scope/name`）藏在下一层，平铺扫描会漏。

### 7.2 `pnpm --filter web build` 偶尔卡住

会停在 `✓ 19655 modules transformed.` 之后不动。这不是代码问题，**停掉重跑**即可，第二次通常十几秒就构建完。

### 7.3 改了环境变量没生效

`env` 是模块加载时解析的，**改完 `.env` 必须重启服务**，watch 模式不会重载。

另外确认你改的文件对不对 —— 见第 3.1 节。

### 7.4 邮件"没反应"

SMTP 是**静默失败**设计：四个变量缺一个，邮件就只打到服务端日志，不报错也不发信。去日志里找打印出来的邮件内容（开发时验证链接就在里面）。

### 7.5 界面出现英文

本项目默认语言是**简体中文**（`apps/web/src/libs/locale.ts` 的 `defaultLocale`）。所以看到英文基本不是"没翻译"，而是**代码里硬编码了没走 i18n**。

排查：先查译文在不在 ——

```bash
grep -B1 -A2 '^msgid "Cancel"$' apps/web/locales/zh-CN.po
```

有译文却显示英文，就是硬编码。改完文案的流程：改代码 → `pnpm --filter web lingui:extract` → 补 `zh-CN.po` / `zh-TW.po` 里空的 `msgstr` → `pnpm typecheck` → `pnpm exec biome check <改动文件>`。

⚠️ `lingui:extract` 以 `--clean --overwrite` 运行，**会连译文一起删掉源码里找不到的条目**。执行前先确认 `git status --porcelain | grep '^ D'` 里只有你有意删除的文件，执行后复查空 `msgstr` 条数有没有暴涨。

### 7.6 `pnpm check` 会改文件

它跑的是 `biome check --write --unsafe .`，还会跑 `markdownlint-cli2 --fix` 和 `github-actionlint`。只想看问题不想被改文件，用 `pnpm exec biome check .`。

### 7.7 行尾是 CRLF

仓库用 CRLF。写脚本做整行精确替换时先归一化换行，否则会静默失配。

---

## 8. 目录结构速览

```
reactive-resume/
├── apps/
│   ├── web/          # 前端：TanStack Start 路由、页面、浏览器端 UI
│   └── server/       # 生产服务端：Hono、HTTP 适配器、静态资源
├── packages/
│   ├── api/          # oRPC 业务接口
│   ├── auth/         # Better Auth 配置
│   ├── db/           # Drizzle 客户端与 schema
│   ├── pdf/ docx/    # 导出
│   ├── ui/           # 共享 UI 组件（不含 i18n）
│   └── ...
├── tooling/          # 开发脚本（含 admin:promote 等 CLI）
├── migrations/       # 数据库迁移
├── docs/             # 英文文档站
└── data/             # 本地存储（未配 S3 时的上传文件）
```

更详细的包边界与依赖方向见 [`AGENTS.md`](./AGENTS.md)。

---

## 附：技术栈

| 类别 | 技术 |
| --- | --- |
| 框架 | TanStack Start（React 19 + Vite） |
| 服务端 | Hono（生产）/ Vite dev server（开发） |
| 数据库 | PostgreSQL + Drizzle ORM |
| API | oRPC（端到端类型安全） |
| 认证 | Better Auth |
| 存储 | S3 兼容（SeaweedFS）或本地文件系统 |
| 样式 | Tailwind CSS |
| 状态 | Zustand + TanStack Query |

PDF 导出从 v5.1.0 起**完全在浏览器端**用 `@react-pdf/renderer` 生成，不再需要 Browserless / Chromium，相关的 `PRINTER_*`、`BROWSERLESS_*` 变量已失效。
