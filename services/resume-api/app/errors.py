"""M4 · 统一错误响应（照 oRPC 的错误信封）。

为什么不用 FastAPI 默认的 `{"detail": ...}`：契约 `contract/resume-openapi.json` 里
400 / 409 的响应体是 oRPC 的信封（`defined` / `code` / `status` / `message` / `data`）。
前端 `apps/web/src/libs/error-message.ts` 按 `code` 取文案，所以状态码之外
`code` 必须对得上；顺手把 401 / 404 / 429 也统一成同一形状，避免同一套 API 里
一会儿 `detail` 一会儿 `code`。

契约里没有声明 401 / 404 的响应体（oRPC 只把显式 `.errors()` 的码导出），
所以这两档的形状是我们自己定的，取 oRPC `COMMON_ORPC_ERROR_DEFS` 的码名。
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import HTTPException, RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict

#: 状态码 → oRPC 通用错误码（见 `@orpc/client` 的 `COMMON_ORPC_ERROR_DEFS`）。
_STATUS_TO_CODE: dict[int, str] = {
    status.HTTP_400_BAD_REQUEST: "BAD_REQUEST",
    status.HTTP_401_UNAUTHORIZED: "UNAUTHORIZED",
    status.HTTP_403_FORBIDDEN: "FORBIDDEN",
    status.HTTP_404_NOT_FOUND: "NOT_FOUND",
    status.HTTP_405_METHOD_NOT_ALLOWED: "METHOD_NOT_SUPPORTED",
    status.HTTP_409_CONFLICT: "CONFLICT",
    # 不用 `status.HTTP_422_UNPROCESSABLE_ENTITY`：新版 Starlette 已改名/废弃，写死 422 更稳。
    422: "UNPROCESSABLE_CONTENT",
    status.HTTP_429_TOO_MANY_REQUESTS: "TOO_MANY_REQUESTS",
    status.HTTP_500_INTERNAL_SERVER_ERROR: "INTERNAL_SERVER_ERROR",
}


class ErrorBody(BaseModel):
    """oRPC 错误信封。

    Attributes:
        defined: 该错误码是否在路由上显式声明过（Node 侧 `.errors({...})` 声明过的为 true）。
        code: 错误码，前端按它取文案。
        status: HTTP 状态码。
        message: 面向调用方的英文说明。
        data: 结构化补充信息（如冲突时的 `updatedAt`），没有就不出这个字段。
    """

    model_config = ConfigDict(exclude_none=True)

    defined: bool = True
    code: str
    status: int
    message: str
    data: dict[str, Any] | None = None


class OrpcError(Exception):
    """业务错误：由异常处理器序列化成 oRPC 信封。

    Attributes:
        status_code: HTTP 状态码。
        code: oRPC 错误码。
        message: 面向调用方的英文说明。
        data: 结构化补充信息，没有则为 None。
    """

    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        data: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.data = data


def not_authenticated() -> OrpcError:
    """未认证（无 cookie / token 不存在 / 已过期）。"""
    return OrpcError(status.HTTP_401_UNAUTHORIZED, "UNAUTHORIZED", "Not authenticated")


def resume_not_found() -> OrpcError:
    """简历不存在，**或**不是当前用户的。

    越权一律走 404 而不是 403：和 Node 侧 `assertCanView` 一致，
    避免用状态码泄露「这份简历存在但不属于你」。
    """
    return OrpcError(status.HTTP_404_NOT_FOUND, "NOT_FOUND", "Not Found")


def resume_locked() -> OrpcError:
    """简历被锁定，不能改。

    Node 侧 `new ORPCError("RESUME_LOCKED")` 没带 status，会被 oRPC 兜成 500。
    这里给 400：锁定是调用方的状态错误，不是服务端故障。见 README「与 Node 的差异」。
    """
    return OrpcError(
        status.HTTP_400_BAD_REQUEST,
        "RESUME_LOCKED",
        "This resume is locked. Unlock it first to make changes.",
    )


def resume_slug_already_exists() -> OrpcError:
    """同一用户下 slug 重复（唯一约束 `resume_slug_user_id_unique`）。"""
    return OrpcError(
        status.HTTP_400_BAD_REQUEST,
        "RESUME_SLUG_ALREADY_EXISTS",
        "A resume with this slug already exists.",
    )


def invalid_patch_operations(
    message: str,
    *,
    index: int | None = None,
    operation: dict[str, Any] | None = None,
) -> OrpcError:
    """JSON Patch 非法或应用失败。

    Args:
        message: 面向调用方的英文说明。
        index: 出错操作在数组中的下标（0 基），无法确定时不传。
        operation: 出错的操作对象，无法确定时不传。
    """
    data: dict[str, Any] = {}
    if index is not None:
        data["index"] = index
    if operation is not None:
        data["operation"] = operation

    return OrpcError(
        status.HTTP_400_BAD_REQUEST,
        "INVALID_PATCH_OPERATIONS",
        message,
        data or None,
    )


def resume_version_conflict(updated_at: str) -> OrpcError:
    """`expectedUpdatedAt` 与当前 `updated_at` 不一致。

    Args:
        updated_at: 简历当前 `updated_at` 的 ISO 字符串（毫秒精度 + `Z`），
            回给调用方让它重新拉一次再改。
    """
    return OrpcError(
        status.HTTP_409_CONFLICT,
        "RESUME_VERSION_CONFLICT",
        "The resume changed after this patch was generated.",
        {"updatedAt": updated_at},
    )


def need_password(username: str, slug: str) -> OrpcError:
    """公开简历设了访问密码，而访客还没通过验证。

    Args:
        username: 简历.owner 的用户名。
        slug: 简历 slug。
    """
    return OrpcError(
        status.HTTP_401_UNAUTHORIZED,
        "NEED_PASSWORD",
        "This resume is password protected.",
        {"username": username, "slug": slug},
    )


def too_many_requests() -> OrpcError:
    """写操作触到进程内限流窗口上限。"""
    return OrpcError(
        status.HTTP_429_TOO_MANY_REQUESTS,
        "TOO_MANY_REQUESTS",
        "Too many requests. Please slow down.",
    )


def pdf_render_failed(operation: str, upstream_status: int, hint: str = "") -> OrpcError:
    """Node 渲染端点失败（非 200，或 200 但给的不是 PDF）。

    为什么是 502 而不是把上游的状态码原样透出去：Python 在这一跳里是**网关**，
    上游挂了是我们的上游依赖问题，不是调用方的请求问题。但状态码会写进 message ——
    「明确报错」的要求是别把 500 吞成一句空话，不是把内部细节藏起来。

    Args:
        operation: 上游 operationId，便于定位是哪个渲染端点挂了。
        upstream_status: 上游 HTTP 状态码。
        hint: 可选的排障提示，会追加到 message 末尾。
    """
    message = f"Failed to render the resume PDF (upstream {operation} returned {upstream_status})."
    if hint:
        message = f"{message} {hint}"

    return OrpcError(
        status.HTTP_502_BAD_GATEWAY,
        "PDF_RENDER_FAILED",
        message,
    )


def renderer_unavailable(operation: str) -> OrpcError:
    """Node 渲染端点连不上 / 超时（服务没起、地址配错、渲染卡死）。

    Args:
        operation: 上游 operationId。
    """
    return OrpcError(
        status.HTTP_503_SERVICE_UNAVAILABLE,
        "PDF_RENDERER_UNAVAILABLE",
        f"The resume PDF renderer is unreachable (upstream {operation} did not respond). "
        "Check NODE_RENDER_BASE_URL and whether the Node server is running.",
    )


def _error_response(status_code: int, code: str, message: str, data: dict[str, Any] | None) -> JSONResponse:
    """把错误码组装成 JSON 响应。"""
    body = ErrorBody(defined=True, code=code, status=status_code, message=message, data=data)
    return JSONResponse(status_code=status_code, content=body.model_dump(mode="json"))


def install_exception_handlers(app: FastAPI) -> None:
    """挂上统一的错误处理器。

    Args:
        app: FastAPI 应用实例。
    """

    @app.exception_handler(OrpcError)
    async def _handle_orpc_error(_: Request, exc: OrpcError) -> JSONResponse:
        return _error_response(exc.status_code, exc.code, exc.message, exc.data)

    @app.exception_handler(HTTPException)
    async def _handle_http_exception(_: Request, exc: HTTPException) -> JSONResponse:
        code = _STATUS_TO_CODE.get(exc.status_code, "INTERNAL_SERVER_ERROR")
        return _error_response(exc.status_code, code, str(exc.detail), None)

    @app.exception_handler(RequestValidationError)
    async def _handle_validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        return _error_response(
            status.HTTP_400_BAD_REQUEST,
            "BAD_REQUEST",
            "The request payload is invalid.",
            # `errors()` 的 ctx 里可能带异常对象，先过一遍 jsonable_encoder 才能进 JSON。
            {"issues": jsonable_encoder(exc.errors())},
        )
