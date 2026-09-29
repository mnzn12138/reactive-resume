# services/resume-api（Python 侧 · 迁移地基 M1~M3）

Reactive Resume 从 Node 迁到 Python 的**地基工程**。
本轮只做三件事：**M1 契约导出**、**M2 Alembic 基线 + SQLAlchemy 模型**、**M3 Python 取身份**。
简历 CRUD 路由（M4）与联调、部署（M5/M6）不在本轮。

> 定位：这次迁移**不是项目重心**（项目重心是国产化改造），只是课程要求的最小集。
> 范围只限「简历 CRUD + 公开简历页数据」，其余全部留在 Node。详见 `docs/contract-scope.md`。

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
│     └─ 0001_baseline.py         基线迁移（现有全部表）
├─ app/
│  ├─ config.py                   Settings（DATABASE_URL / AUTH_SECRET / PORT）
│  ├─ db/
│  │  ├─ base.py                  DeclarativeBase + 约束命名约定
│  │  ├─ models.py                User / Session / Resume / ResumeStatistics
│  │  └─ session.py               engine / SessionLocal / get_db 依赖
│  ├─ identity.py                 M3：cookie → user id（get_current_user_id）
│  └─ main.py                     FastAPI 入口（当前只有 /health）
├─ contract/
│  └─ resume-openapi.json         M1 切片产物（生成物，别手改）
├─ docs/
│  └─ contract-scope.md           哪些进 Python / 哪些留 Node
├─ tools/
│  └─ export_contract.mjs         M1 导出脚本
└─ tests/
   ├─ conftest.py                 测试库建库 + 跑迁移 + 夹具
   └─ test_identity.py            M3 的 8 个用例
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
| `AUTH_SECRET` | 空串 | **必须与 Node 侧 `.env` 一字不差**；它是手机号 / IP 的 HMAC pepper，两边不一致会导致限流失效 |
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
"$PY" -m alembic heads            # 期望输出：0001 (head)

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
* 在真要把它交给 Alembic 之前，需要先 `alembic stamp 0001` 打标记，否则下次
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

## 5. M3 · 跑 pytest

```bash
cd services/resume-api
export PATH="/usr/bin:/bin:$PATH"
"$PY" -m pytest -q
```

* **直连本机 Postgres**（不用 SQLite）。测试库 `resume_api_test` 不存在时会自动创建。
* 会话级夹具会先在测试库上跑一次 `alembic upgrade head`，等价于顺带验证基线迁移。
* 每个用例前后 `TRUNCATE` 相关表。
* 当前结果：**8 passed**。

## 6. 起服务

```bash
cd services/resume-api
export PATH="/usr/bin:/bin:$PATH"
"$PY" -m uvicorn app.main:app --host 127.0.0.1 --port 4000
# 或
"$PY" -m app.main
```

当前只挂了 `GET /health`（返回 `{"status": "ok"}`）；简历 CRUD 路由是 M4 的事。

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

用法（M4 起）：

```python
from fastapi import Depends
from app.identity import get_current_user_id

@router.get("/resumes")
def list_resumes(user_id: str = Depends(get_current_user_id)): ...
```
