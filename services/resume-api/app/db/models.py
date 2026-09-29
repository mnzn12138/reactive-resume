"""SQLAlchemy ORM 模型（M2）。

**只建模 Python 侧真正需要的表**，其余（oauth_* / agent_* / application / sms_* /
resume_version / resume_statistics_daily ...）一概不建模，避免 Alembic autogenerate
误判要删表。每张表为什么在这里，都写在类 docstring 里。

字段以 `pg_dump --schema-only` 导出的真实 DDL（alembic/baseline_schema.sql）为准，
与 `packages/db/src/schema/*.ts` 的 Drizzle 定义保持一致。
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import ARRAY, Boolean, DateTime, ForeignKey, Index, Integer, Text, func, text
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


class RecruitmentPost(Base):
    """`recruitment_post` 表 —— 校招岗位板主表（`/jobs`）。

    为什么需要：**即使 Python 侧现在完全不读写这张表也必须建模**。
    `alembic/env.py` 的 `include_object` 只比较 `Base.metadata.tables` 里声明过的表，
    如果 `0002` 建了表而模型没声明，将来 `alembic revision --autogenerate` 会生成
    `DROP TABLE` —— 非常危险。

    当前生产栈仍是 Node（Drizzle 负责查询），Python 侧只负责让 Alembic 知道这张表存在，
    M4 之后接管读写时不用补迁移。枚举列一律 text：取值由 `packages/schema` 的 zod 校验，
    加一个取值不需要迁移。
    """

    __tablename__ = "recruitment_post"

    # 索引必须声明在这里，否则 `alembic revision --autogenerate` 会把 `0002` 建的索引
    # 当成「多余」而生成 DROP INDEX。名字与 DDL 母本（`alembic/versions/0002_recruitment.py`）
    # 逐字一致，DESC 排序也要连 `NULLS LAST` 一起写，才能对上 Drizzle 的 `.desc()`。
    __table_args__ = (
        Index("uq_recruitment_post_dedupe_key", "dedupe_key", unique=True),
        Index("ix_recruitment_post_status_published_at", "status", text("published_at DESC NULLS LAST")),
        Index("ix_recruitment_post_deadline", "deadline"),
        Index("ix_recruitment_post_tags", "tags", postgresql_using="gin"),
        Index("ix_recruitment_post_locations", "locations", postgresql_using="gin"),
        Index("ix_recruitment_post_created_by", "created_by"),
        Index("ix_recruitment_post_status_report_count", "status", text("report_count DESC NULLS LAST")),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    # set null：删账号不删岗位，与 `Resume.user_id` 的 cascade 相反，是有意的差异。
    created_by: Mapped[str | None] = mapped_column(
        Text, ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )
    company: Mapped[str] = mapped_column(Text, nullable=False)
    role: Mapped[str] = mapped_column(Text, nullable=False)
    # 不直出第三方外链图片（等于把访客 IP 送给第三方），缺省走首字母占位。
    company_logo_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    batch: Mapped[str] = mapped_column(Text, nullable=False, default="regular", server_default="regular")
    employment_type: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, default=list, server_default=text("'{}'::text[]")
    )
    work_mode: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, default=list, server_default=text("'{}'::text[]")
    )
    work_intensity: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, default=list, server_default=text("'{}'::text[]")
    )
    locations: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, default=list, server_default=text("'{}'::text[]")
    )
    education_required: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, default=list, server_default=text("'{}'::text[]")
    )
    benefits: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, default=list, server_default=text("'{}'::text[]")
    )
    tags: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, default=list, server_default=text("'{}'::text[]")
    )
    salary_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    deadline: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rolling: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    apply_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    contact_kind: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 公开响应里根本没有这个字段名，匿名调用者拿到的是 `contact: null`。
    contact_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    referral_code: Mapped[str | None] = mapped_column(Text, nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 唯一性由上面的 `uq_recruitment_post_dedupe_key`（唯一索引）表达，不是列级 unique
    # 约束 —— 这样模型与迁移、以及与 Drizzle 侧的 `CREATE UNIQUE INDEX` 才是同一个东西。
    dedupe_key: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, default="pending", server_default="pending")
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed_by: Mapped[str | None] = mapped_column(
        Text, ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # 举报数只在管理端可见，公开列表不展示（避免被人当武器用）。
    report_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    def __repr__(self) -> str:
        return f"RecruitmentPost(id={self.id!r}, company={self.company!r}, role={self.role!r})"


class RecruitmentPostReport(Base):
    """`recruitment_post_report` 表 —— 一条举报。

    为什么需要：与 `RecruitmentPost` 同理（autogenerate 安全）。语义上它是「谁在什么时候
    以什么理由举报了哪个岗位」，这不是一个计数器能表达的，所以独立成表而不是加一列。
    """

    __tablename__ = "recruitment_post_report"

    # 与 `RecruitmentPost` 同理：索引要声明，否则 autogenerate 会生成 DROP INDEX。
    __table_args__ = (
        Index("uq_recruitment_post_report_post_id_reporter_id", "post_id", "reporter_id", unique=True),
        Index("ix_recruitment_post_report_post_id", "post_id"),
        Index("ix_recruitment_post_report_handled_created_at", "handled", text("created_at DESC NULLS LAST")),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    post_id: Mapped[str] = mapped_column(
        Text, ForeignKey("recruitment_post.id", ondelete="CASCADE"), nullable=False
    )
    reporter_id: Mapped[str] = mapped_column(
        Text, ForeignKey("user.id", ondelete="CASCADE"), nullable=False
    )
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    handled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    # 没有处理人，`handled = true` 就无法溯源，所以这两列是必需的。
    handled_by: Mapped[str | None] = mapped_column(
        Text, ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )
    handled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    def __repr__(self) -> str:
        return f"RecruitmentPostReport(id={self.id!r}, post_id={self.post_id!r}, reason={self.reason!r})"


class RecruitmentPostBookmark(Base):
    """`recruitment_post_bookmark` 表 —— 一条收藏。

    为什么需要：与 `RecruitmentPost` 同理（autogenerate 安全）。复合主键让收藏天然幂等：
    重复 PUT 是 no-op，不会插入第二行也不会报错。
    """

    __tablename__ = "recruitment_post_bookmark"

    __table_args__ = (Index("ix_recruitment_post_bookmark_post_id", "post_id"),)

    user_id: Mapped[str] = mapped_column(
        Text, ForeignKey("user.id", ondelete="CASCADE"), primary_key=True
    )
    post_id: Mapped[str] = mapped_column(
        Text, ForeignKey("recruitment_post.id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    def __repr__(self) -> str:
        return f"RecruitmentPostBookmark(user_id={self.user_id!r}, post_id={self.post_id!r})"
