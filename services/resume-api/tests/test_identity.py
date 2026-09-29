"""M3「Python 取身份」的测试。

覆盖：有效 token / 过期 token / 无 cookie / 伪造 token，外加多用户隔离、级联删除与
`resolve_user_id` 的直连单元测试。全部直连本机 Postgres（`resume_api_test` 库）。
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy.orm import Session

from app.db.models import User
from app.identity import SESSION_COOKIE_NAME, resolve_user_id


def get_me(client: TestClient, token: str | None = None) -> Response:
    """打 `GET /me`，按需带上（或不带）会话 cookie。

    cookie 直接设在 client 上，而不是按请求传 —— 后者在 starlette 里已弃用。
    """
    client.cookies.clear()
    if token is not None:
        client.cookies.set(SESSION_COOKIE_NAME, token)
    return client.get("/me")


def test_valid_token_returns_user_id(client: TestClient, user_id: str, valid_token: str) -> None:
    """有效 token -> 200，且返回的 user id 与库里一致。"""
    response = get_me(client, valid_token)

    assert response.status_code == 200, response.text
    assert response.json() == {"userId": user_id}


def test_expired_token_returns_401(client: TestClient, user_id: str, expired_token: str) -> None:
    """已过期的 token -> 401（expires_at < now()）。"""
    response = get_me(client, expired_token)

    assert response.status_code == 401, response.text
    assert response.json()["detail"] == "Not authenticated"


def test_missing_cookie_returns_401(client: TestClient, user_id: str) -> None:
    """完全没有 cookie -> 401。"""
    response = get_me(client)

    assert response.status_code == 401, response.text


def test_forged_token_returns_401(client: TestClient, user_id: str) -> None:
    """库里不存在的伪造 token -> 401。"""
    forged = f"forged-{uuid4().hex}"

    response = get_me(client, forged)

    assert response.status_code == 401, response.text


def test_empty_cookie_value_returns_401(client: TestClient, user_id: str) -> None:
    """cookie 存在但值为空 -> 401（空串不能被当成有效 token）。"""
    response = get_me(client, "")

    assert response.status_code == 401, response.text


def test_token_resolves_to_its_own_user(
    client: TestClient,
    user_factory: Callable[..., User],
    session_factory: Callable[..., str],
    user_id: str,
) -> None:
    """两个用户各有一张有效会话时，token 必须解析到自己那一个，不能串号。"""
    other_user_id = user_factory().id
    other_token = session_factory(
        user_id=other_user_id, expires_at=datetime.now(timezone.utc) + timedelta(hours=2)
    )

    response = get_me(client, other_token)

    assert response.status_code == 200, response.text
    assert response.json() == {"userId": other_user_id}
    assert other_user_id != user_id


def test_token_stops_working_after_user_is_deleted(
    client: TestClient,
    db_session: Session,
    user_factory: Callable[..., User],
    session_factory: Callable[..., str],
    in_one_hour: datetime,
) -> None:
    """删掉 user 后，其 session 因 FK cascade 一并消失，token 立即失效 -> 401。

    这条同时验证 `session JOIN "user"` 的语义：不是只查 session 表就完事。
    """
    user = user_factory()
    token = session_factory(user_id=user.id, expires_at=in_one_hour)

    assert get_me(client, token).status_code == 200

    db_session.delete(user)
    db_session.commit()

    assert get_me(client, token).status_code == 401


def test_resolve_user_id_directly(
    db_session: Session,
    session_factory: Callable[..., str],
    user_factory: Callable[..., User],
    in_one_hour: datetime,
) -> None:
    """`resolve_user_id` 的直连单元测试：命中返回 id，不命中返回 None。"""
    user_id = user_factory().id
    token = session_factory(user_id=user_id, expires_at=in_one_hour)

    assert resolve_user_id(db_session, token) == user_id
    assert resolve_user_id(db_session, "no-such-token") is None
    assert resolve_user_id(db_session, "") is None
    assert resolve_user_id(db_session, None) is None
