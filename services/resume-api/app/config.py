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
        auth_secret: 与 Node 侧 `AUTH_SECRET` 完全一致，用于 HMAC pepper（与限流相关）。
        port: uvicorn 监听端口。
    """

    database_url: str = DEFAULT_DATABASE_URL
    auth_secret: str = ""
    port: int = DEFAULT_PORT

    def __post_init__(self) -> None:
        if not self.database_url.startswith(SUPPORTED_URL_PREFIXES):
            raise ValueError(
                f"DATABASE_URL 必须是 Postgres 连接串（postgresql+psycopg://...），当前值: {self.database_url!r}。"
                " 用 SQLite 会掩盖类型与 SQL 差异，本项目明确不支持。"
            )

    @classmethod
    def load(cls) -> "Settings":
        """读 .env + 环境变量，构造 Settings。"""
        _load_dotenv_files()
        return cls(
            database_url=os.environ.get("DATABASE_URL", DEFAULT_DATABASE_URL).strip(),
            auth_secret=os.environ.get("AUTH_SECRET", ""),
            port=int(os.environ.get("PORT", str(DEFAULT_PORT))),
        )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """返回（带缓存的）全局配置单例。"""
    return Settings.load()


settings: Settings = get_settings()
