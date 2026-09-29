"""M5 · PDF 出口的用例。

分两层，各自覆盖不同的失败面：

* **代理层**（`RenderProxy`）：用 `httpx.MockTransport` 注入假上游，测**状态码映射**与
  PDF 魔数校验 —— 也就是「不能把 Node 的 500 原样吞掉」这条要求。这一层不碰数据库。
* **路由层**（`app/routers/pdf.py`）：用一个替身代理，测**认人与判权**（401 / 404 /
  401 NEED_PASSWORD）以及响应头透传。

真实联调（Python 转发到真起着的 Node 服务、拿回真 PDF）不在这里 —— 它需要 Node 服务
与一次几百毫秒到几十秒的渲染，属于手动验收，结论记在 `docs/render-parity.md`。
"""

from __future__ import annotations

import asyncio
import hashlib
from collections.abc import Callable
from dataclasses import dataclass, field

import httpx
import pytest
from fastapi.testclient import TestClient

from app import errors
from app.db.models import Resume, User
from app.db.session import get_db
from app.identity import SESSION_COOKIE_NAME
from app.pdf_token import verify_resume_pdf_download_token
from app.render_proxy import RenderProxy, RenderedPdf, get_render_proxy
from app.resume_access import RESUME_ACCESS_COOKIE_PREFIX

#: 最短的合法 PDF 骨架 —— 用例只关心「拿到的是不是 PDF 字节」，不关心内容。
PDF_BYTES = b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"

RESUME_ID = "resume-under-test"


def _run(coro):
    """跑一个协程（代理层的用例都是同步外壳 + `asyncio.run`）。"""
    return asyncio.run(coro)


# ---------------------------------------------------------------------------
# 替身代理
# ---------------------------------------------------------------------------


@dataclass
class StubRenderProxy:
    """不发真实 HTTP 的代理替身，把「该返回什么 / 该炸什么」交给用例决定。

    Attributes:
        result: 直接返回的结果。
        failure: 非 None 时直接抛它（模拟上游失败 / 不可达）。
        calls: 记录下来的调用参数，供断言。
    """

    result: RenderedPdf = field(
        default_factory=lambda: RenderedPdf(
            body=PDF_BYTES,
            content_type="application/pdf",
            content_disposition='attachment; filename="zhangsan-cv.pdf"',
        )
    )
    failure: Exception | None = None
    calls: list[tuple] = field(default_factory=list)

    async def fetch_resume_pdf(self, resume_id: str, token: str) -> RenderedPdf:
        """记录参数并返回预设结果。"""
        self.calls.append(("private", resume_id, token))
        return self._respond()

    async def fetch_public_resume_pdf(
        self,
        username: str,
        slug: str,
        *,
        cookie_header: str = "",
        client_ip: str | None = None,
    ) -> RenderedPdf:
        """记录参数并返回预设结果。"""
        self.calls.append(("public", username, slug, cookie_header, client_ip))
        return self._respond()

    def _respond(self) -> RenderedPdf:
        if self.failure is not None:
            raise self.failure
        return self.result


@pytest.fixture()
def stub_proxy(api_client: TestClient) -> StubRenderProxy:
    """把路由里的渲染代理换成替身。"""
    proxy = StubRenderProxy()
    api_client.app.dependency_overrides[get_render_proxy] = lambda: proxy
    return proxy


def _username_of(api_client: TestClient, user_id: str) -> str:
    """取某个 user id 的用户名（公开路径是 username + slug，不是 id）。"""
    db = api_client.app.dependency_overrides[get_db]()
    return db.get(User, user_id).username


# ---------------------------------------------------------------------------
# 代理层：状态码映射与 PDF 魔数
# ---------------------------------------------------------------------------


def _proxy(handler: Callable[[httpx.Request], httpx.Response]) -> RenderProxy:
    """搭一个把请求交给 `handler` 的 RenderProxy（不产生真实网络流量）。"""
    return RenderProxy(
        base_url="http://node.test",
        timeout_seconds=5.0,
        transport=httpx.MockTransport(handler),
    )


def test_proxy_returns_pdf_bytes_on_200() -> None:
    """上游 200 + PDF 字节 → 原样带回，并把两个头透传出来。"""
    proxy = _proxy(
        lambda request: httpx.Response(
            200,
            content=PDF_BYTES,
            headers={
                "Content-Type": "application/pdf",
                "Content-Disposition": 'attachment; filename="cv.pdf"',
            },
        )
    )

    rendered = _run(proxy.fetch_resume_pdf(RESUME_ID, "token"))

    assert rendered.body == PDF_BYTES
    assert rendered.content_type == "application/pdf"
    assert rendered.content_disposition == 'attachment; filename="cv.pdf"'


@pytest.mark.parametrize(
    ("upstream_status", "expected_status", "expected_code", "quotes_upstream_status"),
    [
        # 502 这一档必须把上游状态码写进 message —— 这是「不把 Node 的 500 吞掉」的落点。
        (500, 502, "PDF_RENDER_FAILED", True),
        (502, 502, "PDF_RENDER_FAILED", True),
        (503, 502, "PDF_RENDER_FAILED", True),
        (401, 502, "PDF_RENDER_FAILED", True),
        (410, 502, "PDF_RENDER_FAILED", True),
        # 这两档语义明确（上游说没有 / 上游说太频繁），直接沿用 Node 的既有文案。
        (404, 404, "NOT_FOUND", False),
        (429, 429, "TOO_MANY_REQUESTS", False),
    ],
)
def test_proxy_maps_upstream_status_codes(
    upstream_status: int,
    expected_status: int,
    expected_code: str,
    quotes_upstream_status: bool,
) -> None:
    """上游非 200 → 明确的错误，没有一档被吞成笼统的 500。"""
    proxy = _proxy(lambda request: httpx.Response(upstream_status, text="boom"))

    with pytest.raises(errors.OrpcError) as caught:
        _run(proxy.fetch_resume_pdf(RESUME_ID, "token"))

    assert caught.value.status_code == expected_status
    assert caught.value.code == expected_code
    assert (str(upstream_status) in caught.value.message) is quotes_upstream_status


def test_proxy_hints_at_auth_secret_when_node_rejects_the_token() -> None:
    """上游 401 时给出 `AUTH_SECRET` 的排障提示 —— 光报状态码定位不到原因。"""
    proxy = _proxy(lambda request: httpx.Response(401, text="Unauthorized"))

    with pytest.raises(errors.OrpcError) as caught:
        _run(proxy.fetch_resume_pdf(RESUME_ID, "token"))

    assert "AUTH_SECRET" in caught.value.message


def test_proxy_rejects_non_pdf_body_on_200() -> None:
    """上游 200 但给了 HTML 错误页 → 502，而不是把一个假 PDF 当成功返回。"""
    proxy = _proxy(
        lambda request: httpx.Response(200, text="<html>500 Internal Server Error</html>")
    )

    with pytest.raises(errors.OrpcError) as caught:
        _run(proxy.fetch_resume_pdf(RESUME_ID, "token"))

    assert caught.value.status_code == 502
    assert caught.value.code == "PDF_RENDER_FAILED"


def test_proxy_reports_503_when_node_is_unreachable() -> None:
    """Node 没起 / 地址配错 → 503（与「渲染失败」的 502 区分开）。"""

    def _boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    proxy = _proxy(_boom)

    with pytest.raises(errors.OrpcError) as caught:
        _run(proxy.fetch_resume_pdf(RESUME_ID, "token"))

    assert caught.value.status_code == 503
    assert caught.value.code == "PDF_RENDERER_UNAVAILABLE"


def test_proxy_url_encodes_path_segments() -> None:
    """路径段要 URL 编码 —— 用户名 / slug 里出现空格或 `/` 时不能把 URL 打歪。"""
    seen: list[str] = []

    def _capture(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        return httpx.Response(200, content=PDF_BYTES, headers={"Content-Type": "application/pdf"})

    proxy = _proxy(_capture)
    _run(proxy.fetch_public_resume_pdf("zhang san", "my/cv"))

    assert seen == ["http://node.test/api/resumes/zhang%20san/my%2Fcv/pdf"]


# ---------------------------------------------------------------------------
# 路由层：私有下载 `GET /resumes/{id}/pdf`
# ---------------------------------------------------------------------------


def test_download_resume_pdf_returns_pdf_bytes(
    api_client: TestClient,
    authed: str,
    resume_factory: Callable[..., Resume],
    stub_proxy: StubRenderProxy,
) -> None:
    """happy path：拿到 PDF 字节，且 `Content-Type` / `Content-Disposition` 透传正确。"""
    resume = resume_factory(user_id=authed)

    response = api_client.get(f"/resumes/{resume.id}/pdf")

    assert response.status_code == 200
    assert response.content == PDF_BYTES
    assert response.headers["content-type"] == "application/pdf"
    assert response.headers["content-disposition"] == 'attachment; filename="zhangsan-cv.pdf"'
    # 与 Node 一致：私人内容不缓存，且不许浏览器嗅探类型。
    assert response.headers["cache-control"] == "private, no-store"
    assert response.headers["x-content-type-options"] == "nosniff"


def test_download_resume_pdf_signs_a_token_for_the_owner(
    api_client: TestClient,
    authed: str,
    resume_factory: Callable[..., Resume],
    stub_proxy: StubRenderProxy,
) -> None:
    """转发用的令牌必须绑「这份简历」+「owner 的 user id」，且能被 Python 自己验过。

    为什么钉这条：Node 会用 payload 里的 `userId` 再取一次简历，绑错人就是 404；
    绑错简历则是 Node 的 `resume_mismatch` 401。
    """
    resume = resume_factory(user_id=authed)

    api_client.get(f"/resumes/{resume.id}/pdf")

    assert len(stub_proxy.calls) == 1
    kind, forwarded_resume_id, token = stub_proxy.calls[0]
    assert kind == "private"
    assert forwarded_resume_id == resume.id

    payload = verify_resume_pdf_download_token(token, resume.id)
    assert payload is not None
    assert payload.user_id == authed


def test_download_resume_pdf_requires_authentication(
    api_client: TestClient,
    resume_factory: Callable[..., Resume],
    user_id: str,
    stub_proxy: StubRenderProxy,
) -> None:
    """没有会话 cookie → 401，且**不触发**任何上游渲染（渲染很贵，不能被匿名打）。"""
    resume = resume_factory(user_id=user_id)

    response = api_client.get(f"/resumes/{resume.id}/pdf")

    assert response.status_code == 401
    assert response.json()["code"] == "UNAUTHORIZED"
    assert stub_proxy.calls == []


def test_download_resume_pdf_of_another_user_returns_404(
    api_client: TestClient,
    authed: str,
    user_factory: Callable[..., User],
    resume_factory: Callable[..., Resume],
    stub_proxy: StubRenderProxy,
) -> None:
    """别人的简历 → 404（不是 403，与 Node `assertCanView` 一致）。"""
    stranger_resume = resume_factory(user_id=user_factory().id)

    response = api_client.get(f"/resumes/{stranger_resume.id}/pdf")

    assert response.status_code == 404
    assert stub_proxy.calls == []


def test_download_resume_pdf_unknown_id_returns_404(
    api_client: TestClient, authed: str, stub_proxy: StubRenderProxy
) -> None:
    """不存在的 id → 404。"""
    response = api_client.get("/resumes/does-not-exist/pdf")

    assert response.status_code == 404
    assert stub_proxy.calls == []


def test_download_resume_pdf_maps_upstream_failure_to_502(
    api_client: TestClient,
    authed: str,
    resume_factory: Callable[..., Resume],
    stub_proxy: StubRenderProxy,
) -> None:
    """上游渲染失败 → 502，报错里带着上游状态码（不是一句笼统的 500）。"""
    resume = resume_factory(user_id=authed)
    stub_proxy.failure = errors.pdf_render_failed("downloadResumePdf", 500, "上游返回的内容不是 PDF。")

    response = api_client.get(f"/resumes/{resume.id}/pdf")

    assert response.status_code == 502
    assert response.json()["code"] == "PDF_RENDER_FAILED"
    assert "500" in response.json()["message"]


def test_download_resume_pdf_maps_unreachable_upstream_to_503(
    api_client: TestClient,
    authed: str,
    resume_factory: Callable[..., Resume],
    stub_proxy: StubRenderProxy,
) -> None:
    """Node 不可达 → 503，把「没起服务 / 地址配错」和「渲染失败」区分开。"""
    resume = resume_factory(user_id=authed)
    stub_proxy.failure = errors.renderer_unavailable("downloadResumePdf")

    response = api_client.get(f"/resumes/{resume.id}/pdf")

    assert response.status_code == 503
    assert response.json()["code"] == "PDF_RENDERER_UNAVAILABLE"


def test_download_resume_pdf_falls_back_to_slug_filename(
    api_client: TestClient,
    authed: str,
    resume_factory: Callable[..., Resume],
    stub_proxy: StubRenderProxy,
) -> None:
    """上游没给 `Content-Disposition` 时用 slug 兜底，避免响应缺头。"""
    resume = resume_factory(user_id=authed, slug="my-cv")
    stub_proxy.result = RenderedPdf(
        body=PDF_BYTES, content_type="application/pdf", content_disposition=""
    )

    response = api_client.get(f"/resumes/{resume.id}/pdf")

    assert response.status_code == 200
    assert response.headers["content-disposition"] == 'attachment; filename="my-cv.pdf"'


def test_download_resume_pdf_strips_charset_from_content_type(
    api_client: TestClient,
    authed: str,
    resume_factory: Callable[..., Resume],
    stub_proxy: StubRenderProxy,
) -> None:
    """`Content-Type` 只取 `;` 前的主体，保证它就是 `application/pdf`。"""
    resume = resume_factory(user_id=authed)
    stub_proxy.result = RenderedPdf(
        body=PDF_BYTES,
        content_type="application/pdf; charset=binary",
        content_disposition='attachment; filename="cv.pdf"',
    )

    response = api_client.get(f"/resumes/{resume.id}/pdf")

    assert response.headers["content-type"] == "application/pdf"


# ---------------------------------------------------------------------------
# 路由层：公开下载 `GET /resumes/{username}/{slug}/pdf`
# ---------------------------------------------------------------------------


def test_download_public_resume_pdf_returns_pdf_bytes(
    api_client: TestClient,
    resume_factory: Callable[..., Resume],
    user_id: str,
    stub_proxy: StubRenderProxy,
) -> None:
    """公开简历不需要登录，直接返回 PDF。"""
    username = _username_of(api_client, user_id)
    resume = resume_factory(user_id=user_id, slug="public-cv", is_public=True)

    response = api_client.get(f"/resumes/{username}/{resume.slug}/pdf")

    assert response.status_code == 200
    assert response.content == PDF_BYTES
    assert response.headers["content-type"] == "application/pdf"


def test_download_public_resume_pdf_forwards_cookies_to_node(
    api_client: TestClient,
    resume_factory: Callable[..., Resume],
    user_id: str,
    stub_proxy: StubRenderProxy,
) -> None:
    """原始 `Cookie` 必须原样转发 —— Node 会**再判一次**密码，没有 cookie 它会 401。

    这是最容易漏的一处：Python 侧明明已经放行，Node 却因为拿不到 `resume_access_<id>`
    cookie 把请求挡回去，表现为「公开 PDF 偶尔 401」。
    """
    username = _username_of(api_client, user_id)
    password_hash = "hashed-secret"
    resume = resume_factory(
        user_id=user_id, slug="locked-cv", is_public=True, password=password_hash
    )

    access_value = hashlib.sha256(f"{resume.id}:{password_hash}".encode("utf-8")).hexdigest()
    api_client.cookies.set(f"{RESUME_ACCESS_COOKIE_PREFIX}_{resume.id}", access_value)

    response = api_client.get(f"/resumes/{username}/{resume.slug}/pdf")

    assert response.status_code == 200
    forwarded_cookie = stub_proxy.calls[0][3]
    assert f"{RESUME_ACCESS_COOKIE_PREFIX}_{resume.id}={access_value}" in forwarded_cookie


def test_download_public_resume_pdf_password_protected_returns_401(
    api_client: TestClient,
    resume_factory: Callable[..., Resume],
    user_id: str,
    stub_proxy: StubRenderProxy,
) -> None:
    """带密码且访客没验证过 → 401 `NEED_PASSWORD`，与 `getResumeBySlug` 同一套判定。"""
    username = _username_of(api_client, user_id)
    resume = resume_factory(
        user_id=user_id, slug="locked-cv", is_public=True, password="hashed-secret"
    )

    response = api_client.get(f"/resumes/{username}/{resume.slug}/pdf")

    assert response.status_code == 401
    assert response.json()["code"] == "NEED_PASSWORD"
    assert stub_proxy.calls == []


def test_download_public_resume_pdf_private_to_stranger_returns_404(
    api_client: TestClient,
    resume_factory: Callable[..., Resume],
    user_id: str,
    stub_proxy: StubRenderProxy,
) -> None:
    """非公开简历对陌生人 → 404（与「不存在」同码，不泄露它存在）。"""
    username = _username_of(api_client, user_id)
    resume_factory(user_id=user_id, slug="private-cv", is_public=False)

    response = api_client.get(f"/resumes/{username}/private-cv/pdf")

    assert response.status_code == 404
    assert stub_proxy.calls == []


def test_download_public_resume_pdf_owner_can_fetch_private_resume(
    api_client: TestClient,
    authed: str,
    resume_factory: Callable[..., Resume],
    stub_proxy: StubRenderProxy,
) -> None:
    """owner 自看不受 `isPublic` 限制（带会话 cookie 时能拿到自己的私有简历）。"""
    username = _username_of(api_client, authed)
    resume = resume_factory(user_id=authed, slug="private-cv", is_public=False)

    response = api_client.get(f"/resumes/{username}/{resume.slug}/pdf")

    assert response.status_code == 200


def test_download_public_resume_pdf_unknown_slug_returns_404(
    api_client: TestClient, user_id: str, stub_proxy: StubRenderProxy
) -> None:
    """用户名或 slug 不存在 → 404。"""
    username = _username_of(api_client, user_id)

    response = api_client.get(f"/resumes/{username}/no-such-cv/pdf")

    assert response.status_code == 404
    assert stub_proxy.calls == []


def test_session_cookie_is_forwarded_for_owner(
    api_client: TestClient,
    authed: str,
    resume_factory: Callable[..., Resume],
    stub_proxy: StubRenderProxy,
) -> None:
    """owner 走公开路径时，会话 cookie 也要带过去（Node 侧用它认人）。"""
    username = _username_of(api_client, authed)
    resume = resume_factory(user_id=authed, slug="private-cv", is_public=False)

    api_client.get(f"/resumes/{username}/{resume.slug}/pdf")

    forwarded_cookie = stub_proxy.calls[0][3]
    assert SESSION_COOKIE_NAME in forwarded_cookie


def test_pdf_routes_never_render_for_anonymous_callers(
    api_client: TestClient,
    resume_factory: Callable[..., Resume],
    user_id: str,
    stub_proxy: StubRenderProxy,
) -> None:
    """两条出口在匿名下都不能触发渲染 —— 渲染是最贵的操作，不能被匿名打成 DoS。"""
    username = _username_of(api_client, user_id)
    resume = resume_factory(user_id=user_id, slug="cv", is_public=False)

    assert api_client.get(f"/resumes/{resume.id}/pdf").status_code == 401
    assert api_client.get(f"/resumes/{username}/cv/pdf").status_code == 404
    assert stub_proxy.calls == []
