# services/resume-api（Python 侧 · 迁移地基 M1~M4）

Reactive Resume 从 Node 迁到 Python 的**地基工程**。
本轮做四件事：**M1 契约导出**、**M2 Alembic 基线 + SQLAlchemy 模型**、**M3 Python 取身份**、
**M4 简历 CRUD 路由**。联调与部署（M5/M6）不在本轮。

> 定位：这次迁移**不是项目重心**（项目重心是国产化改造），只是课程要求的最小集。
> 范围只限「简历 CRUD + 公开简历页数据」，其余全部留在 Node。详见 `docs/contract-scope.md`。
>
> **M4 做完也不接管生产流量**：Node 侧仍是权威，Python 服务只是先跑通、能演示，
> M5/M6 才做联调与流量切换。所以 M4 **一行都没改 Node 侧**。

## 为什么放在 `services/` 而不是 `apps/` 或 `packages/`

仓库根 `pnpm-workspace.yaml` 的 `packages:` 包含 `apps/*`、`packages/*`、`tooling`。
Python 服务一旦放进 `apps/` 或 `packages/`，就会被 pnpm / turbo 当成 workspace 包处理
（会去找 `package.json`、被 turbo 任务图扫到）。`services/*` 两个 glob 都匹配不到，所以放这里。

---

## 目录结构

```
services/resume-api/
├─ README.md                      本文件
├─ requirements.txt               Python 依赖
├─ pytest.ini                     pytest 配置（pythonpath = .）
├─ alembic.ini                    Alembic 配置（ASCII-only，别写中文！见下）
├─ alembic/
│  ├─ env.py                      从 DATABASE_URL 读连接串
│  ├─ script.py.mako              迁移模板
│  ├─ baseline_schema.sql         pg_dump --schema-only 的原始 DDL 存档
│  └─ versions/
│     ├─ 0001_baseline.py         基线迁移（现有全部表）
│     └─ 0002_recruitment.py      校招岗位板三张表（别的任务建的，别动）
├─ app/
│  ├─ config.py                   Settings（DATABASE_URL / AUTH_SECRET / PORT）
│  ├─ defaults.py                 M4：新建简历的初始 data + locale 解析
│  ├─ errors.py                   M4：oRPC 形状的错误信封 + 异常处理器
│  ├─ identity.py                 M3：cookie → user id（get_current_user_id）
│  ├─ ids.py                      M4：UUIDv7 id 生成（与 Node generateId() 同形）
│  ├─ main.py                     FastAPI 入口（/health + /resumes）
│  ├─ patching.py                 M4：JSON Patch（RFC 6902），只作用于 data 子树
│  ├─ rate_limit.py               M4：进程内滑动窗口限流（对齐 resumeMutationRateLimit）
│  ├─ db/
│  │  ├─ base.py                  DeclarativeBase + 约束命名约定
│  │  ├─ models.py                User / Session / Resume / ResumeStatistics / Recruitment*
│  │  └─ session.py               engine / SessionLocal / get_db 依赖
│  ├─ routers/
│  │  └─ resume.py                M4：7 个简历 CRUD 路由
│  └─ schemas/
│     └─ resume.py                M4：Pydantic 请求 / 响应模型（形状照契约）
├─ contract/
│  └─ resume-openapi.json         M1 切片产物（生成物，别手改）
├─ docs/
│  └─ contract-scope.md           哪些进 Python / 哪些留 Node
├─ tools/
│  └─ export_contract.mjs         M1 导出脚本
└─ tests/
   ├─ conftest.py                 测试库建库 + 跑迁移 + 夹具
   ├─ test_identity.py            M3 的 8 个用例
   └─ test_resume_crud.py         M4 的 58 个用例
```

---

## 1. 建 venv 装依赖

用托管 Python，**不要污染全局 Python**：

```bash
export PATH="/usr/bin:/bin:$PATH"

C:/Users/22586/.workbuddy/binaries/python/versions/3.13.12/python.exe \
  -m venv C:/Users/22586/.workbuddy/binaries/python/envs/reactive-resume

# Windows 的 venv 是 Scripts/，不是 bin/
C:/Users/22586/.workbuddy/binaries/python/envs/reactive-resume/Scripts/python.exe \
  -m pip install -r requirements.txt
```

后续所有命令都用这个 venv 里的 python，下文记作 `$PY`：

```bash
PY="C:/Users/22586/.workbuddy/binaries/python/envs/reactive-resume/Scripts/python.exe"
```

## 2. 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql+psycopg://postgres:postgres@127.0.0.1:5432/postgres` | Postgres 连接串 |
| `AUTH_SECRET` | 空串 | **必须与 Node 侧 `.env` 一字不差**；它是手机号 / IP 的 HMAC pepper，M4 起兼作限流 key 的 pepper，两边不一致会导致限流失效 |
| `PORT` | `4000` | uvicorn 端口 |
| `RESUME_API_TEST_DATABASE_URL` | `postgresql+psycopg://postgres:postgres@127.0.0.1:5432/resume_api_test` | pytest 用的测试库 |

读取顺序：**进程环境变量 > 仓库根 `.env` > 本目录 `.env` > 代码默认值**
（dotenv 用 `override=False`）。不支持 SQLite —— 会掩盖类型和 SQL 差异。

> ⚠️ **连库一律用 `127.0.0.1`，不要用 `localhost`。**
> Docker 的 Postgres 只发布了 `127.0.0.1:5432`；`localhost` 会先解析到 IPv6 `::1`，
> libpq 在没设 `connect_timeout` 时会**一直挂住不报错**（实测每次连接白等约 5 秒）。

## 3. M1 · 导出契约

```bash
cd services/resume-api
export PATH="/usr/bin:/bin:$PATH"
node tools/export_contract.mjs
```

前提：Node dev server 在跑（`cd apps/server && pnpm dev`）。
脚本幂等，重跑产出同一份文件；stdout 会打印导出了哪些 operationId、忽略了哪些。
产出 `contract/resume-openapi.json`。

## 4. M2 · 跑 Alembic

```bash
cd services/resume-api
export PATH="/usr/bin:/bin:$PATH"

"$PY" -m alembic current          # 当前版本
"$PY" -m alembic heads            # 期望输出：0002 (head)

# 在新库 / 临时库上建表（**不要对正在使用的 postgres 库跑 upgrade**）
DATABASE_URL=postgresql+psycopg://postgres:postgres@127.0.0.1:5432/<临时库> \
  "$PY" -m alembic upgrade head
```

基线 `0001` 的内容 = `pg_dump --schema-only` 导出的**现有全部表**（28 张 public 表 +
`drizzle` schema）。落地后 **Drizzle 停更**，schema 演进由 Alembic 接管。

宿主没有 `pg_dump`，要重新导一次：

```bash
docker exec reactive_resume-postgres-1 pg_dump -U postgres --schema-only postgres \
  > services/resume-api/alembic/baseline_schema.sql
```

### 关于生产库（重要）

* 现在的 `postgres` 库**没有** `alembic_version` 表，`alembic current` 会显示为空（base）。
* 在真要把它交给 Alembic 之前，需要先 `alembic stamp 0002` 打标记，否则下次
  `upgrade head` 会试图重跑基线（表已存在，会报错）。
* 这一步**本轮不做**（要求不动正在使用的库）。

### 已知坑

* `alembic.ini` **必须保持纯 ASCII**：alembic 用平台默认编码（本机 cp936）读它，
  写中文注释会 `UnicodeDecodeError`。
* 基线 DDL 里已删掉 `SELECT pg_catalog.set_config('search_path', '', false);`：
  它会把会话级 `search_path` 清空，导致 alembic 之后 `INSERT INTO alembic_version`
  （非 schema 限定）找不到自己刚建的版本表。
* `env.py` 里的 `include_object` 会把 autogenerate 的比较范围限制在 `Base.metadata`
  声明过的表内，避免对没建模的 Drizzle 表生成一堆 `DROP TABLE`。
* M4 只新增了路由与 Pydantic 模型，**没动 `app/db/models.py`**，所以 `alembic check`
  的输出仍是 M2 遗留的那 24 条 drift（user / session / resume / resume_statistics 的
  索引与约束命名差异），既有的，不算 M4 引入的。

## 5. M3 · 跑 pytest

```bash
cd services/resume-api
export PATH="/usr/bin:/bin:$PATH"
"$PY" -m pytest -q
```

* **直连本机 Postgres**（不用 SQLite）。测试库 `resume_api_test` 不存在时会自动创建。
* 会话级夹具会先在测试库上跑一次 `alembic upgrade head`，等价于顺带验证基线迁移。
* 每个用例前后 `TRUNCATE` 相关表。
* 当前结果：**66 passed**（M3 的 8 个 identity 用例 + M4 的 58 个 CRUD 用例）。

## 6. M4 · 简历 CRUD

### 6.1 实现的是契约里的哪 7 个 operation

| operationId | 方法 + 路径 | 说明 |
| --- | --- | --- |
| `listResumes` | GET `/resumes` | 当前用户的简历列表（只有元数据，不含 data） |
| `createResume` | POST `/resumes` | 新建，返回新 id |
| `getResume` | GET `/resumes/{id}` | 按 id 取单份（含完整 data） |
| `updateResume` | PUT `/resumes/{id}` | 整体更新若干字段 |
| `patchResume` | PATCH `/resumes/{id}` | JSON Patch（RFC 6902）改 `data` |
| `deleteResume` | DELETE `/resumes/{id}` | 删除 |
| `getResumeBySlug` | GET `/resumes/{username}/{slug}` | 公开简历页数据（**无需登录**） |

响应形状的**唯一依据**是 `contract/resume-openapi.json`（M1 切出来的权威契约）：
`tests/test_resume_crud.py::test_response_shapes_match_contract` 会读契约 JSON，
与真实响应做**字段集合相等**的 diff —— 契约改了而代码没跟着改就会红。

### 6.2 守住的三条边界

* **Python 侧不实现任何鉴权写操作**：不发 cookie、不签 token、不刷新会话。
  只从 cookie 认人（复用 M3 的 `get_current_user_id`）。未认证 → 401。
  有专门一条用例断言响应里不出现 `Set-Cookie`。
* **owner 隔离**：`listResumes` 只返回当前用户的；`get` / `update` / `patch` / `delete`
  只能操作自己的简历，越权一律 **404（不是 403）**，与 Node 侧 `access-policy.ts` 一致，
  避免用状态码泄露「这份简历存在但不属于你」。
* **不接管渲染与存储**：`deleteResume` 只删库里的行，不动 SeaweedFS 上的截图 / PDF。

### 6.3 契约第 6 节三个缺口的处置结论

| 缺口 | 结论 | 为什么 |
| --- | --- | --- |
| `getResumeBySlug` 的 views 自增 | **做，但只写 `resume_statistics`**，best-effort（写失败只记日志，不影响响应） | 计数不是响应的一部分；`resume_statistics_daily` 属于统计聚合，按「统计留在 Node」不进最小集 |
| `resume_version` 快照 | **不写** | 版本快照不在 CRUD 最小集内，且建模了就要在 Alembic 侧同步，成本不划算 |
| `resume.updated` 事件 / SSE | **不实现** | Node 的 SSE 通道继续由 Node 提供 |

详见 `docs/contract-scope.md` 第 6 节。

### 6.4 限流

* 读 `app/config.py` 里已有的 `AUTH_SECRET`，与 Node 仓库根 `.env` **同名同值**，
  作为限流 key 的 HMAC pepper。
* **进程内**滑动窗口，**300 次 / 60 秒**，只作用于写操作（create / update / patch / delete）
  —— 与 Node `rateLimitConfig.orpc.resumeMutations` 逐项对齐。
* key 语义照 Node：`resume-mutation:{user_id}:id:{resume_id}`；create 时还没有 id，是 `no-id`。
* 单实例部署够用；将来多实例再换 Redis，接口不用动。

### 6.5 id 生成

Node 的 `generateId()`（`packages/utils/src/string.ts`）就是 `uuidv7()`。
`app/ids.py` 自己拼 128 bit（Python 3.13 标准库还没有 `uuid.uuid7()`），产出与 Node
完全同形的 36 字符小写 UUIDv7。不用 `uuid4()`：字符集和长度一样、URL 形态看不出差别，
但 UUIDv7 的前 48 bit 是毫秒时间戳，主键在索引上大致有序，换成 v4 会丢掉这层局部性。

### 6.6 patchResume 的作用域

`patchResume` 是 **JSON Patch（RFC 6902）**，不是 merge patch。patch 的文档根是
`resume.data` 本身（不是整条记录），所以 `/basics/name` 指 `data.basics.name`，
调用方**没法用 patch 改到 `name` / `slug` / `tags` / `isPublic` 这些列** —— 这就是
「只允许操作 `data` 子树」的落法，与 Node 侧 `applyResumePatches(data, operations)` 一致。

### 6.7 与 Node 侧不一致的地方（都是**故意**的）

| 项目 | Node | Python（M4） | 为什么 |
| --- | --- | --- | --- |
| 锁定的简历被改 / 删 | `RESUME_LOCKED` 没带 status，被 oRPC 兜成 **500** | **400** | 锁定是调用方的状态错误，不是服务端故障 |
| `createResume` 的 `withSampleData` | 生成 636 行示例简历 | **忽略**，一律写空文档 | 平移样例等于在 Python 侧再维护一份简历样例，超出最小集 |
| `getResumeBySlug` 的 views 去重 | 按客户端指纹做 1 小时去重 | **不去重**，每次访问 +1 | 去重属于统计策略，随「统计留在 Node」一起不进最小集 |
| `deleteResume` 的存储清理 | 删 SeaweedFS 上的截图 / PDF | **只删库里的行** | 存储归 Node 管 |
| `patchResume` / `updateResume` 的版本快照 | 写 `resume_version` | **不写** | 见 6.3 |
| `listResumes` 的 `tags` 传参 | oRPC OpenAPI 通道用 `tags[0]=a` | 裸重复键与 bracket 记法**都收** | M5 联调时按实际客户端再收敛成一种 |
| 简历 `data` 的结构校验 | 跑 `resumeDataSchema`（784 行） | **只校验是个 JSON 对象** | 平移整份 schema 超出最小集；结构仍由 Node 侧把关 |
| 限流开关 | 只在 `NODE_ENV=production` 生效 | **始终生效** | 单实例、300/min 足够宽松，没必要再挂开关 |
| 限流 pepper | `resumeMutationRateLimit` 实际没用 pepper（pepper 用在短信 / IP 限流） | **用了** `AUTH_SECRET` 做 pepper | 契约第 6 节要求；代价只是桶名不可预测，语义不变 |
| 401 / 404 的响应体 | oRPC 信封（`defined` / `code` / `status` / `message`） | 同样形状 | 契约只声明了 400 / 409；统一形状避免同一套 API 一会儿 `detail` 一会儿 `code` |

> Node 侧还有一处**文档与代码不一致**（不是我们引入的）：
> `packages/api/src/dto/resume.ts:42-44` 的注释说非 owner 视角下 `name` 会被脱敏成
> **空字符串**，但 `access-policy.ts:58` 实际写的是 `"Resume"`。我们照**代码**实现
> （`name = "Resume"`），与契约里 `name: {type: string}`（没有 `min(1)`）也对得上。

## 7. 起服务

```bash
cd services/resume-api
export PATH="/usr/bin:/bin:$PATH"
"$PY" -m uvicorn app.main:app --host 127.0.0.1 --port 4000
# 或
"$PY" -m app.main
```

M4 起挂了 `GET /health`（`{"status": "ok"}`）与 `/resumes` 下的 7 个 CRUD 路由。

端到端冒烟（起服务 → 带 cookie 走一遍 → 公开页无 cookie 取一次）：

```bash
curl -s http://127.0.0.1:4000/health
curl -s -H "Cookie: better-auth.session_token=<session.token>" http://127.0.0.1:4000/resumes
curl -s -H "Cookie: better-auth.session_token=<session.token>" \
     -H 'Content-Type: application/json' \
     -d '{"name":"冒烟简历","slug":"smoke-cv","tags":[]}' http://127.0.0.1:4000/resumes
curl -s http://127.0.0.1:4000/resumes/<username>/smoke-cv     # 公开页，无需 cookie
```

---

## M3 取身份是怎么工作的

* `session.token` 是**明文** text 列（`packages/db/src/schema/auth.ts`），且项目没开
  better-auth 的 cookieCache ⇒ **浏览器 cookie 的值就是 `session.token`**。
* cookie 名：`better-auth.session_token`。
* 认人只需一条查询：

  ```sql
  SELECT "user".id
  FROM session
  JOIN "user" ON "user".id = session.user_id
  WHERE session.token = :token AND session.expires_at > now();
  ```

* **不要改前端的 `authClient.getSession()`**：它直连 Node 的 `/api/auth/get-session`，
  改了会让会话续期退化成 7 天硬过期。

用法（M4 已经在用）：

```python
from fastapi import Depends
from app.identity import get_current_user_id

@router.get("/resumes")
def list_resumes(user_id: str = Depends(get_current_user_id)): ...
```

公开路径（`getResumeBySlug`）**不强制**登录，但也要能认出「是不是 owner」，所以用
`resolve_user_id()` 而不是 `get_current_user_id` —— 后者认不出人就直接 401 了。

## M4 的公开简历页是怎么工作的

照 Node `packages/api/src/features/resume/sharing.ts` 的 `getBySlug` 对齐了四件事：

1. 私有简历只对 owner 可见，对陌生人一律 **404**（与「不存在」同形，不泄露存在性）；
2. 设了访问密码且访客没通过验证 → **401 `NEED_PASSWORD`**。
   验证凭证是 `resume_access_<resume_id>` cookie，值 = `sha256("<resume_id>:<password_hash>")`，
   与 Node `packages/api/src/features/resume/access.ts` 逐字一致；
3. **owner 自看不计入 views**，否则作者每次预览都在给自己的统计灌水；
4. 非 owner 视角下 `name` 脱敏成 `"Resume"`、`data.metadata.notes` 清空 ——
   `data.basics.name`（简历上的人名）属于公开内容，照出。
