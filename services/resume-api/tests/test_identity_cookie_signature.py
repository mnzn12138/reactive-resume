"""M6 · 会话 cookie 是**带签名**的 —— 这条是端到端验收实测发现的回归护栏。

为什么单开一个文件
------------------
M3 的 `tests/test_identity.py` 里，session 的 token 是 `uuid4().hex`，cookie 也设成同一个值。
两边同源，所以那批用例**永远绿** —— 它们证明不了「Node 真实签发的 cookie 能被认出来」。
M6 端到端验收时就是在这里翻的车：better-auth 1.7 起 cookie 实际是

    <session.token> "." base64(HMAC-SHA256(key = AUTH_SECRET, msg = session.token))

库里只存前半段。M3 那套「cookie 值 == session.token」的假设下，所有需要登录的接口一律 401。

所以这个文件的用例全部**照 better-auth 的真实形态**造 cookie，并且刻意不去复用
`test_identity.py` 的夹具思路（那正是漏掉它的原因）。

签名的编码是实测反推出来的：标准 base64（**带** `=` 填充），不是 base64url，也不是去填充的
变体 —— 这几种只差一两个字符，猜错了就全 401，所以钉死在这里。
"""

from __future__ import annotations

import base64
import hashlib
import hmac
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from urllib.parse import quote
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db.models import Session as SessionRow
from app.db.models import User
from app.identity import SESSION_COOKIE_NAME, resolve_user_id, split_signed_token


def sign_token(token: str, secret: str | None = None) -> str:
    """照 better-auth 的方式签一个 cookie 值。

    Args:
        token: `session.token`。
        secret: HMAC 密钥，默认取 Python 侧配置的 `AUTH_SECRET`。

    Returns:
        形如 `<token>.<base64(HMAC-SHA256)>` 的 cookie 值。
    """
    key = (secret if secret is not None else get_settings().auth_secret).encode("utf-8")
    digest = hmac.new(key, token.encode("utf-8"), hashlib.sha256).digest()
    return f"{token}.{base64.b64encode(digest).decode('ascii')}"


def test_split_signed_token_with_signature() -> None:
    """带签名的 cookie 拆出两段；签名段是标准 base64、带 `=` 填充。"""
    cookie = sign_token("abc123")

    token, signature = split_signed_token(cookie)

    assert token == "abc123"
    assert signature is not None
    assert signature.endswith("=") or len(signature) % 4 == 0


def test_split_signed_token_without_signature() -> None:
    """没有 `.` 的老形态：整串就是 token，签名段为 None。"""
    token, signature = split_signed_token(uuid4().hex)

    assert token and signature is None


def test_dotted_token_splits_at_the_last_dot(
    db_session: Session,
    user_factory: Callable[..., User],
    session_factory: Callable[..., str],
) -> None:
    """token 自己带 `.` 时要按**最后一个** `.` 切。

    better-call 的 `getSignedCookie` 用的是 `value.lastIndexOf(".")`。默认 `generateId` 只出
    `[a-zA-Z0-9]`，切第一个和切最后一个结果一样；但 better-auth 允许配自定义 `generateId`，
    一旦 token 里出现 `.`，按第一个切会把 token 拦腰截断 —— 表现又是满屏 401。
    """
    user = user_factory()
    token = session_factory(
        user_id=user.id,
        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
        token="ab.cd",
    )

    assert split_signed_token(sign_token(token)) == (token, sign_token(token).rsplit(".", 1)[1])
    assert resolve_user_id(db_session, sign_token(token)) == user.id


def test_signed_cookie_resolves_to_user(
    client: TestClient,
    db_session: Session,
    user_factory: Callable[..., User],
    session_factory: Callable[..., str],
) -> None:
    """**核心用例**：Node 形态的带签名 cookie 必须能认出人。

    只把裸 token 存进库、cookie 带签名 —— 这正是 M6 之前会 401 的场景。
    """
    user = user_factory()
    token = session_factory(
        user_id=user.id, expires_at=datetime.now(timezone.utc) + timedelta(days=1)
    )

    client.cookies.set(SESSION_COOKIE_NAME, sign_token(token))
    response = client.get("/me")

    assert response.status_code == 200, response.text
    assert response.json() == {"userId": user.id}


def test_url_encoded_signed_cookie_resolves_to_user(
    client: TestClient,
    db_session: Session,
    user_factory: Callable[..., User],
    session_factory: Callable[..., str],
) -> None:
    """浏览器回传的是 `Set-Cookie` 里那个**已编码**的串（`%2B` / `%3D`），一样要认得。"""
    user = user_factory()
    token = session_factory(
        user_id=user.id, expires_at=datetime.now(timezone.utc) + timedelta(days=1)
    )

    # safe="" 让 `+` `=` 都被编码，与 better-auth 写 Set-Cookie 的行为一致。
    client.cookies.set(SESSION_COOKIE_NAME, quote(sign_token(token), safe=""))
    response = client.get("/me")

    assert response.status_code == 200, response.text
    assert response.json() == {"userId": user.id}


def test_wrong_secret_signature_is_rejected(
    client: TestClient,
    db_session: Session,
    user_factory: Callable[..., User],
    session_factory: Callable[..., str],
) -> None:
    """用**别的** AUTH_SECRET 签出来的 cookie 不能认 —— 这是 AUTH_SECRET 不一致的表现。

    为什么要挡：签名本来就是拿 AUTH_SECRET 算的。放行等于「两边密钥配错了也能登录」，
    问题会推迟到 PDF 令牌验签失败（502）才暴露，那时候已经很难联想到是密钥配错了。
    """
    user = user_factory()
    token = session_factory(
        user_id=user.id, expires_at=datetime.now(timezone.utc) + timedelta(days=1)
    )

    client.cookies.set(SESSION_COOKIE_NAME, sign_token(token, secret="a-completely-different-secret"))
    response = client.get("/me")

    assert response.status_code == 401, response.text


def test_tampered_signature_is_rejected(
    client: TestClient,
    db_session: Session,
    user_factory: Callable[..., User],
    session_factory: Callable[..., str],
) -> None:
    """签名段被改过就不认（剥掉签名后拿到的 token 是对的，但签名不对）。"""
    user = user_factory()
    token = session_factory(
        user_id=user.id, expires_at=datetime.now(timezone.utc) + timedelta(days=1)
    )

    client.cookies.set(SESSION_COOKIE_NAME, f"{token}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")
    response = client.get("/me")

    assert response.status_code == 401, response.text


def test_expired_session_with_valid_signature_is_rejected(
    db_session: Session,
    user_factory: Callable[..., User],
) -> None:
    """签名对但会话已过期 —— 仍然认不出人（`expires_at > now()` 还要再过一道）。"""
    user = user_factory()
    expired = SessionRow(
        id=uuid4().hex,
        token=uuid4().hex,
        user_id=user.id,
        expires_at=datetime.now(timezone.utc) - timedelta(hours=1),
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    db_session.add(expired)
    db_session.commit()

    assert resolve_user_id(db_session, sign_token(expired.token)) is None
