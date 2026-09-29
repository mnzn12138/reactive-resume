"""M5 · 转发到 Node 的内部渲染端点。

Python 侧**不渲染**任何东西 —— 总纲定死了「渲染仍调 Node 内部端点，`packages/pdf` 一行不改」。
所以这里的职责只有三件：发请求、判上游成败、把 PDF 字节原样带回来。

转发的两个目标（`apps/server/src/http/app.ts:54` 与 `:57`）：

* `GET /api/resumes/{id}/pdf?token=<自签令牌>` —— 私有下载，Node 会自己验签；
* `GET /api/resumes/{username}/{slug}/pdf` —— 公开下载，Node 会**再跑一遍**可见性与
  密码判定，所以原始 `Cookie` 必须原样带过去，否则带密码的公开简历会被 Node 拦在门外。

为什么不做连接复用
------------------
PDF 渲染本身要几百毫秒到几十秒（首次还要拉字体），一条 TCP 握手的开销可以忽略；
换来的是不必为 `AsyncClient` 的生命周期操心（进程内单例要挂在 lifespan 上才能干净关闭，
测试里更容易泄漏）。这里每次请求开一个 `async with` 的客户端，用完即关。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from functools import lru_cache
from urllib.parse import quote

import httpx

from app import errors
from app.config import get_settings

logger = logging.getLogger(__name__)

#: Node 没给 `Content-Type` 时的兜底值（`resume-pdf.ts` 自己也是这么兜的）。
DEFAULT_CONTENT_TYPE = "application/pdf"

#: PDF 魔数。`%PDF` 理论上允许出现在文件头 1024 字节内的任意位置，所以按前 1 KiB 查。
PDF_MAGIC = b"%PDF"
PDF_MAGIC_SEARCH_WINDOW = 1024

_PRIVATE_PDF_PATH = "/api/resumes/{resume_id}/pdf"
_PUBLIC_PDF_PATH = "/api/resumes/{username}/{slug}/pdf"

#: 上游非 200 时的排障提示。401 / 410 基本都是配置或时钟问题，光报状态码查不出来。
_UPSTREAM_HINTS: dict[int, str] = {
    401: "Node 拒收令牌：先核对两边 AUTH_SECRET 是否一字不差。",
    410: "Node 认为令牌已过期：核对两边系统时钟，以及令牌 TTL 是否被压到 0。",
    429: "Node 侧公开渲染限流已触发。",
}


@dataclass(frozen=True)
class RenderedPdf:
    """Node 渲染出来的 PDF。

    Attributes:
        body: PDF 字节。
        content_type: 上游给的 `Content-Type`，可能带参数（如 `; charset=`）。
        content_disposition: 上游给的 `Content-Disposition`，可能为空串。
    """

    body: bytes
    content_type: str
    content_disposition: str


def _upstream_error(operation: str, status_code: int) -> errors.OrpcError:
    """把上游的非 200 翻成一个明确的错误。

    Args:
        operation: 上游 operationId，只为让报错能定位到具体端点。
        status_code: 上游 HTTP 状态码。

    Returns:
        待抛出的 `OrpcError`。
    """
    hint = _UPSTREAM_HINTS.get(status_code, "")
    message = f"Upstream resume PDF renderer failed ({operation} returned {status_code})."
    if hint:
        message = f"{message} {hint}"

    if status_code == 404:
        # Python 侧已经确认过这份简历存在且属于当前用户，上游 404 只可能是「我们查完到
        # Node 渲染之间简历被删了」。对调用方而言这跟「本来就没有」是同一件事，照 404 回。
        return errors.resume_not_found()
    if status_code == 429:
        return errors.too_many_requests()
    return errors.pdf_render_failed(operation, status_code, hint)


class RenderProxy:
    """把渲染请求转发给 Node。

    Attributes:
        base_url: Node 服务根地址，来自配置 `NODE_RENDER_BASE_URL`。
        timeout_seconds: 单次转发的上限等待时间。
        transport: 可选的 httpx transport。**只给测试用**（`httpx.MockTransport`）：
            上游状态码映射（404 / 429 / 502 / 503）是这份代码的核心职责之一，
            不注入 transport 就得真起一个 HTTP 服务才能覆盖。
    """

    def __init__(
        self,
        base_url: str,
        timeout_seconds: float,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds
        self._transport = transport

    async def fetch_resume_pdf(self, resume_id: str, token: str) -> RenderedPdf:
        """取私有简历的 PDF（走 `?token=` 那条路）。

        Args:
            resume_id: 简历 id。
            token: `app.pdf_token` 自签的下载令牌。

        Returns:
            渲染结果。

        Raises:
            OrpcError: 404 上游查不到；429 上游限流；502 上游失败；503 上游不可达。
        """
        path = _PRIVATE_PDF_PATH.format(resume_id=quote(resume_id, safe=""))
        return await self._get(path, params={"token": token}, operation="downloadResumePdf")

    async def fetch_public_resume_pdf(
        self,
        username: str,
        slug: str,
        *,
        cookie_header: str = "",
        client_ip: str | None = None,
    ) -> RenderedPdf:
        """取公开简历的 PDF。

        为什么必须把原始 `Cookie` 带过去：Node 的 `createPublicResumePdf` 会重新跑一遍
        `assertCanView` 与密码校验（`public-pdf.ts:69-78`）。Python 侧已经判过一次，但
        Node 是独立判的 —— 没有 `resume_access_<id>` cookie 它就会回 401 NEED_PASSWORD。

        Args:
            username: 简历所有者的用户名。
            slug: 简历 slug。
            cookie_header: 原始请求的 `Cookie` 头，原样转发。
            client_ip: 访客 IP，写进 `X-Forwarded-For` 供 Node 的渲染限流分桶。

        Returns:
            渲染结果。

        Raises:
            OrpcError: 同 `fetch_resume_pdf`。
        """
        headers: dict[str, str] = {}
        if cookie_header:
            headers["Cookie"] = cookie_header
        if client_ip:
            headers["X-Forwarded-For"] = client_ip

        path = _PUBLIC_PDF_PATH.format(username=quote(username, safe=""), slug=quote(slug, safe=""))
        return await self._get(path, headers=headers, operation="downloadPublicResumePdf")

    async def _get(
        self,
        path: str,
        *,
        params: dict[str, str] | None = None,
        headers: dict[str, str] | None = None,
        operation: str,
    ) -> RenderedPdf:
        """发 GET 并把响应折成 `RenderedPdf`。

        Args:
            path: 相对 `base_url` 的路径。
            params: query 参数。
            headers: 额外请求头。
            operation: 上游 operationId，用于日志与报错。

        Returns:
            渲染结果。

        Raises:
            OrpcError: 502 上游失败或返回了非 PDF 内容；503 上游不可达 / 超时。
        """
        async with httpx.AsyncClient(
            base_url=self.base_url, timeout=self.timeout_seconds, transport=self._transport
        ) as client:
            try:
                response = await client.get(path, params=params, headers=headers)
            except httpx.HTTPError as error:
                logger.error("[render-proxy] 上游不可达 operation=%s error=%r", operation, error)
                raise errors.renderer_unavailable(operation) from error

        if response.status_code != 200:
            logger.error(
                "[render-proxy] 上游返回非 200 operation=%s status=%s",
                operation,
                response.status_code,
            )
            raise _upstream_error(operation, response.status_code)

        body = response.content
        # 上游 200 但给了 HTML 错误页，比直接报错更糟糕：调用方会拿到一个「成功」的假 PDF。
        # 所以这里再验一次魔数，把「Node 的 500 被吞掉」这条路彻底堵上。
        if PDF_MAGIC not in body[:PDF_MAGIC_SEARCH_WINDOW]:
            logger.error(
                "[render-proxy] 上游返回了非 PDF 内容 operation=%s content_type=%s bytes=%d",
                operation,
                response.headers.get("content-type"),
                len(body),
            )
            raise errors.pdf_render_failed(operation, response.status_code, "上游返回的内容不是 PDF。")

        return RenderedPdf(
            body=body,
            content_type=response.headers.get("content-type", DEFAULT_CONTENT_TYPE),
            content_disposition=response.headers.get("content-disposition", ""),
        )


@lru_cache(maxsize=1)
def get_render_proxy() -> RenderProxy:
    """FastAPI 依赖：返回渲染代理单例（配置在进程启动时读定）。"""
    settings = get_settings()
    return RenderProxy(
        base_url=settings.node_render_base_url,
        timeout_seconds=settings.node_render_timeout_seconds,
    )
