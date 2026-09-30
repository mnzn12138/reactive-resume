# 环境变量对照表（Node ↔ Python）

> 本文对应迁移里程碑 **M5 · PDF / DOCX 联调**，是 **M6 · 环境变量对齐** 的输入。
> M6 的验收点是「两边环境变量名必须一字不差」，这张表就是它的清单与判定依据。
>
> 命名事实：Node 侧读的是**仓库根 `.env`**（`packages/env/src/server.ts` 用
> `process.loadEnvFile(workspaceRoot + "/.env")`）；Python 侧 `app/config.py` 也读同一个文件
> （`REPO_ROOT / ".env"`，且 `override=False`，真实进程环境变量优先）。所以两边**确实是同一份
> 源**，不存在「各读各的」的问题 —— 剩下要盯的只有「同一个名字两边解释是否一致」。

## 1. 总表

| 变量 | Python 侧用途 | Node 侧对应名 | Node 侧默认值 | Python 侧默认值 | 必须一致？ |
| --- | --- | --- | --- | --- | --- |
| `DATABASE_URL` | SQLAlchemy 连接串 | `DATABASE_URL` | 无（必填，`z.url`） | `postgresql+psycopg://postgres:postgres@127.0.0.1:5432/postgres` | **是**（同一个库） |
| `AUTH_SECRET` | 限流 HMAC pepper + **PDF 下载令牌签名** | `AUTH_SECRET` | 无（必填，`z.string().min(1)`） | `""`（空串，签令牌时会直接报错） | **是，且是硬前提** |
| `NODE_RENDER_BASE_URL` | M5：转发 PDF 渲染请求的目标地址 | 无（Node 自己就是渲染方） | — | `http://127.0.0.1:3000` | 否（Python 独有），但**值必须指向真在跑的 Node** |
| `NODE_RENDER_TIMEOUT_SECONDS` | M5：单次渲染转发的超时 | 无 | — | `120`（秒） | 否（Python 独有） |
| `PORT` | uvicorn 监听端口 | `PORT`（**仅** `NODE_ENV=production` 时读） | `3000` | `4000` | **否 —— 而且不能一致**（见 §3） |
| `SERVER_PORT` | 不读 | `SERVER_PORT` | `3001`（`.env` 里也是 3001） | — | 否（Node 独有） |
| `RESUME_API_TEST_DATABASE_URL` | 测试库连接串（仅 pytest） | 无 | — | `postgresql+psycopg://...@5432/resume_api_test` | 否（测试专用） |

## 2. 必须一字不差的两项

### 2.1 `AUTH_SECRET` —— 这次联调的硬前提

它有**三个**用途，全部都要求两边**同值**：

1. **限流的 HMAC pepper**（M4 引入，Python 侧自己的设计，Node 的 `resumeMutationRateLimit`
   实际没用 pepper；不一致只会导致两边桶名不同、限流语义漂移，不会报错）。
2. **PDF 下载令牌的 HMAC 密钥**（M5 引入）。这一条是**互操作**：
   Node 的 `verifyResumePdfDownloadToken`（`packages/api/src/features/resume/pdf-download-url.ts:52-54`）
   用 `createHmac("sha256", env.AUTH_SECRET)` 验签。Python 侧签错 → Node 返回
   **401** → Python 翻成 **502**，并从现象上完全看不出是密钥配错了。
3. **会话 cookie 的签名密钥**（M6 端到端验收时实测发现）。better-auth 1.7 起写进浏览器的
   cookie 是 `<session.token>.<base64(HMAC-SHA256(AUTH_SECRET, session.token))>`
   （标准 base64、**带** `=` 填充）。Python 侧 `app/identity.py` 剥掉签名段后还要**验签**，
   所以两边 `AUTH_SECRET` 不一致时，**所有需要登录的接口会一律 401** —— 而这个 401 和
   「没登录」长得一模一样。详见 `docs/acceptance.md` 第 4.1 节。

所以 M5 的 `app/render_proxy.py` 在拿到上游 401 时，会在报错里专门附一句
「先核对两边 AUTH_SECRET 是否一字不差」—— 就是为了把这类事故从「502」拉回「配置错了」。

判定方式（M6 可直接复用）：

```bash
cd apps/server
AUTH_SECRET=<同一个值> node --import tsx \
  ../../services/resume-api/tools/verify_pdf_token_parity.mjs --make <resumeId> <userId> 600
# 把打出来的令牌交给 Python：
#   verify_resume_pdf_download_token(token, resumeId) is not None
```

反向（Python 签 → Node 验）已经固化成 pytest 用例
`tests/test_pdf_token.py::test_node_accepts_python_signed_token`，本机有 Node 与
`apps/server/node_modules` 时会自动跑，否则 skip。

### 2.2 `DATABASE_URL` —— 同一个库，但**格式**不完全一样

* Node：`postgresql://...`（Drizzle / node-postgres）。
* Python：`postgresql+psycopg://...`（SQLAlchemy 要带 driver 段）。
* Python 侧 `Settings.__post_init__` 会校验前缀必须是 `postgresql` / `postgres`，
  明确**不支持 SQLite**（用 SQLite 会掩盖类型与 SQL 差异）。

两边指向的必须是**同一个物理库**：Python 认人靠 `session JOIN "user"`，Node 写会话。

## 3. 最容易被误伤的一项：`PORT`

这是本轮发现的**同名不同义**陷阱，M6 要特别小心：

* Python：`app/config.py` 读 `PORT`，默认 **4000**，给 uvicorn 用。
* Node：`apps/server/src/index.ts:22`

  ```ts
  const port = process.env.NODE_ENV === "production"
      ? Number.parseInt(process.env.PORT ?? "3000", 10)
      : env.SERVER_PORT;           // 默认 3001，仓库 .env 里也是 3001
  ```

  即 **dev 下 Node 根本不读 `PORT`**，读的是 `SERVER_PORT`（3001）；只有
  `NODE_ENV=production` 才读 `PORT`（默认 3000）。

结论：**`PORT` 两边不但不必一致，还必须不一致**（它们是两个不同进程的监听端口，撞了会
直接 `EADDRINUSE`）。要对齐的不是它的值，而是「别把它当成可共享的配置」这件事。

## 4. Python 侧独有、Node 没有的项

| 变量 | 为什么是 Python 独有 |
| --- | --- |
| `NODE_RENDER_BASE_URL` | Node 自己就是渲染方，不需要知道自己的地址。Python 要转发，所以得知道 Node 在哪。默认 `http://127.0.0.1:3000` —— 注意与 `SERVER_PORT` 的 3001 **不一致**（见 §3），部署时要按实际 Node 端口显式设。 |
| `NODE_RENDER_TIMEOUT_SECONDS` | 同上，Python 独有。默认 120 秒：实测 Node **冷启动首次渲染要 58 秒**（要拉 CJK 字体），60 秒会刚好卡在边缘上。 |
| `RESUME_API_TEST_DATABASE_URL` | 仅 pytest 用，用来把测试指向临时库，避免误写生产库。 |

## 5. M6 的验收建议

1. `AUTH_SECRET`：跑 §2.1 那条互签校验，**双向都要过**（Python 签 Node 验 + Node 签 Python 验）。
   只验单向不够 —— 单向只能证明算法对称，证明不了配置一致。
2. `DATABASE_URL`：两边指向同一个库（Python 用 `postgresql+psycopg://`，Node 用 `postgresql://`）。
3. `PORT`：**确认两边值不同**，且 Node 在 dev 下实际监听的是 `SERVER_PORT`。
4. `NODE_RENDER_BASE_URL`：指向真在跑的 Node，且端口与 Node 实际监听端口一致。
5. 剩下那些 Node 有、Python 没有的（`SERVER_PORT`、`S3_*`、`FLAG_*`、`SMTP_*`、AI/短信密钥……）
   属于「尚未迁移的能力」，本轮**不需要**在 Python 侧存在，M6 不要为了「对齐」而凭空新增。
