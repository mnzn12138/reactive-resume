"""服务配置。

环境变量名必须和 Node 侧（仓库根 `.env`）**一字不差**，尤其是 `AUTH_SECRET`：
它是手机号 / IP 的 HMAC pepper，两边不一致会导致限流失效。

读取顺序：进程环境变量 > 仓库根 `.env` > 本服务目录 `.env` > 代码内默认值。
（dotenv 用 `override=False`，所以永远是真实环境变量优先。）
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

SERVICE_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = SERVICE_ROOT.parents[1]

DEFAULT_DATABASE_URL = "postgresql+psycopg://postgres:postgres@127.0.0.1:5432/postgres"
DEFAULT_PORT = 4000
SUPPORTED_URL_PREFIXES = ("postgresql", "postgres")

#: M5：渲染仍由 Node 负责，Python 只转发。默认指向本机 Node（`apps/server` 的 dev 端口）。
DEFAULT_NODE_RENDER_BASE_URL = "http://127.0.0.1:3000"

#: 渲染一次 PDF 可能要很久：实测**冷启动（首次渲染要去拉 CJK 字体）58 秒**，热身后 ~1 秒。
#: 60 秒会刚好卡在冷启动的边缘上（实测有一轮就是 58.3s vs 60s 超时而 503），所以给 120 秒。
DEFAULT_NODE_RENDER_TIMEOUT_SECONDS = 120.0


def _load_dotenv_files() -> None:
    """按「仓库根 → 服务目录」顺序加载 .env，不覆盖已有的进程环境变量。"""
    for candidate in (REPO_ROOT / ".env", SERVICE_ROOT / ".env"):
        if candidate.is_file():
            load_dotenv(candidate, override=False)


@dataclass(frozen=True)
class Settings:
    """运行期配置。

    Attributes:
        database_url: SQLAlchemy 数据库连接串，形如
            `postgresql+psycopg://postgres:postgres@127.0.0.1:5432/postgres`。
        auth_secret: 与 Node 侧 `AUTH_SECRET` 完全一致。两处用到：限流的 HMAC pepper，
            以及 M5 的 PDF 下载令牌签名（不一致 Node 会 401 拒收）。
        port: uvicorn 监听端口。
        node_render_base_url: Node 服务根地址，Python 侧转发 PDF 渲染请求时用。
        node_render_timeout_seconds: 单次渲染转发的超时秒数。
    """

    database_url: str = DEFAULT_DATABASE_URL
    auth_secret: str = ""
    port: int = DEFAULT_PORT
    node_render_base_url: str = DEFAULT_NODE_RENDER_BASE_URL
    node_render_timeout_seconds: float = DEFAULT_NODE_RENDER_TIMEOUT_SECONDS

    def __post_init__(self) -> None:
        if not self.database_url.startswith(SUPPORTED_URL_PREFIXES):
            raise ValueError(
                f"DATABASE_URL 必须是 Postgres 连接串（postgresql+psycopg://...），当前值: {self.database_url!r}。"
                " 用 SQLite 会掩盖类型与 SQL 差异，本项目明确不支持。"
            )
        if not self.node_render_base_url.strip():
            raise ValueError("NODE_RENDER_BASE_URL 不能为空：没有它 Python 侧无法转发渲染请求。")

    @classmethod
    def load(cls) -> "Settings":
        """读 .env + 环境变量，构造 Settings。"""
        _load_dotenv_files()
        return cls(
            database_url=os.environ.get("DATABASE_URL", DEFAULT_DATABASE_URL).strip(),
            auth_secret=os.environ.get("AUTH_SECRET", ""),
            port=int(os.environ.get("PORT", str(DEFAULT_PORT))),
            node_render_base_url=os.environ.get(
                "NODE_RENDER_BASE_URL", DEFAULT_NODE_RENDER_BASE_URL
            ).strip()
            or DEFAULT_NODE_RENDER_BASE_URL,
            node_render_timeout_seconds=float(
                os.environ.get(
                    "NODE_RENDER_TIMEOUT_SECONDS", str(DEFAULT_NODE_RENDER_TIMEOUT_SECONDS)
                )
            ),
        )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """返回（带缓存的）全局配置单例。"""
    return Settings.load()


settings: Settings = get_settings()
