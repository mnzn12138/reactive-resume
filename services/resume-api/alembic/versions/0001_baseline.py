"""0001 · 基线迁移 —— 把 Drizzle 时代已有的全部表结构固化下来。

背景
----
Reactive Resume 的 schema 原来由 Drizzle（`packages/db` + 仓库根 `migrations/`）管理。
本迁移用 `pg_dump --schema-only` 导出当前库的完整 DDL，作为 Alembic 的基线（revision 0001）。
落地之后 **Drizzle 停更**，schema 演进改由 Python 侧的 Alembic 接管。

DDL 来源
--------
`docker exec reactive_resume-postgres-1 pg_dump -U postgres --schema-only postgres`
原样存档在 `alembic/baseline_schema.sql`（本文件与它同目录层级，运行时按路径读取）。

注意
----
* 基线内容 = 现有**全部**表（28 张 public 表 + drizzle.__drizzle_migrations），
  而不是只迁简历相关的表 —— 这样 Alembic 才能在新库上完整复现现有结构。
* downgrade 直接 `DROP SCHEMA public CASCADE`，**只应在临时库 / 新库上执行**，
  千万不要在正在使用的库上跑。
"""

from __future__ import annotations

from pathlib import Path

from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | None = None
depends_on: str | None = None

# 与 0001_baseline.py 同级目录的上一级是 alembic/，baseline_schema.sql 就放在那里。
_BASELINE_SQL_PATH = Path(__file__).resolve().parents[1] / "baseline_schema.sql"

def downgrade() -> None:
    """回滚基线：删掉基线建出来的全部表 + `drizzle` schema。

    **保留 `alembic_version`** —— alembic 跑完 downgrade 之后还要从这张表里删自己的
    版本记录，一起删掉会让它报错。

    仅供临时库 / 新库验证使用。
    """
    bind = op.get_bind()
    result = bind.exec_driver_sql(
        "SELECT tablename FROM pg_tables "
        "WHERE schemaname = 'public' AND tablename <> 'alembic_version'"
    )
    for (table_name,) in result.fetchall():
        bind.exec_driver_sql(f'DROP TABLE IF EXISTS public."{table_name}" CASCADE')
    bind.exec_driver_sql("DROP SCHEMA IF EXISTS drizzle CASCADE")


def _load_baseline_sql() -> str:
    """读取基线 DDL。

    Returns:
        baseline_schema.sql 的全文。

    Raises:
        FileNotFoundError: 基线 SQL 文件不存在。
    """
    if not _BASELINE_SQL_PATH.is_file():
        raise FileNotFoundError(f"找不到基线 DDL 文件: {_BASELINE_SQL_PATH}")
    return _BASELINE_SQL_PATH.read_text(encoding="utf-8")


def _split_statements(sql: str) -> list[str]:
    """把 pg_dump 输出切成一条条可执行语句。

    pg_dump 生成的语句都以行尾的 `;` 结束，且没有存储过程 / 函数体（无 `$$` 包裹），
    所以按「行尾分号」切分是安全的。同时跳过空行、注释行和 psql 元命令（`\\restrict` 等）。

    Args:
        sql: pg_dump 输出全文。

    Returns:
        语句列表，顺序与原文一致。

    Raises:
        ValueError: 末尾存在没有分号结尾的残留语句。
    """
    statements: list[str] = []
    buffer: list[str] = []
    for raw_line in sql.splitlines():
        stripped = raw_line.strip()
        if not stripped or stripped.startswith("--") or stripped.startswith("\\"):
            continue
        buffer.append(raw_line)
        if stripped.endswith(";"):
            statements.append("\n".join(buffer).strip())
            buffer = []
    if buffer:
        raise ValueError(f"基线 DDL 存在未以分号结尾的语句: {buffer[0][:80]!r} ...")
    return statements


def upgrade() -> None:
    """在目标库上重建 Drizzle 时代的全部表结构。"""
    bind = op.get_bind()
    for statement in _split_statements(_load_baseline_sql()):
        bind.exec_driver_sql(statement)


def downgrade() -> None:
    """回滚基线：删掉基线建出来的全部表 + `drizzle` schema。

    **保留 `alembic_version`** —— alembic 跑完 downgrade 之后还要从这张表里删自己的
    版本记录，一起删掉会让它报错。

    仅供临时库 / 新库验证使用。
    """
    bind = op.get_bind()
    result = bind.exec_driver_sql(
        "SELECT tablename FROM pg_tables "
        "WHERE schemaname = 'public' AND tablename <> 'alembic_version'"
    )
    for (table_name,) in result.fetchall():
        bind.exec_driver_sql(f'DROP TABLE IF EXISTS public."{table_name}" CASCADE')
    bind.exec_driver_sql("DROP SCHEMA IF EXISTS drizzle CASCADE")
