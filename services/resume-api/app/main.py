"""Resume API 的 FastAPI 应用入口。

M3 阶段只提供健康检查；简历 CRUD 路由属于 M4（下一轮），本轮**不挂** `/resumes`。
"""

from __future__ import annotations

from fastapi import FastAPI

from app import __version__
from app.config import get_settings

app = FastAPI(
    title="Resume API (Python)",
    version=__version__,
    description="Reactive Resume 的 Python 侧服务。当前处于迁移地基阶段（M1~M3）：契约导出、Alembic 基线、取身份。",
)


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
