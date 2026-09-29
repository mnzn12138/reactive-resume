"""M4 · JSON Patch（RFC 6902）在 `data` 子树上的应用。

照 Node 侧 `packages/resume/src/patch.ts` + `packages/api/src/features/resume/service.ts`
的 `applyResumePatchTx` 语义来：

* patch 的文档根是 **`resume.data` 本身**，不是整条 resume 记录。所以 `/basics/name`
  指的是 `data.basics.name`，调用方没法用 patch 去改 `name` / `slug` / `tags` /
  `isPublic` 这些列 —— 正是「只允许操作 `data` 子树」的落法。
* 结构校验（op 是否合法、`path` 是否是合法 JSON Pointer、`from` / `value` 有没有给）
  放在最前面，与 Node 的 `jsonpatch.validate` 一致。
* 失败时抛 `InvalidPatchError`，由路由翻成 400 `INVALID_PATCH_OPERATIONS`。

用 `jsonpatch` 库而不是自己写：`fast-json-patch`（Node）与本库都实现 RFC 6902，
语义等价，没必要在「最小集迁移」里再抄一遍指针解析。
"""

from __future__ import annotations

from typing import Any

import jsonpatch
from jsonpointer import JsonPointerException


class InvalidPatchError(Exception):
    """一组 patch 操作非法或应用失败。

    Attributes:
        message: 面向调用方的英文说明。
        index: 出错操作的下标（0 基）；结构级错误没有下标时为 0。
        operation: 出错的操作对象；无法确定时为 None。
    """

    def __init__(self, message: str, index: int = 0, operation: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.index = index
        self.operation = operation


#: `jsonpatch` 各异常 → 人类可读文案，照 Node `patchErrorMessages` 表。
_PATCH_ERROR_MESSAGES: dict[str, str] = {
    "SEQUENCE_NOT_AN_ARRAY": "Patch sequence must be an array.",
    "OPERATION_NOT_AN_OBJECT": "Operation is not an object.",
    "OPERATION_OP_INVALID": "Operation `op` property is not one of the operations defined in RFC 6902.",
    "OPERATION_PATH_INVALID": "Operation `path` property is not a valid JSON Pointer string.",
    "OPERATION_FROM_REQUIRED": "Operation `from` property is required for `move` and `copy` operations.",
    "OPERATION_VALUE_REQUIRED": "Operation `value` property is required for `add`, `replace`, and `test` operations.",
    "OPERATION_VALUE_CANNOT_CONTAIN_UNDEFINED": (
        "Operation `value` contains an `undefined` value, which is not valid in JSON."
    ),
    "OPERATION_PATH_CANNOT_ADD": "Cannot perform an `add` operation at the desired path.",
    "OPERATION_PATH_UNRESOLVABLE": "Cannot perform the operation at a path that does not exist.",
    "OPERATION_FROM_UNRESOLVABLE": "Cannot perform the operation from a path that does not exist.",
    "OPERATION_PATH_ILLEGAL_ARRAY_INDEX": "Array index in path must be an unsigned base-10 integer.",
    "OPERATION_VALUE_OUT_OF_BOUNDS": (
        "The specified array index is greater than the number of elements in the array."
    ),
    "TEST_OPERATION_FAILED": (
        "Test operation failed -- the value at the given path did not match the expected value."
    ),
}


def _to_invalid_patch_error(
    error: Exception,
    operations: list[dict[str, Any]],
    index: int,
) -> InvalidPatchError:
    """把 `jsonpatch` 的异常翻成 `InvalidPatchError`。"""
    code = type(error).__name__
    message = _PATCH_ERROR_MESSAGES.get(code, str(error))
    operation = operations[index] if 0 <= index < len(operations) else None
    return InvalidPatchError(message, index=index, operation=operation)


def apply_data_patch(data: dict[str, Any], operations: list[dict[str, Any]]) -> dict[str, Any]:
    """把一组 JSON Patch 操作应用到 `resume.data` 上。

    Args:
        data: 当前简历的 `data`（**不会被就地修改**，`jsonpatch` 内部会先深拷贝）。
        operations: RFC 6902 操作数组，元素为 `{"op": ..., "path": ..., ...}`。

    Returns:
        应用后的新 `data`。

    Raises:
        InvalidPatchError: 操作结构非法、路径不存在、`test` 失败，或结果不是 JSON 对象。
    """
    # `JsonPatch()` 构造时就会校验 op / path / from / value 的结构，对应 Node 的 validate。
    # 注意指针解析错误来自 `jsonpointer`，不是 `jsonpatch.JsonPatchException` 的子类，
    # 两个都得接。
    try:
        patch = jsonpatch.JsonPatch(operations)
    except (jsonpatch.JsonPatchException, JsonPointerException) as error:
        raise _to_invalid_patch_error(error, operations, 0) from error

    try:
        patched = patch.apply(data)
    except jsonpatch.JsonPatchException as error:
        # jsonpatch 不回带下标，逐条试一遍定位到出错的那条（Node 会给 index）。
        raise _to_invalid_patch_error(error, operations, _locate_failure(data, operations)) from error
    except JsonPointerException as error:
        raise _to_invalid_patch_error(error, operations, _locate_failure(data, operations)) from error

    if not isinstance(patched, dict):
        raise InvalidPatchError(
            "The patch operations produced a document that is not a resume data object.",
            index=0,
            operation=None,
        )

    return patched


def _locate_failure(data: dict[str, Any], operations: list[dict[str, Any]]) -> int:
    """逐条重放，定位第一个失败的 operation 下标。

    为什么需要：`jsonpatch` 的异常不带 index，而 Node 的错误体里有 `index`，
    契约里 `INVALID_PATCH_OPERATIONS.data` 也声明了这个字段。
    """
    for index in range(len(operations)):
        try:
            jsonpatch.JsonPatch([operations[index]]).apply(data)
        except (jsonpatch.JsonPatchException, JsonPointerException):
            return index
    return 0
