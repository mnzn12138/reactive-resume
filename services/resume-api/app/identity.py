"""M3 · Python 侧取身份。

核心事实（已核实）
------------------
* `session.token` 是**明文** text 列（`packages/db/src/schema/auth.ts`），并且项目没有开启
  better-auth 的 cookieCache —— 所以浏览器 cookie 的值**就是** `session.token`。
* cookie 名：`better-auth.session_token`。
* 因此认人只需要一条查询：

      SELECT "user".id
      FROM session
      JOIN "user" ON "user".id = session.user_id
      WHERE session.token = :token AND session.expires_at > now()

* 不需要（也不应该）改前端的 `authClient.getSession()`：它直连 Node 的 `/api/auth/get-session`，
  改了会让会话续期退化成 7 天硬过期。

用法（M4 起）：

    from app.identity import get_current_user_id

    @router.get("/resumes")
    def list_resumes(user_id: str = Depends(get_current_user_id)) -> ...:
        ...
"""

from __future__ import annotations

from fastapi import Cookie, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import Session as SessionRow
from app.db.models import User
from app.db.session import get_db

#: better-auth 写入浏览器的会话 cookie 名（没开 cookieCache，值即 session.token）。
SESSION_COOKIE_NAME = "better-auth.session_token"

_UNAUTHORIZED_DETAIL = "Not authenticated"


def resolve_user_id(db: Session, token: str | None) -> str | None:
    """把 cookie 里的 token 解析成 user id。

    Args:
        db: 数据库 Session。
        token: cookie `better-auth.session_token` 的值，可能为 None 或空串。

    Returns:
        命中的 user id；token 缺失、不存在或已过期时返回 None。
    """
    if not token:
        return None

    statement = (
        select(SessionRow.user_id)
        .join(User, User.id == SessionRow.user_id)
        .where(SessionRow.token == token, SessionRow.expires_at > func.now())
        .limit(1)
    )
    return db.execute(statement).scalar_one_or_none()


def get_current_user_id(
    db: Session = Depends(get_db),
    session_token: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
) -> str:
    """FastAPI 依赖：取当前登录用户的 id，失败直接抛 401。

    Args:
        db: 由 `get_db` 注入的数据库 Session。
        session_token: 从 cookie `better-auth.session_token` 读取的 token。

    Returns:
        当前登录用户的 id。

    Raises:
        HTTPException: 401 —— 无 cookie、token 不存在（伪造）或已过期。
    """
    user_id = resolve_user_id(db, session_token)
    if user_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_UNAUTHORIZED_DETAIL)
    return user_id


def get_current_user(
    db: Session = Depends(get_db),
    session_token: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
) -> User:
    """FastAPI 依赖：取当前登录用户的完整记录，失败直接抛 401。

    Args:
        db: 由 `get_db` 注入的数据库 Session。
        session_token: 从 cookie `better-auth.session_token` 读取的 token。

    Returns:
        当前登录的 `User` 行。

    Raises:
        HTTPException: 401 —— 无 cookie、token 不存在（伪造）或已过期。
    """
    user_id = resolve_user_id(db, session_token)
    if user_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_UNAUTHORIZED_DETAIL)

    user = db.get(User, user_id)
    if user is None:
        # session 存在但 user 被删掉了（理论上有 FK cascade 兜底，这里再兜一层）。
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_UNAUTHORIZED_DETAIL)
    return user
