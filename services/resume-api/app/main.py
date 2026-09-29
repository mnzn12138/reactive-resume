"""Resume API 的 FastAPI 应用入口。

M4 起挂上 `/resumes` 下的 7 个简历 CRUD / 公开页路由（见 `app/routers/resume.py`）。
错误响应统一走 `app.errors` 里挂的 oRPC 信封。
"""

from __future__ import annotations

from fastapi import FastAPI

from app import __version__
from app.config import get_settings
from app.errors import install_exception_handlers
from app.routers.resume import router as resume_router

app = FastAPI(
    title="Resume API (Python)",
    version=__version__,
    description=(
        "Reactive Resume 的 Python 侧服务。M4 起提供「简历 CRUD + 公开简历页」这 7 个接口"
        "（listResumes / createResume / getResume / updateResume / patchResume / deleteResume / "
        "getResumeBySlug）。其余能力（导入解析、渲染、统计、AI、Agent、鉴权）仍在 Node 侧。"
    ),
)

install_exception_handlers(app)
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
