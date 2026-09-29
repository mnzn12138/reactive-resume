"""0002 · 校招岗位板（Campus Recruitment Board）三张表。

背景
----
`plans/46-campus-board-design.md` 新增 `recruitment_post` / `recruitment_post_report` /
`recruitment_post_bookmark` 三张表。当前生产栈仍然是 Node（Drizzle 负责查询与迁移），
所以同一份结构要在两条路径上各落地一次：

* Drizzle：`packages/db/src/schema/recruitment.ts` + `migrations/<ts>_recruitment/migration.sql`
* Alembic：本文件（`0002`）+ `app/db/models.py` 里的三个 ORM 模型

本文件的 `op.create_table` 与 Drizzle 生成的 SQL **逐列对齐**（类型 / 可空 / 默认值），
索引名遵循 `app/db/base.py` 的 `NAMING_CONVENTION`（`ix_` / `uq_` / `pk_` / `fk_` 前缀），
不照抄 Drizzle 自动生成的名字。

注意
----
* **不要改 `alembic/baseline_schema.sql`**。它是某一时刻 `pg_dump --schema-only` 的历史
  快照，改了会让 `0001` 在新库上凭空多出这三张表，再跑 `0002` 就 `relation already exists`。
* 在**已经跑过 Drizzle 迁移**的库上执行本迁移会报 `relation already exists`。这种库要先
  `alembic stamp 0001` 再 `alembic stamp 0002`（只登记版本号，不执行 DDL），
  执行矩阵见设计书 §6.6。
* downgrade 按逆序 drop，保证 `upgrade -> downgrade -> upgrade` 可跑通。
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | None = None
depends_on: str | None = None

# 与 Drizzle 侧 `default([])` 一致的数组默认值；显式写 `::text[]` 避免 PG 推导出错。
_EMPTY_TEXT_ARRAY = "'{}'::text[]"


def upgrade() -> None:
    """建三张表 + 索引 + 外键。"""
    op.create_table(
        "recruitment_post",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("created_by", sa.Text(), nullable=True),
        sa.Column("company", sa.Text(), nullable=False),
        sa.Column("role", sa.Text(), nullable=False),
        sa.Column("company_logo_url", sa.Text(), nullable=True),
        sa.Column("batch", sa.Text(), nullable=False, server_default="regular"),
        sa.Column(
            "employment_type",
            postgresql.ARRAY(sa.Text()),
            nullable=False,
            server_default=sa.text(_EMPTY_TEXT_ARRAY),
        ),
        sa.Column(
            "work_mode",
            postgresql.ARRAY(sa.Text()),
            nullable=False,
            server_default=sa.text(_EMPTY_TEXT_ARRAY),
        ),
        sa.Column(
            "work_intensity",
            postgresql.ARRAY(sa.Text()),
            nullable=False,
            server_default=sa.text(_EMPTY_TEXT_ARRAY),
        ),
        sa.Column(
            "locations",
            postgresql.ARRAY(sa.Text()),
            nullable=False,
            server_default=sa.text(_EMPTY_TEXT_ARRAY),
        ),
        sa.Column(
            "education_required",
            postgresql.ARRAY(sa.Text()),
            nullable=False,
            server_default=sa.text(_EMPTY_TEXT_ARRAY),
        ),
        sa.Column(
            "benefits",
            postgresql.ARRAY(sa.Text()),
            nullable=False,
            server_default=sa.text(_EMPTY_TEXT_ARRAY),
        ),
        sa.Column(
            "tags",
            postgresql.ARRAY(sa.Text()),
            nullable=False,
            server_default=sa.text(_EMPTY_TEXT_ARRAY),
        ),
        sa.Column("salary_text", sa.Text(), nullable=True),
        sa.Column("deadline", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rolling", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("apply_url", sa.Text(), nullable=True),
        sa.Column("contact_kind", sa.Text(), nullable=True),
        sa.Column("contact_value", sa.Text(), nullable=True),
        sa.Column("referral_code", sa.Text(), nullable=True),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("source", sa.Text(), nullable=True),
        sa.Column("source_url", sa.Text(), nullable=True),
        sa.Column("dedupe_key", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default="pending"),
        sa.Column("rejection_reason", sa.Text(), nullable=True),
        sa.Column("reviewed_by", sa.Text(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("report_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id", name="pk_recruitment_post"),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["user.id"],
            name="fk_recruitment_post_created_by_user",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["reviewed_by"],
            ["user.id"],
            name="fk_recruitment_post_reviewed_by_user",
            ondelete="SET NULL",
        ),
    )
    # 去重的物理保证：同一公司 + 岗位 + 城市只能有一行。
    op.create_index("uq_recruitment_post_dedupe_key", "recruitment_post", ["dedupe_key"], unique=True)
    # 主查询路径：已发布，按发布时间倒序。
    # `NULLS LAST` matches what Drizzle's `.desc()` emits: a post still in review
    # (published_at is null) must sort after the published ones, not before.
    op.create_index(
        "ix_recruitment_post_status_published_at",
        "recruitment_post",
        ["status", sa.text("published_at DESC NULLS LAST")],
    )
    op.create_index("ix_recruitment_post_deadline", "recruitment_post", ["deadline"])
    # 数组列必须 GIN：B-tree 对数组包含判断无效。
    op.create_index(
        "ix_recruitment_post_tags",
        "recruitment_post",
        ["tags"],
        postgresql_using="gin",
    )
    op.create_index(
        "ix_recruitment_post_locations",
        "recruitment_post",
        ["locations"],
        postgresql_using="gin",
    )
    op.create_index("ix_recruitment_post_created_by", "recruitment_post", ["created_by"])
    op.create_index(
        "ix_recruitment_post_status_report_count",
        "recruitment_post",
        ["status", sa.text("report_count DESC NULLS LAST")],
    )

    op.create_table(
        "recruitment_post_report",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("post_id", sa.Text(), nullable=False),
        sa.Column("reporter_id", sa.Text(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("detail", sa.Text(), nullable=True),
        sa.Column("handled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("handled_by", sa.Text(), nullable=True),
        sa.Column("handled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id", name="pk_recruitment_post_report"),
        sa.ForeignKeyConstraint(
            ["post_id"],
            ["recruitment_post.id"],
            name="fk_recruitment_post_report_post_id_recruitment_post",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["reporter_id"],
            ["user.id"],
            name="fk_recruitment_post_report_reporter_id_user",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["handled_by"],
            ["user.id"],
            name="fk_recruitment_post_report_handled_by_user",
            ondelete="SET NULL",
        ),
    )
    # 一人一岗只能举报一次，直接落在 DB 上，不靠应用层判断。
    op.create_index(
        "uq_recruitment_post_report_post_id_reporter_id",
        "recruitment_post_report",
        ["post_id", "reporter_id"],
        unique=True,
    )
    op.create_index("ix_recruitment_post_report_post_id", "recruitment_post_report", ["post_id"])
    op.create_index(
        "ix_recruitment_post_report_handled_created_at",
        "recruitment_post_report",
        ["handled", sa.text("created_at DESC NULLS LAST")],
    )

    op.create_table(
        "recruitment_post_bookmark",
        sa.Column("user_id", sa.Text(), nullable=False),
        sa.Column("post_id", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        # 复合主键：收藏天然幂等，重复 PUT 不报错。
        sa.PrimaryKeyConstraint("user_id", "post_id", name="pk_recruitment_post_bookmark"),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["user.id"],
            name="fk_recruitment_post_bookmark_user_id_user",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["post_id"],
            ["recruitment_post.id"],
            name="fk_recruitment_post_bookmark_post_id_recruitment_post",
            ondelete="CASCADE",
        ),
    )
    op.create_index("ix_recruitment_post_bookmark_post_id", "recruitment_post_bookmark", ["post_id"])


def downgrade() -> None:
    """逆序删表；索引与外键随表一起消失。"""
    op.drop_table("recruitment_post_bookmark")
    op.drop_table("recruitment_post_report")
    op.drop_table("recruitment_post")
