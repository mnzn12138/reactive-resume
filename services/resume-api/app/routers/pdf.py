"""M5 · PDF 出口 —— 代理到 Node 的内部渲染端点。

两个出口，对应 Node `apps/server/src/http/app.ts:54` 与 `:57`：

=============  =====================================  ======================================
路由            方法 + 路径                              说明
=============  =====================================  ======================================
私有下载         GET /resumes/{id}/pdf                  自签令牌 → 转发 `?token=` 那条路
公开下载         GET /resumes/{username}/{slug}/pdf     转发 Node 的公开渲染路径
=============  =====================================  ======================================

守住的四条边界
--------------

* **Python 侧不渲染**：总纲定死「渲染仍调 Node 内部端点，`packages/pdf` 一行不改」。
  这里只做「认人 → 判权 → 转发 → 把字节带回来」。
* **先认人再转发**：身份一律走 M3 的 `get_current_user_id`（cookie → `session JOIN user`），
  权限走 `app.resume_access`。Node 那边**还会再判一次**，但我们必须先判 —— 不能把一个
  「谁都能触发渲染」的出口暴露出去（渲染很贵，是可以被打成 DoS 的）。
* **不接管存储**：PDF 字节不过盘，Node 侧存不存、存哪儿与 Python 无关。
* **DOCX 不在这里**：Node 侧**没有**服务端 DOCX 端点（`apps/server/src` 里只有 PDF），
  DOCX 是前端客户端渲染的。所以本轮没有 DOCX 出口可联，只有 PDF。见 `docs/render-parity.md`。

刻意与 Node 对齐 / 不对齐的地方
-------------------------------

* **不重复限流**：Node 的 `handleResumePdfDownload` 这条 HTTP 通道本身**没有**挂
  `pdfExportRateLimit`（那只挂在 oRPC procedure 上），Python 侧也不加，保持一致。
  公开的限流在 Node 侧（`publicRenderRateLimiter`），Python 只是把 429 翻上来。
* **不写 downloads 统计**：Node 的公开 PDF 路径不自增下载数（`downloads` 由前端显式调
  `POST /resumes/{username}/{slug}/statistics/download`），Python 侧照做。
"""

from __future__ import annotations

from fastapi import APIRouter, Cookie, Depends, Request, Response
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.identity import SESSION_COOKIE_NAME, get_current_user_id
from app.pdf_token import create_resume_pdf_download_token
from app.render_proxy import DEFAULT_CONTENT_TYPE, RenderProxy, RenderedPdf, get_render_proxy
from app.resume_access import load_owned_resume, open_public_resume

router = APIRouter(prefix="/resumes", tags=["Resumes"])

#: `Content-Disposition` 里文件名要去掉的字符：引号会截断头，CR/LF 能造成响应拆分。
_UNSAFE_FILENAME_CHARS = str.maketrans({'"': "", "\r": "", "\n": "", "\\": ""})


def _pdf_response(rendered: RenderedPdf, *, fallback_filename: str) -> Response:
    """把上游结果折成 PDF 响应。

    `Content-Type` 只取 `;` 前的主体部分：上游可能带 `; charset=`，而验收要求
    `Content-Type` 就是 `application/pdf` —— 带参数会让某些客户端（以及断言）不认。

    Args:
        rendered: 上游渲染结果。
        fallback_filename: 上游没给 `Content-Disposition` 时用的文件名。

    Returns:
        PDF 响应。
    """
    content_type = rendered.content_type.split(";")[0].strip() or DEFAULT_CONTENT_TYPE
    content_disposition = rendered.content_disposition or (
        f'attachment; filename="{fallback_filename.translate(_UNSAFE_FILENAME_CHARS)}"'
    )

    return Response(
        content=rendered.body,
        media_type=content_type,
        headers={
            "Content-Disposition": content_disposition,
            # 与 Node 一致：PDF 里可能有私人信息，且每次渲染结果都可能不同，一律不缓存。
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


def _client_ip(request: Request) -> str | None:
    """取访客 IP，供 Node 的公开渲染限流分桶。

    Args:
        request: 当前请求。

    Returns:
        IP 字符串；拿不到（如 Unix socket）时返回 None。
    """
    return request.client.host if request.client else None


@router.get(
    "/{id}/pdf",
    operation_id="downloadResumePdf",
    summary="Download resume as PDF",
    description=(
        "Proxies the PDF rendering to the Node renderer and streams the bytes back. "
        "The Python side does not render: it authenticates the caller, checks ownership, "
        "signs a short-lived download token with AUTH_SECRET, and forwards to the Node "
        "endpoint that owns rendering. Requires authentication."
    ),
    response_class=Response,
    responses={
        200: {"content": {"application/pdf": {}}, "description": "The generated resume PDF."},
        502: {"description": "The upstream PDF renderer failed."},
        503: {"description": "The upstream PDF renderer is unreachable."},
    },
)
async def download_resume_pdf(
    id: str,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    proxy: RenderProxy = Depends(get_render_proxy),
) -> Response:
    """取当前用户某份简历的 PDF。

    Args:
        id: 路径上的简历 id。
        user_id: 由 `get_current_user_id` 注入，未认证会在依赖里直接 401。
        db: 数据库 Session。
        proxy: 渲染代理（测试里用 `dependency_overrides` 换成假实现）。

    Returns:
        PDF 响应。

    Raises:
        OrpcError: 401 未认证；404 不存在或不属于当前用户；502 / 503 上游问题。
    """
    resume = load_owned_resume(db, id, user_id)

    # Node 会用 payload 里的 userId 去再取一次简历，所以这里必须是 owner 的 id ——
    # 也正因为如此，令牌不能给前端复用：它是「这一次转发」的一次性凭据。
    token = create_resume_pdf_download_token(resume.id, user_id)
    rendered = await proxy.fetch_resume_pdf(resume.id, token)

    return _pdf_response(rendered, fallback_filename=f"{resume.slug}.pdf")


@router.get(
    "/{username}/{slug}/pdf",
    operation_id="downloadPublicResumePdf",
    summary="Download public resume as PDF",
    description=(
        "Proxies the public PDF rendering to the Node renderer. The resume must be public, "
        "and password-protected resumes require the resume access cookie. No authentication "
        "required for public resumes."
    ),
    response_class=Response,
    responses={
        200: {"content": {"application/pdf": {}}, "description": "The generated resume PDF."},
        401: {"description": "This resume is password protected."},
        502: {"description": "The upstream PDF renderer failed."},
        503: {"description": "The upstream PDF renderer is unreachable."},
    },
)
async def download_public_resume_pdf(
    username: str,
    slug: str,
    request: Request,
    db: Session = Depends(get_db),
    session_token: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
    proxy: RenderProxy = Depends(get_render_proxy),
) -> Response:
    """取公开简历的 PDF（按 username + slug）。

    与 `getResumeBySlug` 走**同一套**判定（`app.resume_access.open_public_resume`）：
    私有简历对陌生人 404、带密码且没验证过 401 `NEED_PASSWORD`、owner 不受限。

    Args:
        username: 简历所有者的用户名。
        slug: 简历 slug。
        request: 原始请求（读 `resume_access_<id>` cookie 与 `Cookie` 头）。
        db: 数据库 Session。
        session_token: cookie `better-auth.session_token`；公开页不强制。
        proxy: 渲染代理。

    Returns:
        PDF 响应。

    Raises:
        OrpcError: 404 不存在 / 不可见；401 需要密码；502 / 503 上游问题。
    """
    # 返回值对渲染没用（owner 与访客看到的是同一份 PDF），这里要的是它的授权副作用。
    open_public_resume(db, request, username=username, slug=slug, session_token=session_token)

    rendered = await proxy.fetch_public_resume_pdf(
        username,
        slug,
        cookie_header=request.headers.get("cookie", ""),
        client_ip=_client_ip(request),
    )

    return _pdf_response(rendered, fallback_filename=f"{slug}.pdf")
