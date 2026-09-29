"""M5 · PDF 下载令牌 —— 与 Node `packages/api/src/features/resume/pdf-download-url.ts` 逐字节兼容。

为什么 Python 侧必须能自己签令牌
--------------------------------
Node 的 `GET /api/resumes/:id/pdf`（`apps/server/src/http/resume-pdf.ts`）只认
`?token=<签名令牌>`，没有它直接 401。Python 既要代理这个端点，就得掏出一个 Node 认的
令牌。读 Node 的实现可以确认它只需要三样东西：

    payload = base64url(JSON.stringify({ v, resumeId, userId, expiresAt, issuedAt }))
    token   = `${payload}.${HMAC-SHA256(key = AUTH_SECRET, msg = payload) 的 base64url}`

签名的输入里没有任何「只有前端 / 只有 Node 进程才知道」的上下文 —— `AUTH_SECRET` 是
唯一密钥。所以 Python 侧只要拿到**同一个** `AUTH_SECRET`，就能签出与 Node 一模一样的
令牌。这正是总纲 M6「两边环境变量名必须一字不差（尤其 `AUTH_SECRET`）」要兑现的地方：
它不只是一句规范，而是本次联调能否成立的**硬前提**。

为什么自签而不是「去 Node 换一个令牌」
--------------------------------------
Node 侧**没有**签发下载令牌的 HTTP 端点：`createResumePdfDownloadUrl` 只在 MCP 工具里
被内部调用（`packages/mcp/src/tools.ts:170`）。要让 Python 去换令牌就得给 Node 加接口，
撞上本轮「`apps/server` 一行不改」的约束。自签是唯一不动 Node 的路。

与 Node 的逐字节对齐点（改任一条都会让两边令牌对不上）
------------------------------------------------------
* `base64url` **不带** `=` 填充（Node `Buffer.toString("base64url")` 的行为）；
* payload 的 JSON 是紧凑格式（无空格），键顺序 `v / resumeId / userId / expiresAt / issuedAt`；
* 非 ASCII 不转义（`JSON.stringify` 不转义，所以这里用 `ensure_ascii=False`）；
* 时间戳是**毫秒** epoch。
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import math
import time
from dataclasses import dataclass
from datetime import datetime, timezone

from app.config import get_settings

#: 与 Node `MAX_PDF_DOWNLOAD_URL_TTL_SECONDS` 同值：令牌最长只能活 10 分钟。
MAX_PDF_DOWNLOAD_URL_TTL_SECONDS = 10 * 60

#: 与 Node `PdfDownloadTokenPayload["v"]` 同值。升版即视为不兼容，不再往下解析。
TOKEN_VERSION = 1


def _b64url_encode(raw: bytes) -> str:
    """编成 URL 安全的 base64 并剥掉 `=` 填充（对齐 Node 的 `base64url`）。

    Args:
        raw: 待编码的字节。

    Returns:
        不含填充字符的 base64url 字符串。
    """
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64url_decode(value: str) -> bytes:
    """`_b64url_encode` 的逆运算。

    Args:
        value: 不含填充的 base64url 字符串。

    Returns:
        解码后的字节。
    """
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _sign(payload: str, secret: str) -> str:
    """HMAC-SHA256 签名，输出 base64url（对应 Node 的 `sign()`）。

    Args:
        payload: 已编码的负载字符串（**不是**解码后的对象）。
        secret: HMAC 密钥，即 `AUTH_SECRET`。

    Returns:
        签名的 base64url 字符串。
    """
    digest = hmac.new(secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).digest()
    return _b64url_encode(digest)


def _resolve_secret(secret: str | None) -> str:
    """取签名密钥：显式传入优先，否则用配置里的 `AUTH_SECRET`。

    Args:
        secret: 显式密钥；None 表示回落到配置。

    Returns:
        非空的密钥字符串。

    Raises:
        ValueError: 密钥为空。空密钥签出来的令牌等于没有签名，静默放行比直接报错危险得多。
    """
    resolved = secret if secret is not None else get_settings().auth_secret
    if not resolved:
        raise ValueError(
            "AUTH_SECRET 为空，无法签发 PDF 下载令牌。"
            " 它必须与 Node 侧 `.env` 的 AUTH_SECRET **完全一致**，否则 Node 会 401 拒收。"
        )
    return resolved


def _resolve_ttl_seconds(ttl_seconds: float | None) -> int:
    """把 TTL 夹到 `[1, MAX_PDF_DOWNLOAD_URL_TTL_SECONDS]`（对齐 Node 的 `resolveTtlSeconds`）。"""
    if ttl_seconds is None or not math.isfinite(ttl_seconds):
        return MAX_PDF_DOWNLOAD_URL_TTL_SECONDS
    return min(max(math.floor(ttl_seconds), 1), MAX_PDF_DOWNLOAD_URL_TTL_SECONDS)


def _to_epoch_millis(value: datetime | None) -> int:
    """把时间折算成毫秒 epoch（naive 一律按 UTC 处理）。"""
    if value is None:
        return int(time.time() * 1000)
    aware = value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
    return int(aware.timestamp() * 1000)


def encode_token_payload(
    *,
    resume_id: str,
    user_id: str,
    issued_at_ms: int,
    expires_at_ms: int,
) -> str:
    """把令牌负载编成 base64url 字符串。

    Args:
        resume_id: 简历 id。
        user_id: 目标用户 id。
        issued_at_ms: 签发时刻（毫秒 epoch）。
        expires_at_ms: 过期时刻（毫秒 epoch）。

    Returns:
        base64url 编码的负载。
    """
    payload_object = {
        "v": TOKEN_VERSION,
        "resumeId": resume_id,
        "userId": user_id,
        "expiresAt": expires_at_ms,
        "issuedAt": issued_at_ms,
    }
    raw = json.dumps(payload_object, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return _b64url_encode(raw)


def create_resume_pdf_download_token(
    resume_id: str,
    user_id: str,
    *,
    secret: str | None = None,
    now: datetime | None = None,
    ttl_seconds: float | None = None,
) -> str:
    """签一个 Node `GET /api/resumes/:id/pdf` 会接受的下载令牌。

    Args:
        resume_id: 简历 id（Node 校验它必须和路径上的 id 一致）。
        user_id: 简历所有者 id（Node 用它去取简历，所以必须是 owner）。
        secret: HMAC 密钥；None 表示用配置里的 `AUTH_SECRET`。
        now: 签发时刻；None 表示当前时间。
        ttl_seconds: 期望存活秒数；None 或越界都回落到 10 分钟上限。

    Returns:
        形如 `<payload>.<signature>` 的令牌。

    Raises:
        ValueError: `AUTH_SECRET` 为空。
    """
    resolved_secret = _resolve_secret(secret)
    issued_at_ms = _to_epoch_millis(now)
    expires_at_ms = issued_at_ms + _resolve_ttl_seconds(ttl_seconds) * 1000

    payload = encode_token_payload(
        resume_id=resume_id,
        user_id=user_id,
        issued_at_ms=issued_at_ms,
        expires_at_ms=expires_at_ms,
    )
    return f"{payload}.{_sign(payload, resolved_secret)}"


@dataclass(frozen=True)
class PdfDownloadTokenPayload:
    """解出来的令牌负载。

    Attributes:
        resume_id: 简历 id。
        user_id: 目标用户 id。
        issued_at: 签发时刻（UTC）。
        expires_at: 过期时刻（UTC）。
    """

    resume_id: str
    user_id: str
    issued_at: datetime
    expires_at: datetime


def verify_resume_pdf_download_token(
    token: str,
    resume_id: str,
    *,
    secret: str | None = None,
    now: datetime | None = None,
) -> PdfDownloadTokenPayload | None:
    """校验一个（可能是 Node 签发的）下载令牌。

    生产路径只用 `create_resume_pdf_download_token`；这个函数是为了**反向**验签 ——
    把 Node 真实签出的令牌拿回来在 Python 侧验一遍，是「两边算法一致」最直接的证据，
    也是 `AUTH_SECRET` 配错时最快的定位手段。

    Args:
        token: 待校验的令牌。
        resume_id: 期望绑定的简历 id。
        secret: HMAC 密钥；None 表示用配置里的 `AUTH_SECRET`。
        now: 校验时刻；None 表示当前时间。

    Returns:
        校验通过返回负载；签名不符 / 结构非法 / 简历不匹配 / 已过期一律返回 None。
        Node 会细分 `malformed` / `invalid_signature` / `resume_mismatch` / `expired`
        四种原因，这里不区分：调用方拿到 None 的处置都一样（拒签重来），省掉一整套枚举。
    """
    resolved_secret = _resolve_secret(secret)
    parts = token.split(".")
    if len(parts) != 2:
        return None

    payload, signature = parts
    if not payload or not signature:
        return None
    # 定长比较，避免按字节短路泄露签名前缀。
    if not hmac.compare_digest(signature, _sign(payload, resolved_secret)):
        return None

    try:
        decoded = json.loads(_b64url_decode(payload).decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return None

    if not isinstance(decoded, dict):
        return None
    if decoded.get("v") != TOKEN_VERSION:
        return None

    token_resume_id = decoded.get("resumeId")
    token_user_id = decoded.get("userId")
    expires_at_ms = decoded.get("expiresAt")
    issued_at_ms = decoded.get("issuedAt")

    if not isinstance(token_resume_id, str) or not token_resume_id:
        return None
    if not isinstance(token_user_id, str) or not token_user_id:
        return None
    if isinstance(expires_at_ms, bool) or not isinstance(expires_at_ms, (int, float)):
        return None
    if isinstance(issued_at_ms, bool) or not isinstance(issued_at_ms, (int, float)):
        return None
    if token_resume_id != resume_id:
        return None
    if expires_at_ms <= _to_epoch_millis(now):
        return None

    utc = timezone.utc
    return PdfDownloadTokenPayload(
        resume_id=token_resume_id,
        user_id=token_user_id,
        issued_at=datetime.fromtimestamp(issued_at_ms / 1000, tz=utc),
        expires_at=datetime.fromtimestamp(expires_at_ms / 1000, tz=utc),
    )
