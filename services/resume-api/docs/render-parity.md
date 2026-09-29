# M5 · PDF / DOCX 联调

> 本文记录 M5 做了什么、**验证到了哪一步**、以及**故意没做什么**。
> 交接时请先读第 5 节「故意简化 / 没做到」。

## 1. 定位与结论

总纲定死了两条：

* **渲染仍调 Node 内部端点，`packages/pdf` 一行不改**；
* Python 侧**不接管渲染**，也不接管存储。

所以 M5 的产物不是一个渲染器，而是一个**出口**：认人 → 判权 → 自签令牌 → 转发 → 把字节带回来。
`packages/pdf` 与 `apps/server` 本轮**零改动**（有一个 Node 侧既有问题，见 §4.2，我没动它）。

**结论：路走得通。** Python 侧能用同一个 `AUTH_SECRET` 自己签出 Node 认的令牌，实测拿到了
真实的 PDF 字节。详细证据见 §4。

## 2. 新增的两个出口

| operationId | 方法 + 路径 | 转发目标 | 判权 |
| --- | --- | --- | --- |
| `downloadResumePdf` | `GET /resumes/{id}/pdf` | `GET {NODE}/api/resumes/{id}/pdf?token=<自签>` | `get_current_user_id` + owner 隔离 |
| `downloadPublicResumePdf` | `GET /resumes/{username}/{slug}/pdf` | `GET {NODE}/api/resumes/{username}/{slug}/pdf` | 与 `getResumeBySlug` **同一套**判定 |

实现落在 `app/routers/pdf.py`；令牌签名在 `app/pdf_token.py`；转发在 `app/render_proxy.py`。

### 2.1 为什么 Python 必须能自己签令牌

Node 的 `handleResumePdfDownload`（`apps/server/src/http/resume-pdf.ts:29`）第一件事就是
`if (!token) return unauthorizedResponse()`。而它的签名只依赖 `AUTH_SECRET`：

```
payload = base64url(JSON.stringify({ v, resumeId, userId, expiresAt, issuedAt }))
token   = `${payload}.${HMAC-SHA256(key = AUTH_SECRET, msg = payload) 的 base64url}`
```

没有任何「只有前端 / 只有 Node 进程知道」的上下文，所以自签是可行的。

**为什么不去 Node 换一个令牌**：Node 侧**没有**签发下载令牌的 HTTP 端点 ——
`createResumePdfDownloadUrl` 只在 MCP 工具里被内部调用（`packages/mcp/src/tools.ts:170`）。
要换令牌就得给 Node 加接口，撞上「Node 侧一行不改」。自签是唯一不动 Node 的路。

### 2.2 与 Node 的逐字节对齐点

改任一条都会让两边令牌对不上，所以全部钉了用例：

* `base64url` **不带** `=` 填充（Node `Buffer.toString("base64url")` 的行为，
  Python 的 `urlsafe_b64encode` 默认会给，模块里专门 `rstrip("=")`）；
* payload 的 JSON 是紧凑格式，键顺序 `v / resumeId / userId / expiresAt / issuedAt`；
* 非 ASCII **不**转义（`JSON.stringify` 不转义，所以 Python 侧 `ensure_ascii=False`）；
* 时间戳是**毫秒** epoch；
* TTL 夹取规则一致（`[1, 600]` 秒）。

### 2.3 公开路径必须转发原始 `Cookie`

Node 的 `createPublicResumePdf`（`public-pdf.ts:69-78`）会**再判一次**可见性与密码。
Python 侧虽然已经判过，但 Node 是独立判的 —— 不把 `resume_access_<id>` cookie 带过去，
带密码的公开简历就会在 Node 侧被 401 挡回，表现为「公开 PDF 偶尔 401」。
这条专门有用例钉住（`test_download_public_resume_pdf_forwards_cookies_to_node`）。

## 3. `data` 结构校验：**不补**（已知边界）

### 3.1 结论

**维持现状：Python 侧不校验 `resume.data` 的内部结构，该校验仍由 Node 负责。**
这是一条明确的边界，不是遗漏。

### 3.2 评估过程

已知弱点：M4 的 Pydantic 对 `data` 只校验「是个 JSON 对象」，而 Node 会跑
`resumeDataSchema`（`packages/schema/src/resume/data.ts`，784 行）。

* **完整平移 784 行 zod → Pydantic**：远超「最小集」预算，而且会在 Python 侧养出第二份
  简历 schema —— 将来 Node 改一次字段定义就要两边同步，是最典型的双份真相。不做。
* **契约里其实已经有完整 schema**：`contract/resume-openapi.json` 有 681 KB，
  因为 M1 的切片脚本把 `resume.data` 的 JSON Schema **完整内联**了。也就是说，
  「补校验」的素材是现成的，加一个 `jsonschema` 依赖就能做严格校验。
* **但那会把校验变成运行时职责**，牵出一串新问题：写入时校验还是读取时校验？
  失败算 400 还是 422？那 784 行里的 `refine` / `transform` 有几个是 JSON Schema 表达不了的
  （表达不了就意味着「Python 校验通过但 Node 渲染失败」依然会发生，等于花了成本却没消除风险）？

所以：**不补运行时校验**，但把「形状对不对」这件事做成**测试**（§4.3），成本几乎为零，
且失败时是在 CI 里红，不是在生产里炸。

### 3.3 边界的代价

`updateResume` / `patchResume` 写入一个结构非法的 `data`，Python 侧会**照单全收**，
直到 PDF 渲染时才在 Node 侧炸成 502。这是已知且接受的：

* 生产流量的写操作目前仍走 Node（Node 是权威），Python 侧不接管生产流量；
* 前端编辑器产出的 `data` 本来就是 Node schema 校验过的。

## 4. 验证结论

### 4.1 真实联调（本机，2026-09-29）

起 Node（`apps/server`，端口 3000）+ Python（uvicorn，端口 4000），两边指向同一个 Postgres。

| # | 场景 | 结果 |
| --- | --- | --- |
| A | Python 签的令牌直接打 Node `/api/resumes/{id}/pdf?token=` | **200**，`%PDF-`，1786 字节，`Content-Type: application/pdf` |
| B | Python 出口 `GET /resumes/{id}/pdf`（带会话 cookie） | **200**，`%PDF-`，1786 字节，`Content-Disposition: attachment; filename="double-blue-dragon.pdf"` |
| C | Python 出口 `GET /resumes/{username}/{slug}/pdf` | **200**，`%PDF-`，1786 字节，`Content-Disposition: inline; filename="resume.pdf"` |
| D | 匿名访问私有出口 | **401** `UNAUTHORIZED`，且不触发任何上游渲染 |
| E | 不存在的 id | **404** `NOT_FOUND` |
| F | Node 侧渲染失败（500） | Python 翻成 **502** `PDF_RENDER_FAILED`，message 里带上上游状态码 |

B 的实测耗时 **58.3 秒**（冷启动首次渲染要拉 CJK 字体，热身后约 1 秒），这也是
`NODE_RENDER_TIMEOUT_SECONDS` 默认值从 60 提到 **120** 的原因。

### 4.2 一个 Node 侧的既有问题（我没修）

`packages/pdf/tsconfig.json` 是 `"jsx": "preserve"`，而 `apps/server/tsconfig.json` 是
`"jsx": "react-jsx"`。用 `pnpm dev`（`node --import tsx`）起 Node 时，tsx 按**文件所在目录**
的 tsconfig 做转译，于是 `packages/pdf/src/document.tsx` 里的 JSX 被编成
`React.createElement(...)`，而该文件并没有 `import React`：

```
ReferenceError: React is not defined
    at ResumeDocument (packages/pdf/src/document.tsx:60:2)
```

表现为 **任何 PDF 渲染在 dev 模式下都 500**。这不是我引入的，也不在允许我改的范围里
（`packages/pdf` 一行不改）。

本机验证时的绕法（**未进仓库，未改任何 Node 文件**）：额外 `--import` 一个把 React 挂成
全局的 shim：

```bash
node --import tsx --import <react-global-shim.mjs> src/index.ts
```

`tsdown` 打包产物是另一条路（bundler 自己决定 JSX 配置），本轮没走通：
`apps/server` 的 build 把大部分依赖 externalize 了，产物 `dist/index.mjs` 只有 ~1 KB。

**建议**：由负责 Node 侧的同学决定是改 `packages/pdf/tsconfig.json` 的 `jsx`、
还是给 dev runner 加 JSX 配置。在那之前，「用 `pnpm dev` 演示 PDF 下载」会失败。

### 4.3 数据形状的逐字段 diff（结论：**一致**）

用例在 `tests/test_render_contract.py`。权威形状不是手抄 Node 的 zod，而是直接读
`contract/resume-openapi.json` 里**内联**的 `resume.data` JSON Schema（§3.2）。

| 检查 | 结论 |
| --- | --- |
| `getResume` 顶层字段集合 vs 契约 | **集合相等**（10 个字段，不多不少） |
| 种子 `data`（`createResumeData`）逐字段走 schema | **0 处 diff** |
| 三种 locale（`zh-CN` / `en-US` / `zh-TW`） | 均 **0 处 diff** |
| JSONB 往返保真 | `data` 逐字节等价；`sidebarWidth` / `fontSize` 等整数**仍是整数**（没被 JSONB 变成 35.0） |
| `patchResume` 之后 | 仍 **0 处 diff** |
| 反例（手写最小 `data`） | 确实被报出 diff —— 证明 walker 有牙齿，不是永远通过 |

也就是说：**Python 侧产出的 `data` 在形状上和 Node 声明的一致，喂给渲染链路不会因为形状问题炸**。
§4.1 的真机验证也印证了这一点：那份 `data` 就是 `create_resume_data("zh-CN")` 的产物，
Node 的 `parseStoredResumeData` + 真实渲染器都吃下去了并产出了 PDF。

### 4.4 pytest

**129 passed**（M3 的 8 个 + M4 的 58 个全部保持，M5 新增 63 个）。无回归、无 skip
（本机有 Node 与 `apps/server/node_modules`，互签那条会真跑）。

## 5. 故意简化 / 没做到（交接必读）

1. **DOCX 出口没有。** Node 侧**没有**服务端 DOCX 端点（`apps/server/src` 里只有 PDF），
   DOCX 走前端客户端渲染。所以本轮「PDF / DOCX 联调」实际只有 PDF 可联 —— 这不是偷懒，
   是没有可联的对象。
2. **`resume.data` 结构校验不补**（§3）。运行时写入非法 `data` 不会被拦，要到渲染时才炸。
3. **不发 `resume.updated` 事件、不写 `resume_version` 快照** —— 沿用 M4 的结论。
4. **不写 downloads 统计**：Node 的公开 PDF 路径本来就不自增下载数，Python 侧照做。
5. **不重复限流**：Node 的 `handleResumePdfDownload` 这条 HTTP 通道本身没挂
   `pdfExportRateLimit`（那只挂在 oRPC procedure 上），Python 侧也不加。
   公开侧的限流在 Node（`publicRenderRateLimiter`），Python 只把 429 翻上来。
6. **公开渲染限流的分桶会退化**：Python 转发时 Node 看到的对端是 Python 自己。
   已带 `X-Forwarded-For`，但 Node 的 `getTrustedClient` 是否采信它取决于其可信代理配置；
   不采信则所有公开渲染共用同一个限流桶。**未验证** Node 是否真的采信 XFF。
7. **路由顺序的已知取舍**：`GET /resumes/{id}/pdf` 与 `getResumeBySlug` 的
   `GET /resumes/{username}/{slug}` 都是「`/resumes` 后跟两段」，Starlette 按注册顺序取第一个
   匹配。为了让 PDF 出口不被当成 `slug="pdf"`，`pdf_router` **必须**挂在 `resume_router` 之前。
   代价：slug 恰好叫 `pdf` 的公开简历，其 `getResumeBySlug` 会被挡住。
   Node 侧没这个问题（它的 oRPC 路径整体挂在 `/api/rpc/*` 下）。
8. **`packages/pdf` 的 JSX 问题没修**（§4.2）—— 不在允许修改的范围。
9. **PDF 内容本身没有做视觉校验**，只验证「是 PDF 字节（`%PDF` 魔数）+ 头正确」。
   渲染出来长什么样不在本轮范围。
10. **没有做并发 / 大简历 / 超时重试的压测。** 冷启动 58 秒这个量级意味着生产上要配
    更长的网关超时，本轮只是把 Python 侧默认超时提到 120 秒。
