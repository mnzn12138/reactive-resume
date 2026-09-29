"""M4 · 简历 CRUD 的 Pydantic v2 请求 / 响应模型。

形状的**唯一依据是 `contract/resume-openapi.json`**（M1 从 Node 服务切出来的权威契约）：
每个响应模型的字段集合，就是契约里对应 200 响应 schema 的 `properties` 键集合，
不多也不少。字段名走 camelCase（`to_camel` 别名），Python 侧代码仍用 snake_case。

两处刻意与契约「required」不同（都会让调用方更宽松，不会更严格）：

* `CreateResumeRequest.tags` 给了默认值 —— Node 侧 zod 是 `.optional().default([])`，
  运行时不传也能过，契约里的 `required` 只是 `ZodDefault` 的导出副作用。
* `data` 只校验「是个 JSON 对象」，不校验 `ResumeData` 的内部结构。
  Node 会跑 `parseWritableResumeData`（`resumeDataSchema` 有 784 行）；把它平移成
  Pydantic 等于在 Python 侧再维护一整份简历 schema，超出「CRUD 最小集」。
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import StrEnum
from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, PlainSerializer, field_validator
from pydantic.alias_generators import to_camel

_BASE_CONFIG = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="ignore")


def to_iso_millis(value: datetime) -> str:
    """序列化成与 Node `Date.prototype.toISOString()` 同形的字符串。

    默认 `datetime.isoformat()` 会给出 `+00:00` 结尾，Node 给的是 `...Z`；两者都合法
    RFC 3339，但前端/localStorage 里存的是 Node 的字符串，统一成毫秒精度 + `Z`
    可以让两边的响应逐字节可比。

    Args:
        value: 待序列化的时间（naive 一律按 UTC 处理）。

    Returns:
        形如 `2026-02-14T08:30:00.000Z` 的字符串。
    """
    aware = value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
    utc = aware.astimezone(timezone.utc)
    return f"{utc.strftime('%Y-%m-%dT%H:%M:%S')}.{utc.microsecond // 1000:03d}Z"


#: 响应里的所有时间戳都走上面这个序列化器。
IsoDatetime = Annotated[datetime, PlainSerializer(to_iso_millis, return_type=str, when_used="json")]

#: `resume.data` 的载体：一个 JSON 对象，内部结构由 Node 侧的 schema 负责校验。
ResumeData = dict[str, Any]


class ResumeSort(StrEnum):
    """`listResumes` 的 `sort` 取值（契约里的 enum，逐字对齐）。"""

    LAST_UPDATED_AT = "lastUpdatedAt"
    CREATED_AT = "createdAt"
    NAME = "name"


class ResumeListItem(BaseModel):
    """`listResumes` 的单个元素 —— 只有元数据，不含 `data`。

    契约：`GET /resumes` 200 → `resumeSchema.omit({data, password, userId})`。
    """

    model_config = _BASE_CONFIG

    id: str
    name: str
    slug: str
    tags: list[str]
    is_public: bool
    show_download_buttons: bool
    is_locked: bool
    created_at: IsoDatetime
    updated_at: IsoDatetime


class ResumeResponse(BaseModel):
    """`getResume` / `updateResume` / `patchResume` 的响应。

    契约：`resumeSchema.omit({password, userId, createdAt}).extend({hasPassword: boolean})`。
    """

    model_config = _BASE_CONFIG

    id: str
    name: str
    slug: str
    tags: list[str]
    is_public: bool
    show_download_buttons: bool
    is_locked: bool
    data: ResumeData
    updated_at: IsoDatetime
    has_password: bool


class SharedResumeResponse(BaseModel):
    """`getResumeBySlug` 的响应（公开简历页）。

    契约：`resumeSchema.omit({name, password, userId, createdAt, updatedAt}).extend({name: string})`。
    比 `ResumeResponse` 少了 `updatedAt` 和 `hasPassword`：公开页不该暴露更新时间，
    `hasPassword` 虽然 Node 侧 `toSharedResumeResponse` 会带上，但 zod 输出校验会
    把它剔掉（unknown key strip），所以线上实际不出这个字段 —— 契约即事实。
    """

    model_config = _BASE_CONFIG

    id: str
    name: str
    slug: str
    tags: list[str]
    is_public: bool
    show_download_buttons: bool
    is_locked: bool
    data: ResumeData


def _require_non_blank(value: str, field_name: str) -> str:
    """去空白后非空校验（Node 侧 `z.string().trim().min(1)`）。

    Args:
        value: 原始字符串。
        field_name: 字段名，用于报错文案。

    Returns:
        去掉首尾空白后的字符串。

    Raises:
        ValueError: 去空白后为空串。
    """
    trimmed = value.strip()
    if not trimmed:
        raise ValueError(f"{field_name} must not be blank")
    return trimmed


class CreateResumeRequest(BaseModel):
    """`createResume` 的请求体。

    契约：`resumeSchema.pick({name, slug, tags}).extend({withSampleData: boolean.default(false)})`。
    """

    model_config = _BASE_CONFIG

    name: str
    slug: str
    tags: list[str] = Field(default_factory=list)
    with_sample_data: bool = False

    @field_validator("name", "slug", mode="after")
    @classmethod
    def _validate_non_blank(cls, value: str, info: Any) -> str:
        return _require_non_blank(value, info.field_name)


class UpdateResumeRequest(BaseModel):
    """`updateResume` 的请求体 —— 全部字段可选，只更新传了的那些。

    契约里 `required` 为空；Node 侧 `resumeService.update` 也只在 `!== undefined`
    时才写对应列。
    """

    model_config = _BASE_CONFIG

    name: str | None = None
    slug: str | None = None
    tags: list[str] | None = None
    data: ResumeData | None = None
    is_public: bool | None = None
    show_download_buttons: bool | None = None

    @field_validator("name", "slug", mode="after")
    @classmethod
    def _validate_non_blank(cls, value: str | None, info: Any) -> str | None:
        if value is None:
            return None
        return _require_non_blank(value, info.field_name)


class JsonPatchOperationAdd(BaseModel):
    """RFC 6902 `add`。"""

    model_config = _BASE_CONFIG

    op: Literal["add"]
    path: str
    value: Any


class JsonPatchOperationRemove(BaseModel):
    """RFC 6902 `remove`。"""

    model_config = _BASE_CONFIG

    op: Literal["remove"]
    path: str


class JsonPatchOperationReplace(BaseModel):
    """RFC 6902 `replace`。"""

    model_config = _BASE_CONFIG

    op: Literal["replace"]
    path: str
    value: Any


class JsonPatchOperationMove(BaseModel):
    """RFC 6902 `move`。"""

    model_config = _BASE_CONFIG

    op: Literal["move"]
    path: str
    # `from` 是 Python 关键字，字段名改 from_；显式 alias 优先于 alias_generator。
    from_: str = Field(alias="from")


class JsonPatchOperationCopy(BaseModel):
    """RFC 6902 `copy`。"""

    model_config = _BASE_CONFIG

    op: Literal["copy"]
    path: str
    from_: str = Field(alias="from")


class JsonPatchOperationTest(BaseModel):
    """RFC 6902 `test`。"""

    model_config = _BASE_CONFIG

    op: Literal["test"]
    path: str
    value: Any


JsonPatchOperation = Annotated[
    Union[
        JsonPatchOperationAdd,
        JsonPatchOperationRemove,
        JsonPatchOperationReplace,
        JsonPatchOperationMove,
        JsonPatchOperationCopy,
        JsonPatchOperationTest,
    ],
    Field(discriminator="op"),
]


class PatchResumeRequest(BaseModel):
    """`patchResume` 的请求体 —— JSON Patch（RFC 6902），**不是** merge patch。

    契约：`z.object({ id, expectedUpdatedAt?: coerce.date(), operations: array(jsonPatchOperationSchema).min(1) })`。
    路径相对 `resume.data` 的根，所以改不到 `name` / `slug` / `tags` 这些列。
    """

    model_config = _BASE_CONFIG

    operations: list[JsonPatchOperation] = Field(min_length=1)
    expected_updated_at: datetime | None = None
