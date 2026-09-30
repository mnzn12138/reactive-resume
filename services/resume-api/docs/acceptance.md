# M6 · 部署 + 验收

> 本文是 **M6 的验收清单**，并且下面每一条都**在本机真跑过**。
> 部署步骤（venv / 起服务 / 进程守护 / 反代 / Alembic）写在**仓库根 `DEPLOYMENT.md` 的第 9 节**，本文只管「怎么验」和「验出来是什么」。
>
> 定位重申：这次 Node → Python 的迁移**不是项目重心**（重心是国产化改造），只是课程要求的最小集。
> **Python 服务不接管生产流量 —— Node 侧仍是权威。** 本轮验收的目标是「一套可复现的部署说明 +
> 一份能跑通的验收清单」，不是把生产切到 Python。

---

## 0. 一次性的环境准备（**照抄，别自创**）

### 0.1 Postgres 镜像**必须**是 glibc 版，不能用 alpine

这是本轮踩到的第一个坑，写在最前面因为它会让 pytest 平白无故红一条：

| 镜像 | libc | `' zebra '` vs `'apple'` 的排序 | `pytest` 结果 |
| --- | --- | --- | --- |
| `postgres:17`（Debian） | glibc | `apple` 在前（忽略前导空格） | **129 passed** |
| `postgres:17-alpine` | **musl** | `' zebra '` 在前（按码位比，空格 < `a`） | **1 failed, 128 passed** |

失败的是 `tests/test_resume_crud.py::test_list_resumes_sort_by_name`。musl 的 `en_US.utf8`
**不做** glibc 那套「一级比较忽略标点/空格」的规则，于是带前导空格的名字排到了前面。

这不是代码回归，**是测试环境的选择问题**。验收库一律用：

```bash
docker run -d --name rr-m6-pg -e POSTGRES_DB=postgres -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55438:5432 postgres:17
```

### 0.2 起 Node 必须用 `cd apps/server && pnpm dev`，不能用根 `pnpm dev`

* 根 `pnpm dev`（turbo 聚合）在本机**必然失败**（Windows `os error 231`）。
* 两个服务要分开起：服务端 `cd apps/server && pnpm dev`，前端 `cd apps/web && pnpm dev`。
* `.env` 是**模块加载时**解析的，改完必须杀掉 node 进程重启，watch 不会重载。

### 0.3 让两边指向同一个临时库（**不要改仓库根 `.env`**）

两边都是「进程环境变量优先于 `.env`」（Python 用 `load_dotenv(override=False)`，Node 用
`process.loadEnvFile()`，后者不覆盖已存在的变量），所以用**命令行前缀**覆盖即可，不动文件：

```bash
# Node（Drizzle 会自己建表）
cd apps/server
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:55438/postgres" SERVER_PORT=3000 pnpm dev

# Python（注意 driver 段是 postgresql+psycopg://）
cd services/resume-api
DATABASE_URL="postgresql+psycopg://postgres:postgres@127.0.0.1:55438/postgres" PORT=4000 \
NODE_RENDER_BASE_URL="http://127.0.0.1:3000" "$PY" -m uvicorn app.main:app --host 127.0.0.1 --port 4000
```

⚠️ `PORT=4000` **必须显式写**。仓库根 `.env` 里 `PORT="3000"`（那是前端 dev 端口），
Python 会把它继承过来去抢 3000，和 Vite 撞 `EADDRINUSE`。`tools/check_env_parity.mjs`
会专门告警这一条。

---

## 1. 验收清单与实测结果

实测时间 2026-09-29，环境：Node v24.20.0（`apps/server`，端口 3000）+ Python 3.13.14 venv
（uvicorn，端口 4000）+ Postgres 17 glibc（`127.0.0.1:55438`，临时库）。

| # | 验收项 | 怎么做 | 实测结果 |
| --- | --- | --- | --- |
| 1 | 环境变量名一字不差 | `node services/resume-api/tools/check_env_parity.mjs` | ✅ **exit 0**：一致 2 项（`AUTH_SECRET` / `DATABASE_URL`），Python 侧独有 3 项，`PORT` 判为「同名不同义」并告警 |
| 2 | `AUTH_SECRET` 两边**取值**一致 | 同上加 `--values` | ✅ 两边 sha256 摘要同为 `69de111c46dd`（长度 64） |
| 3 | `pytest` 全绿 | `RESUME_API_TEST_DATABASE_URL=... "$PY" -m pytest -q` | ✅ **136 passed**（基线 129 + M6 新增 7）。M6 收尾时又补了 1 个用例，现在**收集到 137 个**；这第 137 个**没能实跑**，原因见第 7 节 |
| 4 | 认人：Node 签发的 cookie，Python 认出同一 user | 用 Node 的 `/api/auth/sign-up/email` 真注册一个账号，拿它的 cookie 打 Python `/resumes` | ✅ 200（`[]`）；编码形态也 200 |
| 5 | 匿名访问被挡 | 不带 cookie 打 `/resumes` | ✅ 401 `UNAUTHORIZED` |
| 6 | `listResumes` | `GET /resumes`（带 cookie） | ✅ 200，返回 1 条元数据 |
| 7 | `createResume` | `POST /resumes` | ✅ 200，返回新 id `01a0ee22-…` |
| 8 | `getResume` | `GET /resumes/{id}` | ✅ 200，含完整 `data` |
| 9 | `updateResume` | `PUT /resumes/{id}`（改名 + `isPublic: true`） | ✅ 200，字段已更新 |
| 10 | `patchResume` | `PATCH /resumes/{id}`，`replace /basics/name` | ✅ 200，`data.basics.name` 变成「张三丰」 |
| 11 | `getResumeBySlug`（公开页，无 cookie） | `GET /resumes/{username}/{slug}` | ✅ 200，且 `name` 被脱敏成 `"Resume"`（非 owner 视角） |
| 12 | `deleteResume` | `DELETE /resumes/{id}` | ✅ 200；再 get 是 404 |
| 13 | 越权 / 不存在 → 404 而不是 403 | 用不存在的 id 打 `/resumes/{id}` | ✅ 404 `NOT_FOUND` |
| 14 | slug 冲突 → 400 | 连建两次同名 slug | ✅ 400 `RESUME_SLUG_ALREADY_EXISTS` |
| 15 | `downloadResumePdf` 真返回 PDF 字节 | `GET /resumes/{id}/pdf`（带 cookie） | ✅ 200，3857 字节，魔数 `%PDF-1.3`，`Content-Type: application/pdf`，**耗时 68.8 s**（冷启动） |
| 16 | `downloadPublicResumePdf` | `GET /resumes/{username}/{slug}/pdf`（无 cookie） | ✅ 200，3857 字节，`%PDF-1.3`，0.52 s（已热） |
| 17 | 匿名访问私有 PDF 出口 | 不带 cookie 打 `/resumes/{id}/pdf` | ✅ 401，且不触发上游渲染 |
| 18 | 限流真的会挡（300 次 / 60 秒） | 对同一个 id 连发 311 次 `DELETE` | ✅ 第 **301** 次开始返回 429 `TOO_MANY_REQUESTS`（前 300 次放行：1×200 + 299×404） |
| 19 | `alembic stamp` 步骤可走通 | 在临时库上 `alembic stamp 0002` 后 `alembic current` | ✅ `0002 (head)` |

### 1.1 第 4 项是怎么验的（**这是本轮最有价值的一条**）

不用假 cookie，直接让 Node 真签一个：

```bash
# 1) Node 侧真实注册（现在必须带 legalConsent，否则 403）
curl -i -X POST http://127.0.0.1:3000/api/auth/sign-up/email \
  -H 'Content-Type: application/json' \
  -d '{"email":"m6acceptance@example.test","password":"Acceptance123!","name":"M6 验收用户",
       "legalConsent":{"accepted":true,"version":"2026-09-29"}}'

# 2) 响应里 Set-Cookie 给的就是 better-auth.session_token，原样拿去打 Python
curl -H "Cookie: better-auth.session_token=<上一步的 cookie>" http://127.0.0.1:4000/resumes
```

⚠️ **这一步在修 `app/identity.py` 之前是 401**，原因见第 4 节。

---

## 2. 环境变量一致性检查脚本

```bash
node services/resume-api/tools/check_env_parity.mjs            # 只比名字（可进 CI，不需要 Node/Python 能跑）
node services/resume-api/tools/check_env_parity.mjs --values    # 再比一次 AUTH_SECRET 的实际取值
node services/resume-api/tools/check_env_parity.mjs --strict    # 任何非「一致」都算失败
```

退出码：`0` 通过 / `1` 用法错误 / `2` 一致性检查失败。

它做的事：从 `app/config.py`（+ `tests/conftest.py`）抽 Python 侧读的变量，从
`packages/env/src/server.ts` 的 `server: {...}` 抽 Node 侧声明的变量，逐项分类：

| 分类 | 含义 | 是否失败 |
| --- | --- | --- |
| 一致 | 两边同名 | 否 |
| Python 侧独有 | Node 不需要知道这件事（如 `NODE_RENDER_BASE_URL`：Node 自己就是渲染方） | 否（`--strict` 下算失败） |
| 同名不同义 | 名字对上了但两边解释不同（目前只有 `PORT`） | 否，但会告警 |
| 名字不一致 | Node 侧没有同名、但有编辑距离 ≤ 2 的疑似项 | 是 |

**`AUTH_SECRET` 与 `DATABASE_URL` 是硬失败项**：名字不同、或在 `.env` 里缺失/为空，直接 exit 2。

`PORT` 会单独告警（本轮实测**确实触发**）：`.env` 里 `PORT="3000"` 与 `APP_URL` 的端口相同，
Python 继承后会去抢前端的端口。

---

## 3. 实测出来的 Node 路由前缀（**不是猜的**）

M5 留下一句「oRPC 挂在 `/api/rpc/*` 下」但没验过。本轮起真实 Node 服务逐个打了一遍：

| 路径 | 实测 | 说明 |
| --- | --- | --- |
| `POST /api/rpc/<spec 里的 path>` | **200** | ✅ oRPC **确实**挂在 `/api/rpc` 下（用 `POST /api/rpc/resume/getRoot` 验证） |
| `GET /api/rpc/resumes` | 404 | oRPC 的 `StrictGetMethodPlugin` 不让走 GET（probe 路径要用 POST） |
| `/api/openapi/spec.json` | **200** | 权威 spec，OpenAPI 3.1.1，63 个 path |
| `/api/openapi`（裸路径） | **404** | 必须带 `/spec.json` |
| `/api/health` | 200 | `status: healthy`，`database` / `storage` 两项都 healthy |
| `/api/auth/*` | 200 | Better Auth（`/api/auth/get-session`） |
| `/api/resumes/:id/pdf` | 401 | Hono 路由，**不是** oRPC；无 token 就 401 |
| `/api/resumes/:username/:slug/pdf` | 404 | 同上（slug 不存在时） |
| `/schema.json` | 200 | 简历数据的 JSON Schema |
| `/api/uploads/*`、`/uploads/*` | 400 | 上传通道 |
| `/mcp`、`/mcp/*` | 401 | MCP |
| `/.well-known/*` | 200 | OAuth / MCP 元数据 |
| `/robots.txt`、`/sitemap.xml`、`/llms.txt` | 200 | SEO |
| `/*` | 200 | 前端兜底 |

**结论：`/api/rpc/*` 那句是对的。** 但要注意 —— **spec 里的 path 不带 `/api/rpc` 前缀**
（spec 里是 `/resumes`、`/resumes/{id}`），实际 HTTP 路径是 `/api/rpc` + spec path。
另外 `GET /api/resumes/:id/pdf` 是独立的 Hono 路由，**不**走 oRPC。

⚠️ **Python 侧的路径没有 `/api` 前缀**（`/health`、`/resumes`、`/resumes/{id}/pdf`）。
这既是好消息（不会和 Node 的 `/api/*` 撞），也是部署时必须注意的点 —— 反代要切流量就得处理
这个前缀差异，详见 `DEPLOYMENT.md` 第 9.5 节。

---

## 4. 本轮实测发现的两个问题（**都是真问题，不是环境噪音**）

### 4.1 会话 cookie 是带签名的 —— M3 的认人假设错了，已修

**现象**：拿 Node 真实签发的 cookie 打 Python `/resumes` → **401**；
只取 cookie 的第一段打 → 200。

**原因**：better-auth 1.7 起写进浏览器的 cookie 是

```
<session.token> "." base64(HMAC-SHA256(key = AUTH_SECRET, msg = session.token))
```

而 `session` 表里**只存前半段**。M3 的 `app/identity.py` 拿整个 cookie 去
`WHERE session.token = ?`，永远查不到。

* 编码是**标准 base64、带 `=` 填充**（不是 base64url，也不是去填充变体）—— 实测反推并钉了用例。
* 浏览器回传的是 `Set-Cookie` 里那个**已编码**的串（`+`→`%2B`、`=`→`%3D`），两种形态都要认。
* ⚠️ **到 Python 手里的一定是「已编码」那一种**：`starlette.requests.cookie_parser` 走的是
  `http.cookies._unquote`，只剥两端的双引号、**不做** percent 解码（实测
  `cookie_parser('…%3D')` 原样返回 `'…%3D'`）。所以 `app/identity.py` 里那个「解码后再试一次」
  的候选是**必经之路**，不是保险 —— 少了它照样一律 401。

本条的验证不是靠反推：直接用 better-auth 真实依赖的 Hono cookie 工具
（`hono/dist/utils/cookie.js` 的 `serializeSigned`）签一个 cookie，交给 Python 侧的
`split_signed_token` + `signature_matches` 验，token 与签名两边都对得上；同时 Hono 自己的
`parseSigned` 也认回同一个 token，说明 Python 剥出来的和 Node 剥出来的是同一段。
完整源码链路见 `app/identity.py` 模块 docstring 的对照表。

**为什么 M3 的 8 个用例没抓到**：那批用例里 cookie 和库里的 token 是同一个值（夹具自己造的），
两边同源，所以永远绿。**自己签自己验是自证，证明不了 Node 认不认** —— 和 M5 令牌互签同一个道理。

**处置**：改 `app/identity.py` —— 剥掉签名段再查，并**验签**（用 `AUTH_SECRET`）。
这让 `AUTH_SECRET` 有了**第三个**用途（另两个是限流 pepper、PDF 令牌签名）。
新增 `tests/test_identity_cookie_signature.py`（8 个用例，全部照 better-auth 的真实形态造 cookie；
第 8 个是「token 自己带 `.`」，钉住按**最后一个** `.` 切这件事）。

### 4.2 生产库还没 `alembic stamp` —— 而且要 stamp 的是 `0002` 不是 `0001`

* 现在的库是 Drizzle 建出来的，**没有** `alembic_version` 表，`alembic current` 为空。
* 交给 Alembic 之前必须先 stamp，否则 `upgrade head` 会试图重跑基线（表已存在 → 报错）。
* ⚠️ 要 stamp 的是**当前 head `0002`**，不是 `0001`：Drizzle 的迁移里已经包含校招岗位板那三张表
  （`recruitment_post` / `recruitment_post_bookmark` / `recruitment_post_report`，实测库里都有）。
  只 stamp `0001` 会让 `0002` 处于待应用状态，下次 `upgrade head` 又会去建已存在的表。

本轮**没有**对生产库执行 stamp（按约束不动正在使用的库），只在临时库上验证了这个步骤能走通。

---

## 5. 没验到的（如实记录）

| 项 | 状态 | 原因 |
| --- | --- | --- |
| `packages/pdf` 的 JSX 问题 | **用临时 shim 绕过，没修** | `packages/pdf/tsconfig.json` 仍是 `jsx: "preserve"`，`pnpm dev`（tsx）会把 `document.tsx` 的 JSX 编成 `React.createElement(...)` 而该文件没 import React → dev 模式下任何服务端 PDF 渲染 500。本轮照 M5 的办法额外 `--import` 一个把 React 挂成全局的 shim 绕开，**shim 在仓库外的临时目录，没进仓库、没改任何 Node 文件**。已有另一位工程师在改 `packages/pdf` 的 `jsx` |
| 生产库 `alembic stamp` | **没执行** | 约束要求不动正在使用的库 |
| 反向代理实际切流 | **没做** | Python 不接管生产流量；`DEPLOYMENT.md` 里给的是规则，不是已上线的配置 |
| PDF 的视觉校验 | **没做** | 只验「是 PDF 字节 + 头正确」，渲染出来长什么样不在范围内（沿用 M5 的边界） |
| 并发 / 大简历 / 超时重试 | **没做** | 同上，沿用 M5 的边界 |
| Node 是否采信 `X-Forwarded-For` | **没验** | 沿用 M5 的未验证项（影响公开渲染限流的分桶） |

---

## 6. 跑一遍的最短路径（复制即用）

```bash
export PATH="/usr/bin:/bin:$PATH"
PY="C:/Users/22586/.workbuddy/binaries/python/envs/reactive-resume/Scripts/python.exe"

# 1) 环境门禁
node services/resume-api/tools/check_env_parity.mjs --values

# 2) 单测（glibc 版 Postgres！）
cd services/resume-api
RESUME_API_TEST_DATABASE_URL="postgresql+psycopg://postgres:postgres@127.0.0.1:55438/resume_api_test" \
  "$PY" -m pytest -q

# 3) 起 Node（另开一个终端，别用根 pnpm dev）
cd apps/server && DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:55438/postgres" SERVER_PORT=3000 pnpm dev

# 4) 起 Python
cd services/resume-api
DATABASE_URL="postgresql+psycopg://postgres:postgres@127.0.0.1:55438/postgres" PORT=4000 \
  "$PY" -m uvicorn app.main:app --host 127.0.0.1 --port 4000

# 5) 冒烟
curl -s http://127.0.0.1:4000/health
```

curl 记得加 `--noproxy '*'`：本机环境有 `HTTP_PROXY`，不加的话打 127.0.0.1 会被代理拦掉，
**全部返回 502**，看起来像服务挂了（本轮踩过）。

---

## 7. 收尾这一轮的复验状态（**如实记录**）

上一轮的结果是上一轮的。收尾这一轮重新验了一遍：能验的验了，验不了的说清原因。
既不把上一轮的记录当成这一轮的结论，也不伪造这一轮的结果。

### 7.1 这一轮重新验过并**确认**的

| 项 | 怎么验的 | 结果 |
| --- | --- | --- |
| cookie 签名这件事是真的 | 对着 better-auth **1.7.3** / better-call **1.4.0** 的源码逐项核：算法、密钥、签名输入、base64 变体、分隔符、落盘编码 | ✅ 确认。上一轮的修法**基本正确**，仅分隔符一处需修正（见 7.2） |
| Python 认得出 Node 签的 cookie | 用 better-auth 真实依赖的 Hono `serializeSigned` 签一个 cookie，交给 Python 的 `split_signed_token` + `signature_matches` | ✅ token 与签名都对得上；Hono 自己的 `parseSigned` 也认回同一段 |
| 验签是常量时间比较 | 读源码 + 直接调用 | ✅ 用的是 `hmac.compare_digest`，**不是** `==` |
| `AUTH_SECRET` 缺失 / 不匹配 | 分别用空串与错误密钥跑 `signature_matches` | ✅ 都返回 False → 明确 401，**不是静默放行** |
| 环境变量名一致 | `node services/resume-api/tools/check_env_parity.mjs` | ✅ **exit 0**。一致 2 项（`AUTH_SECRET` / `DATABASE_URL`），Python 侧独有 3 项，`PORT` 判「同名不同义」并告警；**没有**「名字不一致」项 |
| 用例数量 | `pytest --collect-only -q` | ✅ **137 个**（8 + 8 + 58 + 25 + 29 + 9） |

### 7.2 这一轮**修正**了上一轮的一处偏差

上一轮按**第一个** `.` 切（`str.partition`）。核源码时发现 better-call 用的是
`value.lastIndexOf(".")`，也就是**最后一个** `.`。默认的 `generateId` 只出 `[a-zA-Z0-9]`，
两种切法结果一样，所以实测看不出差别；但 better-auth 允许配自定义 `generateId`，
一旦 token 里出现 `.`，按第一个切会把 token 拦腰截断 —— 表现又是满屏 401，
和当初没剥签名时长得一模一样。已改成按最后一个 `.` 切（`str.rpartition`），
并补了第 8 个用例钉住它。

### 7.3 这一轮**没能实跑**的（原因是环境，不是代码）

| 项 | 状态 | 原因 |
| --- | --- | --- |
| `pytest` 实跑（137 个用例） | **未验证** | 需要一个能连上的 Postgres。本机 Docker 起不来：`wsl.exe` 被沙箱安全策略拦截（`PROGRAM BLOCKED BY SECURITY POLICY`），Docker Desktop 的 Linux VM 因此无法启动（`com.docker.backend.exe services: exit status 150`）。没有 WSL/VFKit 就没有容器，`postgres:17` 拉不起来；本机也没有原生 Postgres，PyPI 上也没有同时适用「本机平台 + Python 3.13」的嵌入式 Postgres 包。**收集能跑（137 collected），执行跑不了。** |
| 第 1 节第 4~18 项端到端（7 个 CRUD / PDF 真实字节 / Node 签发的 cookie / 限流真的会挡） | **未验证** | 同上 —— 这些都要「Postgres + Node 服务 + Python 服务」三者同时在线 |
| `check_env_parity.mjs --values` | **未验证** | 这条要真起 Node 侧进程去读 `env.AUTH_SECRET`，而 Node 服务依赖数据库、起不来。**只完成了变量名比对**（exit 0），**取值**比对没做 |

**交接时必须补做**：找一台 Docker（或任意能连的 Postgres）可用的机器，按第 6 节跑一遍
`pytest -q`，确认 **137 个全绿**（尤其新增的第 8 个 cookie 用例），再把第 4~18 项端到端过一遍。
在那之前，「137 passed」只是**收集数**，不是**通过数**。
