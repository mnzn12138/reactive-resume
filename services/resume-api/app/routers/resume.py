"""M4 · 简历 CRUD 的 7 个路由。

进 Python 的 operation（见 `docs/contract-scope.md` 第 3 节）：

===============  ==============================  ==========================================
operationId      方法 + 路径                      说明
===============  ==============================  ==========================================
listResumes      GET    /resumes                 当前用户的简历列表（只有元数据）
createResume     POST   /resumes                 新建，返回新 id
getResume        GET    /resumes/{id}            按 id 取单份（含 data）
updateResume     PUT    /resumes/{id}            整体更新若干字段
patchResume      PATCH  /resumes/{id}            JSON Patch (RFC 6902) 改 `data`
deleteResume     DELETE /resumes/{id}            删除
getResumeBySlug  GET    /resumes/{username}/{slug}  公开简历页数据
===============  ==============================  ==========================================

守住的三条边界（都是契约第 5 节 + Node 侧行为推出来的）：

* **Python 侧不碰鉴权写操作**：不发 cookie、不签 token、不刷新会话。认人一律复用
  M3 的 `get_current_user_id`（cookie `better-auth.session_token` → `session JOIN user`）。
* **owner 隔离**：所有非公开接口都在 SQL 的 `WHERE user_id = :current` 里做过滤，
  查不到就 404（**不是 403**）—— 与 Node `access-policy.ts` 的 `assertCanView` 一致，
  避免用状态码泄露「这份简历存在但不属于你」。
* **不接管渲染与存储**：`deleteResume` 只删库里的行，不动 SeaweedFS 上的截图 / PDF；
  该清理仍由 Node 侧负责。

按契约第 6 节拍板的三个缺口，处置结论（详见 `docs/contract-scope.md` 第 6 节）：

* views 自增照做，但**只写 `resume_statistics`**，best-effort（写失败不影响响应）；
  `resume_statistics_daily` 不建模。
* `resume_version` 快照**不写**。
* `resume.updated` 事件 / SSE **不发**。
"""

from __future__ import annotations

import copy
import hashlib
import hmac
import logging
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Cookie, Depends, Query, Request, status
from sqlalchemy import Text, cast, func, select
from sqlalchemy.dialects.postgresql import ARRAY as PG_ARRAY
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app import errors
from app.db.models import Resume, ResumeStatistics, User
from app.db.session import get_db
from app.defaults import LOCALE_COOKIE_NAME, create_resume_data, resolve_locale
from app.identity import SESSION_COOKIE_NAME, get_current_user_id, resolve_user_id
from app.ids import generate_id
from app.patching import InvalidPatchError, apply_data_patch
from app.rate_limit import resume_mutation_key, resume_mutation_limiter
from app.schemas.resume import (
    CreateResumeRequest,
    PatchResumeRequest,
    ResumeListItem,
    ResumeResponse,
    ResumeSort,
    SharedResumeResponse,
    UpdateResumeRequest,
    to_iso_millis,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/resumes", tags=["Resumes"])

#: 公开简历访问 cookie 的前缀与 Node `packages/api/src/features/resume/access.ts` 一致。
RESUME_ACCESS_COOKIE_PREFIX = "resume_access"

#: `resume_slug_user_id_unique` —— Node 靠这个约束名把唯一冲突翻成 400。
SLUG_UNIQUE_CONSTRAINT = "resume_slug_user_id_unique"

#: oRPC 的 OpenAPI 通道把数组序列化成 `tags[0]=a&tags[1]=b`，FastAPI 只认裸重复键
#: `tags=a&tags=b`。两种都收，M5 联调时按实际客户端再收敛成一种。
_BRACKET_TAG_KEY = re.compile(r"^tags\[\d+\]$")


# ---------------------------------------------------------------------------
# 内部小工具
# ---------------------------------------------------------------------------


def _load_owned_resume(db: Session, resume_id: str, user_id: str, *, for_update: bool = False) -> Resume:
    """取「当前用户名下」的简历，取不到就 404。

    Args:
        db: 数据库 Session。
        resume_id: 路径上的简历 id。
        user_id: 当前登录用户 id。
        for_update: 是否 `SELECT ... FOR UPDATE`（update / patch / delete 用，
            与 Node 一样在事务里锁住这一行）。

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


def _to_list_item(resume: Resume) -> ResumeListItem:
    """把一行 resume 折成 `listResumes` 的元素。"""
    return ResumeListItem(
        id=resume.id,
        name=resume.name,
        slug=resume.slug,
        tags=list(resume.tags or []),
        is_public=resume.is_public,
        show_download_buttons=resume.show_download_buttons,
        is_locked=resume.is_locked,
        created_at=resume.created_at,
        updated_at=resume.updated_at,
    )


def _to_resume_response(resume: Resume) -> ResumeResponse:
    """把一行 resume 折成 `getResume` / `updateResume` / `patchResume` 的响应。"""
    return ResumeResponse(
        id=resume.id,
        name=resume.name,
        slug=resume.slug,
        tags=list(resume.tags or []),
        is_public=resume.is_public,
        show_download_buttons=resume.show_download_buttons,
        is_locked=resume.is_locked,
        data=resume.data,
        updated_at=resume.updated_at,
        has_password=resume.password is not None,
    )


def _to_shared_response(resume: Resume, *, viewer_is_owner: bool) -> SharedResumeResponse:
    """把一行 resume 折成公开页响应，非 owner 视角要脱敏。

    照 Node `access-policy.ts` 的 `redactResumeForViewer`：非 owner 看不到
    `resume.name`（所有者自己取的后台标题，常带私人上下文）和
    `data.metadata.notes`（schema 里就写了「仅作者编辑时可见」）。
    """
    data = resume.data or {}
    name = resume.name

    if not viewer_is_owner:
        name = "Resume"
        data = copy.deepcopy(data)
        metadata = data.get("metadata")
        if isinstance(metadata, dict):
            metadata["notes"] = ""

    return SharedResumeResponse(
        id=resume.id,
        name=name,
        slug=resume.slug,
        tags=list(resume.tags or []),
        is_public=resume.is_public,
        show_download_buttons=resume.show_download_buttons,
        is_locked=resume.is_locked,
        data=data,
    )


def _truncate_to_millis(value: datetime) -> datetime:
    """把 datetime 截到毫秒精度（naive 一律按 UTC 处理）。

    为什么必须截：Postgres 的 `now()` 带微秒，而 JS `Date` 只有毫秒精度。
    Node 侧 `service.ts` 里专门写了注释警告过这件事 —— 直接比会让「带了
    expectedUpdatedAt 的 patch」永远报 409。
    """
    aware = value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
    return aware.astimezone(timezone.utc).replace(microsecond=(aware.microsecond // 1000) * 1000)


def _has_resume_access(request: Request, resume_id: str, password_hash: str | None) -> bool:
    """访客是否已经通过密码验证（照 Node `access.ts` 的 `hasResumeAccess`）。

    Args:
        request: 当前请求，用来读 `resume_access_<id>` cookie。
        resume_id: 简历 id。
        password_hash: 库里存的 bcrypt 密码哈希，没设密码时为 None。

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


def _increment_views_best_effort(db: Session, resume_id: str) -> None:
    """公开页 views +1（best-effort，失败只记日志）。

    为什么 best-effort：计数不是响应的一部分，自增失败不该让访客看不到简历。
    为什么只写 `resume_statistics`：契约第 6 节拍板 —— 统计整体留在 Node，
    daily 聚合表属于统计，不进最小集。
    """
    statement = pg_insert(ResumeStatistics).values(
        id=generate_id(),
        resume_id=resume_id,
        views=1,
        downloads=0,
        last_viewed_at=func.now(),
        updated_at=func.now(),
    )
    statement = statement.on_conflict_do_update(
        index_elements=[ResumeStatistics.resume_id],
        set_={
            "views": ResumeStatistics.__table__.c.views + 1,
            "last_viewed_at": func.now(),
            "updated_at": func.now(),
        },
    )

    try:
        db.execute(statement)
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        logger.warning("公开简历页 views 自增失败（best-effort，已忽略）", exc_info=True)


def _enforce_mutation_limit(user_id: str, resume_id: str | None = None) -> None:
    """写操作限流（对齐 Node 的 `resumeMutationRateLimit`）。

    Args:
        user_id: 当前登录用户 id。
        resume_id: 路径上的简历 id；`createResume` 没有，传 None。

    Raises:
        OrpcError: 429 —— 窗口内写操作超了 300 次 / 60 秒。
    """
    decision = resume_mutation_limiter.check(resume_mutation_key(user_id, resume_id))
    if not decision.allowed:
        raise errors.too_many_requests()


def _parse_tags_query(request: Request) -> list[str]:
    """从 query string 里取 `tags`（裸重复键与 bracket 记法都收）。"""
    return [
        value
        for key, value in request.query_params.multi_items()
        if key == "tags" or _BRACKET_TAG_KEY.match(key)
    ]


# ---------------------------------------------------------------------------
# listResumes / createResume
# ---------------------------------------------------------------------------


@router.get(
    "",
    response_model=list[ResumeListItem],
    operation_id="listResumes",
    summary="List all resumes",
    description=(
        "Returns a list of all resumes belonging to the authenticated user. Results can be filtered "
        "by tags and sorted by last updated date, creation date, or name. Resume data is not included "
        "in the response for performance; use the get endpoint to fetch full resume data. "
        "Requires authentication."
    ),
)
def list_resumes(
    request: Request,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    sort: ResumeSort = Query(default=ResumeSort.LAST_UPDATED_AT),
) -> list[ResumeListItem]:
    """列出当前用户的全部简历。

    Args:
        request: 原始请求（用来手解 `tags` 数组）。
        user_id: 由 `get_current_user_id` 注入，未认证会在依赖里直接 401。
        db: 数据库 Session。
        sort: 排序方式，默认按最后更新时间倒序。

    Returns:
        当前用户的简历元数据列表。
    """
    tags = _parse_tags_query(request)

    statement = select(Resume).where(Resume.user_id == user_id)
    if tags:
        # `arrayContains` 的等价物：Postgres 的 `@>`。
        statement = statement.where(Resume.tags.op("@>")(cast(tags, PG_ARRAY(Text))))

    if sort is ResumeSort.CREATED_AT:
        statement = statement.order_by(Resume.created_at.asc())
    elif sort is ResumeSort.NAME:
        statement = statement.order_by(Resume.name.asc())
    else:
        statement = statement.order_by(Resume.updated_at.desc())

    return [_to_list_item(row) for row in db.execute(statement).scalars().all()]


@router.post(
    "",
    response_model=str,
    status_code=status.HTTP_200_OK,
    operation_id="createResume",
    summary="Create a new resume",
    description=(
        "Creates a new resume with the given name, slug, and tags. Optionally initializes the resume "
        "with sample data by setting withSampleData to true. The slug must be unique across the "
        "user's resumes. Returns the ID of the newly created resume. Requires authentication."
    ),
    responses={400: {"description": "A resume with this slug already exists."}},
)
def create_resume(
    payload: CreateResumeRequest,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    locale_cookie: str | None = Cookie(default=None, alias=LOCALE_COOKIE_NAME),
) -> str:
    """新建一份简历，返回新 id。

    Args:
        payload: 请求体。
        user_id: 当前登录用户 id。
        db: 数据库 Session。
        locale_cookie: cookie `locale`；不认识的值回落默认 locale。

    Returns:
        新简历的 id。

    Raises:
        OrpcError: 429 限流；400 slug 重复。
    """
    _enforce_mutation_limit(user_id)

    resume_id = generate_id()
    resume = Resume(
        id=resume_id,
        name=payload.name,
        slug=payload.slug,
        tags=payload.tags,
        user_id=user_id,
        data=create_resume_data(resolve_locale(locale_cookie)),
    )

    db.add(resume)
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        if SLUG_UNIQUE_CONSTRAINT in str(getattr(error, "orig", error)):
            raise errors.resume_slug_already_exists() from error
        raise

    # `created_at` / `updated_at` 由 Postgres 的 server_default 写，Python 侧此时还是
    # None（expire_on_commit=False 不会自动回读）。刷一次，免得同一 Session 里后续
    # 查询命中 identity map 拿到空时间戳。
    db.refresh(resume)
    return resume_id


# ---------------------------------------------------------------------------
# getResume / updateResume / patchResume / deleteResume
# ---------------------------------------------------------------------------


@router.get(
    "/{id}",
    response_model=ResumeResponse,
    operation_id="getResume",
    summary="Get resume by ID",
    description=(
        "Returns a single resume with its full data, identified by its unique ID. Only resumes "
        "belonging to the authenticated user can be retrieved. Requires authentication."
    ),
)
def get_resume(
    id: str,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
) -> ResumeResponse:
    """按 id 取单份简历。

    Args:
        id: 路径上的简历 id。
        user_id: 当前登录用户 id。
        db: 数据库 Session。

    Returns:
        含完整 `data` 的简历。

    Raises:
        OrpcError: 401 未认证；404 不存在或不属于当前用户。
    """
    return _to_resume_response(_load_owned_resume(db, id, user_id))


@router.put(
    "/{id}",
    response_model=ResumeResponse,
    operation_id="updateResume",
    summary="Update a resume",
    description=(
        "Updates one or more fields of a resume identified by its ID. All fields are optional; only "
        "provided fields will be updated. Locked resumes cannot be updated. Requires authentication."
    ),
    responses={400: {"description": "A resume with this slug already exists, or the resume is locked."}},
)
def update_resume(
    id: str,
    payload: UpdateResumeRequest | None = None,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
) -> ResumeResponse:
    """整体更新简历的若干字段。

    Args:
        id: 路径上的简历 id。
        payload: 请求体，全部字段可选；不传 body 等价于空更新。
        user_id: 当前登录用户 id。
        db: 数据库 Session。

    Returns:
        更新后的简历。

    Raises:
        OrpcError: 401 / 404 / 400（锁定或 slug 重复）/ 429。
    """
    _enforce_mutation_limit(user_id, id)

    resume = _load_owned_resume(db, id, user_id, for_update=True)
    if resume.is_locked:
        raise errors.resume_locked()

    if payload is not None:
        if payload.name is not None:
            resume.name = payload.name
        if payload.slug is not None:
            resume.slug = payload.slug
        if payload.tags is not None:
            resume.tags = payload.tags
        if payload.data is not None:
            resume.data = payload.data
        if payload.is_public is not None:
            resume.is_public = payload.is_public
        if payload.show_download_buttons is not None:
            resume.show_download_buttons = payload.show_download_buttons

    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        if SLUG_UNIQUE_CONSTRAINT in str(getattr(error, "orig", error)):
            raise errors.resume_slug_already_exists() from error
        raise

    # `updated_at` 由 Postgres 侧的 `now()` 写，Python 属性不一定同步，刷一次拿准值。
    db.refresh(resume)
    return _to_resume_response(resume)


@router.patch(
    "/{id}",
    response_model=ResumeResponse,
    operation_id="patchResume",
    summary="Patch resume data",
    description=(
        "Applies JSON Patch (RFC 6902) operations to partially update a resume's data. This allows "
        "small, targeted changes (e.g. updating a single field) without sending the entire resume "
        "object. Locked resumes cannot be patched. Requires authentication."
    ),
    responses={
        400: {"description": "The patch operations are invalid or produced an invalid resume."},
        409: {"description": "The resume changed after this patch was generated."},
    },
)
def patch_resume(
    id: str,
    payload: PatchResumeRequest,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
) -> ResumeResponse:
    """用 JSON Patch 局部更新 `data`。

    路径相对 `data` 的根（`/basics/name` 指 `data.basics.name`），所以改不到
    `name` / `slug` / `tags` / `isPublic` 这些列 —— 与 Node 侧一致。

    Args:
        id: 路径上的简历 id。
        payload: 请求体，至少一条 operation。
        user_id: 当前登录用户 id。
        db: 数据库 Session。

    Returns:
        打完 patch 的简历。

    Raises:
        OrpcError: 401 / 404 / 400（锁定或 patch 非法）/ 409（版本冲突）/ 429。
    """
    _enforce_mutation_limit(user_id, id)

    resume = _load_owned_resume(db, id, user_id, for_update=True)
    if resume.is_locked:
        raise errors.resume_locked()

    if payload.expected_updated_at is not None:
        expected = _truncate_to_millis(payload.expected_updated_at)
        current = _truncate_to_millis(resume.updated_at)
        if expected != current:
            raise errors.resume_version_conflict(to_iso_millis(resume.updated_at))

    operations = [
        operation.model_dump(by_alias=True, exclude_none=True) for operation in payload.operations
    ]

    try:
        patched_data = apply_data_patch(resume.data or {}, operations)
    except InvalidPatchError as error:
        raise errors.invalid_patch_operations(
            error.message, index=error.index, operation=error.operation
        ) from error

    resume.data = patched_data
    db.commit()
    db.refresh(resume)
    return _to_resume_response(resume)


@router.delete(
    "/{id}",
    status_code=status.HTTP_200_OK,
    operation_id="deleteResume",
    summary="Delete a resume",
    description=(
        "Permanently deletes a resume and its associated files (screenshots, PDFs) from storage. "
        "Locked resumes cannot be deleted; unlock the resume first. Requires authentication."
    ),
)
def delete_resume(
    id: str,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
) -> None:
    """删除一份简历。

    只删库里的行，不清存储上的截图 / PDF —— 渲染与存储仍归 Node 管。

    Args:
        id: 路径上的简历 id。
        user_id: 当前登录用户 id。
        db: 数据库 Session。

    Raises:
        OrpcError: 401 / 404 / 400（锁定）/ 429。
    """
    _enforce_mutation_limit(user_id, id)

    resume = _load_owned_resume(db, id, user_id, for_update=True)
    if resume.is_locked:
        raise errors.resume_locked()

    db.delete(resume)
    db.commit()
    return None


# ---------------------------------------------------------------------------
# getResumeBySlug（公开）
# ---------------------------------------------------------------------------


@router.get(
    "/{username}/{slug}",
    response_model=SharedResumeResponse,
    operation_id="getResumeBySlug",
    summary="Get public resume by username and slug",
    description=(
        "Returns a publicly shared resume identified by the owner's username and the resume's slug. "
        "If the resume is password-protected and the viewer has not yet verified the password, a 401 "
        "error with code NEED_PASSWORD is returned. No authentication required for public resumes; "
        "if authenticated as the owner, private resumes are also accessible."
    ),
)
def get_resume_by_slug(
    username: str,
    slug: str,
    request: Request,
    db: Session = Depends(get_db),
    session_token: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
) -> SharedResumeResponse:
    """公开简历页数据（按 username + slug）。

    与 Node `sharing.ts` 的 `getBySlug` 对齐的四件事：

    1. 私有简历只对 owner 可见，对陌生人一律 404（不泄露存在性）；
    2. 设了密码且访客没通过验证 → 401 `NEED_PASSWORD`；
    3. **owner 自看不计入 views**（否则作者每次预览都在给自己的统计灌水）；
    4. 非 owner 视角下 `name` 与 `data.metadata.notes` 要脱敏。

    Args:
        username: 简历所有者的用户名。
        slug: 简历 slug。
        request: 原始请求（读 `resume_access_<id>` cookie）。
        db: 数据库 Session。
        session_token: cookie `better-auth.session_token`；公开页**不强制**，
            有就拿来认人（owner 因此能看自己的私有简历）。

    Returns:
        公开简历数据。

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

    if resume.password is not None and not _has_resume_access(request, resume.id, resume.password):
        raise errors.need_password(username, slug)

    response = _to_shared_response(resume, viewer_is_owner=viewer_is_owner)

    # 自增放在响应构造之后：失败要能回滚而不影响已经算好的响应。
    if not viewer_is_owner:
        _increment_views_best_effort(db, resume.id)

    return response
