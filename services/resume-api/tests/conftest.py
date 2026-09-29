"""pytest 公共夹具。

测试**直连本机 Postgres**（不用 SQLite —— 类型和 SQL 差异会掩盖问题），
库名默认 `resume_api_test`，可用 `RESUME_API_TEST_DATABASE_URL` 覆盖。

夹具会在测试库上跑一次 `alembic upgrade head`（顺带验证基线迁移可用），
每个用例前后 TRUNCATE 相关表，保证互相隔离。
"""

from __future__ import annotations

import os
from collections.abc import Callable, Iterator
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.orm import Session, sessionmaker

SERVICE_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_TEST_DATABASE_URL = "postgresql+psycopg://postgres:postgres@127.0.0.1:5432/resume_api_test"
TEST_DATABASE_URL = os.environ.get("RESUME_API_TEST_DATABASE_URL", DEFAULT_TEST_DATABASE_URL)

# 必须在 import app.* 之前设置：app.config 在 import 期就会读 DATABASE_URL。
# 这里强制指向测试库，避免任何误写生产库的可能。
os.environ["DATABASE_URL"] = TEST_DATABASE_URL
os.environ.setdefault("AUTH_SECRET", "test-auth-secret-do-not-use-in-prod")

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402

from app.db.session import get_db  # noqa: E402
from app.db.models import Session as SessionRow  # noqa: E402
from app.db.models import User  # noqa: E402
from app.identity import SESSION_COOKIE_NAME, get_current_user_id  # noqa: E402

#: 每个用例前后都要清空的表（有 FK，用 CASCADE 一把清）。
_TRUNCATE_TABLES = ("resume_statistics", "resume", "session", '"user"')


def _database_name(url: str) -> str:
    """从连接串里取库名。"""
    return url.rsplit("/", 1)[-1]


def _admin_url(url: str) -> str:
    """把连接串换成连到 `postgres` 库（用于 CREATE DATABASE）。"""
    return f"{url.rsplit('/', 1)[0]}/postgres"


def ensure_test_database() -> None:
    """测试库不存在就创建它（CREATE DATABASE 不能在事务里跑，所以用 AUTOCOMMIT）。"""
    name = _database_name(TEST_DATABASE_URL)
    engine = create_engine(_admin_url(TEST_DATABASE_URL), isolation_level="AUTOCOMMIT", future=True)
    try:
        with engine.connect() as connection:
            exists = connection.execute(
                text("SELECT 1 FROM pg_database WHERE datname = :name"), {"name": name}
            ).scalar()
            if not exists:
                connection.execute(text(f'CREATE DATABASE "{name}"'))
    finally:
        engine.dispose()


def run_migrations() -> None:
    """在测试库上跑 `alembic upgrade head`，等价于验证基线迁移。"""
    config = Config(str(SERVICE_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(SERVICE_ROOT / "alembic"))
    config.set_main_option("sqlalchemy.url", TEST_DATABASE_URL)
    command.upgrade(config, "head")


def _truncate(engine: Engine) -> None:
    """清空本轮用到的表。"""
    with engine.begin() as connection:
        connection.execute(text(f"TRUNCATE TABLE {', '.join(_TRUNCATE_TABLES)} CASCADE"))


@pytest.fixture(scope="session", autouse=True)
def migrated_database() -> Iterator[None]:
    """整场测试只跑一次：建库 + 基线迁移。"""
    ensure_test_database()
    run_migrations()
    yield


@pytest.fixture()
def engine(migrated_database: None) -> Iterator[Engine]:
    """每个用例一个引擎，前后各清一次表。"""
    test_engine = create_engine(TEST_DATABASE_URL, future=True)
    try:
        _truncate(test_engine)
        yield test_engine
    finally:
        _truncate(test_engine)
        test_engine.dispose()


@pytest.fixture()
def db_session(engine: Engine) -> Iterator[Session]:
    """每个用例一个 Session。"""
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)
    session = factory()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def client(db_session: Session) -> Iterator[TestClient]:
    """搭一个只挂 `GET /me` 的最小 FastAPI app，用来验证 `get_current_user_id`。

    为什么不用 `app.main.app`：identity 这 8 个用例只关心「cookie → user id」这一件事，
    挂上 M4 的简历路由反而把限流、鉴权边界混进来。CRUD 用例在 `test_resume_crud.py`
    里另建了一个挂在 `app.main.app` 上的客户端。
    """
    application = FastAPI(title="identity-test-app")
    application.dependency_overrides[get_db] = lambda: db_session

    @application.get("/me")
    def read_me(user_id: str = Depends(get_current_user_id)) -> dict[str, str]:
        return {"userId": user_id}

    with TestClient(application) as test_client:
        yield test_client
    application.dependency_overrides.clear()


@pytest.fixture()
def user_factory(db_session: Session) -> Callable[..., User]:
    """插入一个 user 行并返回它。"""

    def _make_user() -> User:
        suffix = uuid4().hex[:12]
        now = datetime.now(timezone.utc)
        user = User(
            id=uuid4().hex,
            name=f"测试用户 {suffix}",
            email=f"{suffix}@example.test",
            email_verified=False,
            username=f"user_{suffix}",
            display_username=f"user_{suffix}",
            two_factor_enabled=False,
            phone_number_verified=False,
            created_at=now,
            updated_at=now,
        )
        db_session.add(user)
        db_session.commit()
        return user

    return _make_user


@pytest.fixture()
def session_factory(db_session: Session) -> Callable[..., str]:
    """插入一个 session 行并返回它的 token。"""

    def _make_session(*, user_id: str, expires_at: datetime, token: str | None = None) -> str:
        now = datetime.now(timezone.utc)
        row = SessionRow(
            id=uuid4().hex,
            token=token or uuid4().hex,
            user_id=user_id,
            expires_at=expires_at,
            created_at=now,
            updated_at=now,
        )
        db_session.add(row)
        db_session.commit()
        return row.token

    return _make_session


@pytest.fixture()
def user_id(user_factory: Callable[..., User]) -> str:
    """一个已落库的 user id。"""
    return user_factory().id


@pytest.fixture()
def valid_token(
    session_factory: Callable[..., str], user_id: str
) -> str:
    """一张 1 天后才过期的会话 token。"""
    return session_factory(user_id=user_id, expires_at=datetime.now(timezone.utc) + timedelta(days=1))


@pytest.fixture()
def expired_token(
    session_factory: Callable[..., str], user_id: str
) -> str:
    """一张 1 小时前就已过期的会话 token。"""
    return session_factory(
        user_id=user_id, expires_at=datetime.now(timezone.utc) - timedelta(hours=1)
    )


@pytest.fixture()
def in_one_hour() -> datetime:
    """1 小时后的 UTC 时间，写用例时省得重复算。"""
    return datetime.now(timezone.utc) + timedelta(hours=1)
