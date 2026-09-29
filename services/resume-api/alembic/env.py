"""Alembic 环境配置。

`DATABASE_URL` 从环境变量读取（见 app/config.py），覆盖 alembic.ini 里的占位值。
"""

from __future__ import annotations

import sys
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy import engine_from_config, pool

# 让 `app` 包可被 import（无论 alembic 从哪个 cwd 被调用）。
SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.config import get_settings  # noqa: E402
from app.db.base import Base  # noqa: E402

config = context.config

# DATABASE_URL 优先于 alembic.ini 里的 sqlalchemy.url 占位值。
config.set_main_option("sqlalchemy.url", get_settings().database_url)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# 只声明 Python 侧真正用到的表（见 app/db/models.py）。
target_metadata = Base.metadata


def include_object(object_: object, name: str, type_: str, reflected: bool, compare_to: object) -> bool:
    """限制 autogenerate 的比较范围。

    库里还有一批 Drizzle 时代的表（oauth_* / agent_* / application / sms_* 等）没有
    对应的 Python 模型。若不做这个过滤，`alembic revision --autogenerate` 会生成一大堆
    `DROP TABLE`，非常危险。这里只允许比较 Base.metadata 中声明过的表。
    """
    if type_ == "table":
        return name in Base.metadata.tables
    return True


def run_migrations_offline() -> None:
    """离线模式：只生成 SQL，不连库。"""
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        include_object=include_object,
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """在线模式：连库执行迁移。"""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            include_object=include_object,
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
