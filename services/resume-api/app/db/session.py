"""数据库引擎 / Session 工厂 / FastAPI 依赖。

引擎与 Session 工厂都是**惰性**创建的（`lru_cache`），这样 import 本模块不会绑定
DATABASE_URL，测试里可以先改环境变量再取连接。
"""

from __future__ import annotations

from collections.abc import Iterator
from functools import lru_cache

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import get_settings


@lru_cache(maxsize=1)
def get_engine() -> Engine:
    """创建（并缓存）SQLAlchemy 引擎。"""
    return create_engine(get_settings().database_url, pool_pre_ping=True, future=True)


@lru_cache(maxsize=1)
def get_session_factory() -> sessionmaker[Session]:
    """创建（并缓存）Session 工厂。"""
    return sessionmaker(
        bind=get_engine(),
        autoflush=False,
        autocommit=False,
        expire_on_commit=False,
        future=True,
    )


def get_db() -> Iterator[Session]:
    """FastAPI 依赖：每个请求一个 Session，请求结束即关闭。

    Yields:
        一个绑定到当前引擎的 `Session`。
    """
    db = get_session_factory()()
    try:
        yield db
    finally:
        db.close()


# 兼容直接 `from app.db.session import SessionLocal` 的用法。
SessionLocal = get_session_factory()
