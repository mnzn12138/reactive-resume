"""M5 · 简历访问判定（owner 隔离 + 公开页授权）。

为什么从 `app/routers/resume.py` 里抽出来
----------------------------------------
M5 的公开 PDF 出口（`GET /resumes/{username}/{slug}/pdf`）必须走和 `getResumeBySlug`
**完全相同**的可见性与密码判定。复制一份等于养出两条会各自漂移的授权路径 —— 这种代码
里「少判一次密码」是不会立刻报错的，只会在某天变成一次数据泄露，所以收敛成一处。

三条判定（与 Node `access-policy.ts` / `access.ts` 对齐）
-------------------------------------------------------
1. 私有简历只对 owner 可见，对陌生人一律 404（**不是** 403）—— 不泄露「它存在」；
2. 设了密码且访客没通过验证 → 401 `NEED_PASSWORD`；
3. owner 自看不受上面两条限制。
"""

from __future__ import annotations

import hashlib
import hmac

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import errors
from app.db.models import Resume, User
from app.identity import resolve_user_id

#: 公开简历访问 cookie 的前缀，与 Node `packages/api/src/features/resume/access.ts` 一致。
RESUME_ACCESS_COOKIE_PREFIX = "resume_access"


def has_resume_access(request: Request, resume_id: str, password_hash: str | None) -> bool:
    """访客是否已经通过密码验证（照 Node `access.ts` 的 `hasResumeAccess`）。

    Args:
        request: 当前请求，用来读 `resume_access_<id>` cookie。
        resume_id: 简历 id。
        password_hash: 库里存的密码哈希，没设密码时为 None。

    Returns:
        已通过验证返回 True，否则 False。
    """
    if not password_hash:
        return False

    cookie_value = request.cookies.get(f"{RESUME_ACCESS_COOKIE_PREFIX}_{resume_id}")
    if not cookie_value:
        return False

    expected = hashlib.sha256(f"{resume_id}:{password_hash}".encode("utf-8")).hexdigest()
    return hmac.compare_digest(cookie_value, expected)


def load_owned_resume(
    db: Session, resume_id: str, user_id: str, *, for_update: bool = False
) -> Resume:
    """取「当前用户名下」的简历，取不到就 404。

    Args:
        db: 数据库 Session。
        resume_id: 路径上的简历 id。
        user_id: 当前登录用户 id。
        for_update: 是否 `SELECT ... FOR UPDATE`（写操作用，与 Node 一样在事务里锁行）。

    Returns:
        命中的 `Resume` 行。

    Raises:
        OrpcError: 404 —— 不存在，或不属于当前用户。
    """
    statement = select(Resume).where(Resume.id == resume_id, Resume.user_id == user_id)
    if for_update:
        statement = statement.with_for_update()

    resume = db.execute(statement).scalar_one_or_none()
    if resume is None:
        raise errors.resume_not_found()
    return resume


def open_public_resume(
    db: Session,
    request: Request,
    *,
    username: str,
    slug: str,
    session_token: str | None,
) -> tuple[Resume, bool]:
    """按 username + slug 打开一份公开简历，并把授权判完。

    Args:
        db: 数据库 Session。
        request: 原始请求（读 `resume_access_<id>` cookie）。
        username: 简历所有者的用户名。
        slug: 简历 slug。
        session_token: cookie `better-auth.session_token`；公开页**不强制**，
            有就拿来认人（owner 因此能看自己的私有简历）。

    Returns:
        `(resume, viewer_is_owner)`。

    Raises:
        OrpcError: 404 不存在 / 不可见；401 需要密码。
    """
    statement = (
        select(Resume)
        .join(User, User.id == Resume.user_id)
        .where(Resume.slug == slug, User.username == username)
    )
    resume = db.execute(statement).scalar_one_or_none()
    if resume is None:
        raise errors.resume_not_found()

    current_user_id = resolve_user_id(db, session_token)
    viewer_is_owner = current_user_id is not None and current_user_id == resume.user_id

    # 非 owner 且简历不公开 —— 与「不存在」返回同一个 404。
    if not viewer_is_owner and not resume.is_public:
        raise errors.resume_not_found()

    if resume.password is not None and not has_resume_access(request, resume.id, resume.password):
        raise errors.need_password(username, slug)

    return resume, viewer_is_owner
