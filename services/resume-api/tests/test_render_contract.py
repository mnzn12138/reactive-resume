"""M5 · 「Python 产出的 `data` 喂给渲染链路会不会炸」的验证。

思路：渲染链路消费的就是 `resume.data`。M4 的 Python 侧现在也产出这份 `data`，所以要把
它和 Node 侧**权威形状**做一次逐字段 diff。

权威形状从哪来
--------------
不是手抄 Node 的 `resumeDataSchema`（784 行 zod，抄等于在 Python 侧再养一份），而是直接
读 `contract/resume-openapi.json` —— M1 的切片脚本已经把 `resume.data` 的 JSON Schema
**完整内联**进契约了（所以契约文件才有 681 KB）。也就是说：形状的唯一依据仍然是 Node
服务的产出，我们只是把它读出来用。

为什么不引入 `jsonschema`
------------------------
加一个依赖就能做严格校验，但那会把「校验」变成运行时职责，进而牵出一堆问题（要不要在
写入时候校验？校验失败算 400 还是 422？Node 那 784 行里的 refine / transform 还有几个
是 JSON Schema 表达不了的？）。本轮的结论是**不补运行时校验**（见
`docs/render-parity.md` 第 3 节），所以这里只写一个够用的递归 walker 做 diff ——
它是**测试**代码，不是生产代码。

这里覆盖三件事
--------------
1. `getResume` 响应的顶层字段集合与契约**集合相等**；
2. `data` 子树按契约里内联的 JSON Schema **逐字段**走一遍，报告每一处不符；
3. `data` 经过 JSONB 落库再读回来**不丢字段、不改类型**（JSONB 往返保真）。
"""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.db.models import Resume
from app.defaults import create_resume_data
from conftest import CONTRACT_PATH, SAMPLE_DATA

#: 契约里 `getResume` 的 200 响应 schema 的位置。
_GET_RESUME_SCHEMA = ("get", "/resumes/{id}")


def _response_schema(method: str, path: str) -> dict[str, Any]:
    """取契约里某个 200 响应的 JSON Schema。"""
    spec = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    return spec["paths"][path][method]["responses"]["200"]["content"]["application/json"]["schema"]


def _json_type(value: Any) -> str:
    """把 Python 值映射成 JSON Schema 的 type 名。"""
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    return "unknown"


def _matches(value: Any, schema: dict[str, Any], path: str, out: list[str]) -> None:
    """按 JSON Schema 递归比对，把不符的地方写进 `out`。

    只实现契约里真正出现的那几个关键字（`type` / `properties` / `required` / `items` /
    `enum` / `anyOf` / `allOf` / `$ref`）。契约里出现这里没覆盖的关键字时，会在
    `test_contract_uses_only_supported_keywords` 里先红掉，不会静默跳过。

    Args:
        value: 待比对的值。
        schema: JSON Schema 片段。
        path: 当前路径（用于报错）。
        out: 收集 diff 描述的列表。
    """
    if not isinstance(schema, dict):
        return

    if "$ref" in schema:
        out.append(f"{path}: 契约里出现了未内联的 $ref {schema['$ref']}")
        return

    if "allOf" in schema:
        for index, branch in enumerate(schema["allOf"]):
            _matches(value, branch, f"{path}/allOf[{index}]", out)
        return

    for keyword in ("anyOf", "oneOf"):
        if keyword in schema:
            branches = schema[keyword]
            if not any(_branch_ok(value, branch) for branch in branches):
                out.append(f"{path}: 不匹配 {keyword} 的任何一个分支")
            return

    actual = _json_type(value)
    expected = schema.get("type")
    if expected:
        allowed = expected if isinstance(expected, list) else [expected]
        # JSON Schema 里 integer 是 number 的子类型，`z.number()` 导出的就是 `number`。
        if "number" in allowed and actual == "integer":
            actual = "number"
        if actual not in allowed:
            out.append(f"{path}: 类型 {actual} != 期望 {allowed}")
            return

    if "enum" in schema and value not in schema["enum"]:
        out.append(f"{path}: {value!r} 不在 enum {schema['enum']!r} 里")

    if actual == "object":
        properties = schema.get("properties", {})
        for name in schema.get("required", []):
            if name not in value:
                out.append(f"{path}.{name}: 缺失（契约标了 required）")
        for name, subschema in properties.items():
            if name in value:
                _matches(value[name], subschema, f"{path}.{name}", out)
    elif actual == "array":
        items = schema.get("items")
        if isinstance(items, dict):
            for index, item in enumerate(value):
                _matches(item, items, f"{path}[{index}]", out)


def _branch_ok(value: Any, schema: dict[str, Any]) -> bool:
    """`_matches` 在 anyOf / oneOf 分支上的判定：没有产出 diff 即视为命中。"""
    collected: list[str] = []
    _matches(value, schema, "", collected)
    return not collected


#: 契约内联 schema 里出现的关键字；出现表外的说明切片变了，需要人来看。
_SUPPORTED_KEYWORDS = {
    "type",
    "properties",
    "required",
    "items",
    "enum",
    "anyOf",
    "oneOf",
    "allOf",
    "$ref",
    "additionalProperties",
    "default",
    "description",
    "title",
    "format",
    "minimum",
    "maximum",
    "minLength",
    "maxLength",
    "minItems",
    "maxItems",
    "pattern",
    "const",
    "examples",
    # `not` 是**否定**约束（"不能匹配这个子 schema"）。walker 不去求值它 —— 少判一条
    # 否定只可能让我们更宽松（漏报），不可能把合规的 data 判成不合规，所以这里的结论
    # 「种子数据符合契约」依然是成立的。
    "not",
}


def _collect_keywords(node: Any, found: set[str]) -> None:
    """递归收集 schema 里用到的全部关键字。"""
    if isinstance(node, dict):
        for key, value in node.items():
            found.add(key)
            # `properties` 的键是字段名不是关键字，只往下走值。
            if key != "properties":
                _collect_keywords(value, found)
            else:
                _collect_keywords(list(value.values()), found)
    elif isinstance(node, list):
        for item in node:
            _collect_keywords(item, found)


# ---------------------------------------------------------------------------
# 用例
# ---------------------------------------------------------------------------


def test_contract_uses_only_supported_keywords() -> None:
    """契约内联 schema 里没有超出 walker 能力的关键字。

    这条是上面 `_matches` 的保险丝：将来 Node 改了 schema、引入新关键字时，先在这里红，
    而不是让 `_matches` 静默地「看起来全对」。
    """
    used: set[str] = set()
    _collect_keywords(_response_schema(*_GET_RESUME_SCHEMA)["properties"]["data"], used)

    assert used <= _SUPPORTED_KEYWORDS, f"契约出现了未支持的关键字: {sorted(used - _SUPPORTED_KEYWORDS)}"


def test_get_resume_top_level_keys_match_contract(
    api_client: TestClient, authed: str, resume_factory: Callable[..., Resume]
) -> None:
    """`getResume` 响应的字段集合与契约**集合相等**（多一个少一个都红）。"""
    resume = resume_factory(user_id=authed)

    schema = _response_schema(*_GET_RESUME_SCHEMA)
    body = api_client.get(f"/resumes/{resume.id}").json()

    assert set(body) == set(schema["properties"]), (
        f"契约字段: {sorted(schema['properties'])}\n实际字段: {sorted(body)}"
    )
    # 契约标了 required 的字段，响应里一个都不能缺（Pydantic 的 `exclude_none` 可能吃掉）。
    assert set(schema["required"]) <= set(body)


def test_seed_data_matches_contract_schema_field_by_field() -> None:
    """种子 `data`（`createResumeData` 的产物）逐字段对齐契约内联的 JSON Schema。

    这是本节的核心：证明 Python 侧喂给渲染链路的 `data` **在形状上**和 Node 声明的一致。
    """
    data_schema = _response_schema(*_GET_RESUME_SCHEMA)["properties"]["data"]
    data = create_resume_data("zh-CN")

    diffs: list[str] = []
    _matches(data, data_schema, "data", diffs)

    assert diffs == [], "与契约的逐字段 diff：\n" + "\n".join(diffs)


@pytest.mark.parametrize("locale", ["zh-CN", "en-US", "zh-TW"])
def test_seed_data_matches_contract_for_every_supported_locale(locale: str) -> None:
    """三种 locale 的种子数据都符合同一份 schema（locale 只影响 `metadata.page.locale`）。"""
    data_schema = _response_schema(*_GET_RESUME_SCHEMA)["properties"]["data"]

    diffs: list[str] = []
    _matches(create_resume_data(locale), data_schema, "data", diffs)

    assert diffs == [], f"locale={locale} 的 diff：\n" + "\n".join(diffs)


def test_seed_data_survives_the_jsonb_round_trip(
    api_client: TestClient, authed: str, resume_factory: Callable[..., Resume]
) -> None:
    """`data` 落进 JSONB 再读回来必须**逐字节等价**：不丢键、不改类型。

    为什么单独钉这条：JSONB 会把数字归一化（`35` 与 `35.0` 在 JSONB 里是两回事），
    而渲染链路对 `columns` / `fontSize` 这类字段是有类型期待的。往返不保真的话，
    上面那条「内存里的种子数据符合契约」就说明不了线上行为。
    """
    data = create_resume_data("zh-CN")
    resume = resume_factory(user_id=authed, data=data)

    body = api_client.get(f"/resumes/{resume.id}").json()

    assert body["data"] == data, "JSONB 往返后 data 发生了变化"
    # 逐处确认「整数还是整数」：JSONB 往返最容易在这里悄悄把 35 变成 35.0。
    assert body["data"]["metadata"]["layout"]["sidebarWidth"] == 35
    assert isinstance(body["data"]["metadata"]["layout"]["sidebarWidth"], int)
    assert body["data"]["metadata"]["typography"]["body"]["fontSize"] == 10
    assert isinstance(body["data"]["metadata"]["typography"]["body"]["fontSize"], int)


def test_patch_preserves_the_contract_shape(
    api_client: TestClient, authed: str, resume_factory: Callable[..., Resume]
) -> None:
    """`patchResume` 打完补丁后，`data` 仍然符合契约形状。

    patch 是**运行时**唯一能往 `data` 里塞东西的入口 —— 它不校验结构（见
    `docs/render-parity.md` 第 3 节），所以这里至少确认「合法改动不会破坏形状」。
    """
    data_schema = _response_schema(*_GET_RESUME_SCHEMA)["properties"]["data"]
    resume = resume_factory(user_id=authed, data=create_resume_data("zh-CN"))

    body = api_client.patch(
        f"/resumes/{resume.id}",
        json={
            "operations": [
                {"op": "replace", "path": "/basics/name", "value": "张三"},
                {"op": "replace", "path": "/basics/headline", "value": "后端工程师"},
            ]
        },
    ).json()

    diffs: list[str] = []
    _matches(body["data"], data_schema, "data", diffs)

    assert diffs == [], "patch 后的 diff：\n" + "\n".join(diffs)
    assert body["data"]["basics"]["name"] == "张三"


def test_a_minimal_hand_written_data_is_reported_as_incomplete() -> None:
    """反例：手写的最小 `data`（`SAMPLE_DATA`）**确实**不符合契约 —— 证明 walker 有牙齿。

    如果这条哪天变成「也符合」，说明 `_matches` 退化成了永远通过，上面的结论就全都不作数了。
    """
    data_schema = _response_schema(*_GET_RESUME_SCHEMA)["properties"]["data"]

    diffs: list[str] = []
    _matches(dict(SAMPLE_DATA), data_schema, "data", diffs)

    assert diffs, "walker 失效：残缺的 data 竟然没被报出 diff"
