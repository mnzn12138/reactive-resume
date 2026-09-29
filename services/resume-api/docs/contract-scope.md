# 契约范围：哪些接口进 Python，哪些留在 Node

> 本文对应迁移里程碑 **M1 · 契约导出**。
> 契约产物：`services/resume-api/contract/resume-openapi.json`（由脚本自动生成，**不要手改**）。

## 1. 迁移定位

这次 Node → Python 的迁移**不是项目重心**，只是为了满足课程要求而做的**最小集**。
项目重心是国产化改造。因此：

* **范围只限「简历 CRUD」+ 公开简历页数据**；
* 其它一切（导入解析、管理后台、applications、AI、MCP、统计、Agent、全部鉴权与渲染）**留在 Node**；
* 目标是「能跑通、可演示、代码清晰」，**不追求生产级完备**。

## 2. 契约来源与重跑方式

权威 spec 由运行中的 Node 服务导出：

```
GET http://localhost:3000/api/openapi/spec.json
```

* 实测返回 200，约 543 KB，OpenAPI 3.1.1，共 56 个 path。
* 注意：`GET /api/openapi` 裸路径是 **404**，**必须带 `/spec.json`**
  （见 `apps/server/src/openapi/handler.ts:26`）。
* Node 侧另有 `GET /schema.json`（简历数据的 JSON Schema），可能有用。

切片脚本（纯 Node ESM，无第三方依赖，幂等）：

```bash
cd services/resume-api
export PATH="/usr/bin:/bin:$PATH"
node tools/export_contract.mjs                       # 默认打 localhost:3000
node tools/export_contract.mjs --url <spec 地址>      # 或显式指定
```

脚本会：拉全量 spec → 按 operationId 白名单过滤 → 递归内联被引用的 `components.*`
→ 写 `contract/resume-openapi.json`，并在 stdout 打印「导出了哪些 / 忽略了哪些 / 内联了多少 schema」。
白名单里的 operationId 若在 spec 中找不到，脚本会**报错并以非零退出码退出**，不会静默通过。

> `contract/resume-openapi.json` 是**切片产物**，不是权威 spec。
> 权威 spec 始终以运行中的 Node 服务 `GET /api/openapi/spec.json` 为准。

## 3. 进 Python 的接口（7 个）

| operationId | 方法 | 路径 | 用途 |
| --- | --- | --- | --- |
| `listResumes` | GET | `/resumes` | 列出当前用户的全部简历（只返回元数据，不含完整 data） |
| `createResume` | POST | `/resumes` | 新建简历，返回新简历 id |
| `getResume` | GET | `/resumes/{id}` | 按 id 取单份简历（含完整 data） |
| `updateResume` | PUT | `/resumes/{id}` | 整体更新简历字段 |
| `patchResume` | PATCH | `/resumes/{id}` | 用 JSON Patch (RFC 6902) 局部更新 `data` |
| `deleteResume` | DELETE | `/resumes/{id}` | 删除简历 |
| `getResumeBySlug` | GET | `/resumes/{username}/{slug}` | 公开简历页数据（按 username + slug） |

实现入口：Node 侧现在的实现在 `packages/api/src/features/resume/crud.ts` 与
`packages/api/src/features/resume/sharing.ts`。Python 侧路由属于 **M4**，本轮不实现。

## 4. 留在 Node 的接口

按功能分组（下表只列代表性路径，实际共 64 个 operation 被忽略）：

| 分组 | 代表性路径 | 为什么留在 Node |
| --- | --- | --- |
| 导入解析 | `POST /resumes/import`、`POST /ai/parse-pdf`、`POST /ai/parse-docx` | 依赖 pdf/docx 解析与大模型链路，Python 侧不具备 |
| 简历附属能力 | `POST /resumes/{id}/lock`、`POST /resumes/{id}/duplicate`、`PUT\|DELETE /resumes/{id}/password`、`POST /resumes/{username}/{slug}/password/verify`、`GET /resumes/{id}/pdf`、`GET /resumes/{id}/updates`、`/resumes/{resumeId}/versions/*` | 不在「CRUD 最小集」内；涉及渲染、SSE、版本快照 |
| 统计 | `GET /resumes/{id}/statistics`、`GET /resumes/{id}/statistics/daily`、`GET /statistics*`、`POST /resumes/{username}/{slug}/statistics/download` | 明确约定「统计留在 Node」 |
| 简历标签（聚合） | `GET /resumes/tags` | 聚合查询，不属于 CRUD 核心 |
| applications | `GET\|POST\|PUT\|DELETE /applications*`、`POST /applications/import` | 完全不在迁移范围 |
| AI | `POST /ai/chat`、`POST /ai/ats-review`、`POST /applications/{id}/ai/*` | 依赖大模型网关 |
| MCP | MCP server 暴露的同一批工具 | 走 Node 的 MCP 实现 |
| Agent | `/agent/threads*`、`/agent/messages/*`、`/agent/actions/*`、`/agent/attachments/*` | 依赖 SSE 流式与存储 |
| 全部鉴权 | `/auth/*`（Better Auth）、`GET /auth/providers`、`GET\|DELETE /auth/account` | 会话生命周期仍由 Node 的 Better Auth 负责；Python 只**读** `session` 表认人（见 M3） |
| 管理后台 | `admin_audit_log` 等相关接口 | 不在范围 |
| 其它 | `GET /api/health`、`GET /flags`、`POST /resume/getRoot` | 与简历 CRUD 无关 |

## 5. 契约对 Python 侧的含义

* Python 侧**不实现任何鉴权写操作**：不发 cookie、不签发 token、不刷新会话。
  只从 cookie `better-auth.session_token` 读 token，再 `session JOIN "user"` 认人（M3）。
* Python 侧不接管渲染（PDF / 图片 / 字体），不接管存储。
* Python 侧需要的数据库表只有 `resume`、`user`、`session`（+ `resume_statistics`，见 M2 说明）。

## 6. M4 的处置结论（原「已知缺口」，已全部裁决）

> 本节原来留给 M4 的三个缺口**都已裁决并实现**，不再有未决项。
> 实现落在 `app/routers/resume.py`，逐项的「为什么」写在 `README.md` 第 6 节。

### 6.1 `getResumeBySlug` 的 views 自增 —— 做，但只写 `resume_statistics`

**做自增，只写 `resume_statistics`，best-effort**（写失败只记日志，不影响响应）。
**不建模 `resume_statistics_daily`** —— 「统计」整体明确约定留在 Node（见第 4 节），
daily 表属于统计聚合，不进最小集。

对齐 Node 的两条语义（`packages/api/src/features/resume/service.ts` 的 `getBySlug`）：

* **owner 自看不计入**（`shouldCountForStatistics`），否则作者每次预览都在给自己的统计灌水；
* 计数失败不能让访客看不到简历，所以自增放在响应构造之后、且失败只记日志。

**与 Node 的差异（刻意）**：Node 还会按客户端指纹（可信代理 IP → UA + 语言）做 1 小时
去重（`features/resume/view-dedup.ts`）。Python 侧**不去重**，每次访问 +1 —— 去重属于
统计策略，随「统计留在 Node」一起不进最小集。

### 6.2 `resume_version` 快照 —— 不保留

`createResume` / `updateResume` 在 Python 侧**不写**版本快照。

理由：版本快照不在「CRUD 最小集」内，且建模了就要在 Alembic 侧同步（与校招岗位板那次一样
要双 ORM），成本不划算。版本历史的读写接口（`/resumes/{resumeId}/versions/*`）本来就在 Node。

### 6.3 `resume.updated` 事件通知 / SSE —— 不实现

Node 的 SSE 通道（`GET /resumes/{id}/updates`）继续由 Node 提供，Python 侧不发事件。

### 6.4 限流（`resumeMutationRateLimit`）—— 进程内滑动窗口 + `AUTH_SECRET` pepper

* Python 侧读 `app/config.py` 的 `AUTH_SECRET`，与 Node 仓库根 `.env` **同名同值**，
  作为限流 key 的 HMAC pepper。两边不一致会导致桶名不同、限流语义漂移。
* 实现成**进程内**滑动窗口（单实例部署，不需要分布式）：**300 次 / 60 秒**，
  key 语义与 Node 对齐（`resume-mutation:{user_id}:id:{resume_id}`，create 时是 `no-id`），
  **只作用于写操作**（create / update / patch / delete）。
* 阈值取自 Node `packages/utils/src/rate-limit.ts` 的 `rateLimitConfig.orpc.resumeMutations`。

> 两处与 Node 的**刻意**差异，都记在 `README.md` 第 6.7 节：
> Node 只在 `NODE_ENV=production` 启用限流（Python 侧始终启用）；
> Node 的 `resumeMutationRateLimit` 实际没用 pepper（pepper 用在短信 / IP 限流），
> Python 侧照本节要求把 pepper 加上，代价只是桶名不可预测，限流语义不变。

### 6.5 M4 新增的两条刻意简化

* `createResume` 的 `withSampleData`：**忽略**，一律写空文档。Node 会生成一份 636 行的
  示例简历（`packages/schema/src/resume/sample.ts`），平移它等于在 Python 侧再维护一份
  简历样例。M5 联调时若前端确实依赖，再决定平移或继续走 Node。
* `resume.data` 的结构校验：Node 会跑 `resumeDataSchema`（`packages/schema/src/resume/data.ts`，
  784 行）；Python 侧**只校验「是个 JSON 对象」**，内部结构仍由 Node 侧把关。
