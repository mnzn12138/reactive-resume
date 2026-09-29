"""SQLAlchemy ORM 模型（M2）。

**只建模 Python 侧真正需要的表**，其余（oauth_* / agent_* / application / sms_* /
resume_version / resume_statistics_daily ...）一概不建模，避免 Alembic autogenerate
误判要删表。每张表为什么在这里，都写在类 docstring 里。

字段以 `pg_dump --schema-only` 导出的真实 DDL（alembic/baseline_schema.sql）为准，
与 `packages/db/src/schema/*.ts` 的 Drizzle 定义保持一致。
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import ARRAY, Boolean, DateTime, ForeignKey, Integer, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class User(Base):
    """`user` 表 —— **只读**用途。

    为什么需要：M3「Python 取身份」要 `session JOIN user` 把 cookie 里的 token 解析成
    用户身份；后续 CRUD 也需要 `resume.user_id -> user`。Python 侧不写这张表，
    账号生命周期仍由 Node 侧的 Better Auth 负责。
    """

    __tablename__ = "user"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    image: Mapped[str | None] = mapped_column(Text, nullable=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    email: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    email_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    username: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    display_username: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    two_factor_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
    last_active_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    role: Mapped[str | None] = mapped_column(Text, nullable=True, default="user")
    banned: Mapped[bool | None] = mapped_column(Boolean, nullable=True, default=False)
    ban_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    ban_expires: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    phone_number: Mapped[str | None] = mapped_column(Text, nullable=True, unique=True)
    phone_number_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    def __repr__(self) -> str:
        return f"User(id={self.id!r}, username={self.username!r})"


class Session(Base):
    """`session` 表 —— **只读**用途（认人）。

    为什么需要：M3 的核心。`session.token` 是**明文** text 列，且项目没开 better-auth 的
    cookieCache，所以浏览器 cookie `better-auth.session_token` 的值就是 `session.token`，
    直接 `WHERE session.token = ? AND session.expires_at > now()` 即可认人，
    不需要改前端的 `authClient.getSession()`。
    """

    __tablename__ = "session"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    token: Mapped[str] = mapped_column(Text, nullable=False, unique=True, index=True)
    ip_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)
    user_id: Mapped[str] = mapped_column(
        Text, ForeignKey("user.id", ondelete="CASCADE"), nullable=False, index=True
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
    impersonated_by: Mapped[str | None] = mapped_column(Text, nullable=True)

    def __repr__(self) -> str:
        return f"Session(id={self.id!r}, user_id={self.user_id!r}, expires_at={self.expires_at!r})"


class Resume(Base):
    """`resume` 表 —— 迁移范围的主体。

    为什么需要：M4 要实现的 list / get / create / update / delete / 公开页读，全部落在这张表上。

    注意：`updated_at` 的自动刷新在 Node 侧由 Drizzle 的 `$onUpdate` 完成；Python 侧用
    `onupdate=func.now()` 复现同样语义。
    """

    __tablename__ = "resume"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    slug: Mapped[str] = mapped_column(Text, nullable=False)
    tags: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, default=list, server_default="{}"
    )
    is_public: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_locked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    password: Mapped[str | None] = mapped_column(Text, nullable=True)
    data: Mapped[dict] = mapped_column(JSONB, nullable=False)
    user_id: Mapped[str] = mapped_column(
        Text, ForeignKey("user.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
    show_download_buttons: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    def __repr__(self) -> str:
        return f"Resume(id={self.id!r}, slug={self.slug!r}, user_id={self.user_id!r})"


class ResumeStatistics(Base):
    """`resume_statistics` 表 —— 公开简历页的浏览计数。

    为什么需要：`GET /resumes/{username}/{slug}`（operationId `getResumeBySlug`，
    在 M1 的 Python 契约白名单里）在返回前会调用 `resumeService.statistics.increment`
    做 views 自增（`packages/api/src/features/resume/service.ts` 的 `getByUsernameSlug`），
    所以 Python 侧实现公开页时会写到这张表。

    已知缺口：`increment` 同时会写 `resume_statistics_daily`。按范围约定「统计」整体留在
    Node，`resume_statistics_daily` 本轮不建模 —— M4 联调公开页时再决定：要么补上这个模型，
    要么把 view/download 计数继续留给 Node 侧接口。
    """

    __tablename__ = "resume_statistics"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    views: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    downloads: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_viewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_downloaded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resume_id: Mapped[str] = mapped_column(
        Text, ForeignKey("resume.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    def __repr__(self) -> str:
        return f"ResumeStatistics(id={self.id!r}, resume_id={self.resume_id!r}, views={self.views!r})"
