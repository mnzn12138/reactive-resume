"""Resume API 的 FastAPI 应用入口。

M4 起挂上 `/resumes` 下的 7 个简历 CRUD / 公开页路由（见 `app/routers/resume.py`）；
M5 再加 2 个 PDF 出口（见 `app/routers/pdf.py`，转发给 Node 渲染，Python 侧不渲染）。
错误响应统一走 `app.errors` 里挂的 oRPC 信封。
"""

from __future__ import annotations

from fastapi import FastAPI

from app import __version__
from app.config import get_settings
from app.errors import install_exception_handlers
from app.routers.pdf import router as pdf_router
from app.routers.resume import router as resume_router

app = FastAPI(
    title="Resume API (Python)",
    version=__version__,
    description=(
        "Reactive Resume 的 Python 侧服务。M4 起提供「简历 CRUD + 公开简历页」这 7 个接口"
        "（listResumes / createResume / getResume / updateResume / patchResume / deleteResume / "
        "getResumeBySlug）；M5 起提供 2 个 PDF 出口（downloadResumePdf / downloadPublicResumePdf），"
        "二者都转发给 Node 渲染 —— 渲染与存储仍归 Node，Python 只做认人、判权与转发。"
        "其余能力（导入解析、统计、AI、Agent、鉴权）也在 Node 侧。"
    ),
)

install_exception_handlers(app)
# 顺序是有意的，**必须先挂 pdf_router**：
# `GET /resumes/{id}/pdf` 与 `getResumeBySlug` 的 `GET /resumes/{username}/{slug}` 都是
# 「/resumes 后跟两段」，Starlette 按注册顺序取第一个匹配的路由 —— 反过来挂的话，
# 私有 PDF 会被当成 `username=<id>, slug="pdf"` 而永远 404。
# 代价（已知取舍）：slug 恰好叫 `pdf` 的公开简历，其 `getResumeBySlug` 会被这条挡住。
# Node 侧没有这个问题，因为它的 oRPC 路径整体挂在 `/api/rpc/*` 下，不与之争。
app.include_router(pdf_router)
app.include_router(resume_router)


@app.get("/health", tags=["ops"], operation_id="getHealth", summary="健康检查")
def health() -> dict[str, str]:
    """存活探针，不触碰数据库。"""
    return {"status": "ok"}


def main() -> None:
    """`python -m app.main` 时的启动入口。"""
    import uvicorn

    uvicorn.run("app.main:app", host="127.0.0.1", port=get_settings().port, reload=True)


if __name__ == "__main__":
    main()
