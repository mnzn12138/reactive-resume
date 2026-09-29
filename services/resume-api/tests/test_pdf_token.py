"""M5 · PDF 下载令牌的用例。

这份签名是照 Node `pdf-download-url.ts` **重刻**的，而重刻的东西最容易在「看起来对」
的情况下悄悄漂移（base64url 填充、`JSON.stringify` 的紧凑度、毫秒 vs 秒……）。所以这里
除了常规的 round-trip，还钉了两类**互签**证据：

* `test_node_signed_token_is_accepted`：Node **真实**实现签出来的令牌（见文件末尾常量
  的注释，说明它是怎么产出来的），Python 侧必须验得过；
* `test_node_accepts_python_signed_token`：Python 签的令牌交给 Node 真实实现去验，
  必须 `ok: true`。这条需要本机有 Node + `apps/server` 的依赖，没有就 skip。

只做「Python 自签自验」是自证，证明不了 Node 认不认 —— 而生产链路正是
「Python 签、Node 验」。
"""

from __future__ import annotations

import os
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

import pytest

from app.pdf_token import (
    MAX_PDF_DOWNLOAD_URL_TTL_SECONDS,
    create_resume_pdf_download_token,
    verify_resume_pdf_download_token,
)

SERVICE_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = SERVICE_ROOT.parents[1]
NODE_PARITY_SCRIPT = SERVICE_ROOT / "tools" / "verify_pdf_token_parity.mjs"
NODE_SERVER_DIR = REPO_ROOT / "apps" / "server"

#: conftest 里写死的测试用 AUTH_SECRET（不是真密钥）。
TEST_SECRET = "test-auth-secret-do-not-use-in-prod"

RESUME_ID = "resume-fixture-0001"
USER_ID = "user-fixture-0001"

# Node 真实实现 `createResumePdfDownloadUrl` 的产物。复现方式：
#   cd apps/server
#   AUTH_SECRET=test-auth-secret-do-not-use-in-prod \
#     node --import tsx services/resume-api/tools/verify_pdf_token_parity.mjs \
#          --make resume-fixture-0001 user-fixture-0001 600
# 令牌带 10 分钟 TTL，所以下面两条用例用**冻结**的时刻去验，不碰真实时钟。
NODE_SIGNED_TOKEN = (
    "eyJ2IjoxLCJyZXN1bWVJZCI6InJlc3VtZS1maXh0dXJlLTAwMDEiLCJ1c2VySWQiOiJ1c2VyLWZpeHR1cmUt"
    "MDAwMSIsImV4cGlyZXNBdCI6MTc5MDY5Njc2Nzk4OSwiaXNzdWVkQXQiOjE3OTA2OTYxNjc5ODl9"
    ".tUd5AtoPIHEEYWzC5hp3nijG446nzgWCYWz9W6eEfTc"
)
NODE_SIGNED_ISSUED_AT_MS = 1790696167989
NODE_SIGNED_EXPIRES_AT_MS = 1790696767989


def _at(epoch_millis: int) -> datetime:
    """把毫秒 epoch 折成带时区的 datetime（供 `now=` 参数冻结时钟）。"""
    return datetime.fromtimestamp(epoch_millis / 1000, tz=timezone.utc)


# ---------------------------------------------------------------------------
# 形状与 round-trip
# ---------------------------------------------------------------------------


def test_token_is_payload_dot_signature_without_padding() -> None:
    """令牌是 `<base64url 负载>.<base64url 签名>`，两段都**不带** `=` 填充。

    Node 用 `Buffer.toString("base64url")`，天然无填充；Python 的 `urlsafe_b64encode`
    会给填充，所以模块里专门 `rstrip("=")`。这里钉住这个差异。
    """
    token = create_resume_pdf_download_token(RESUME_ID, USER_ID, secret=TEST_SECRET, ttl_seconds=300)

    parts = token.split(".")
    assert len(parts) == 2, "令牌必须恰好两段"
    assert parts[0] and parts[1], "两段都不能为空"
    assert "=" not in token, "base64url 不应出现填充字符 ="


def test_payload_carries_the_expected_claims() -> None:
    """负载里的键与 Node `PdfDownloadTokenPayload` 逐项对齐，时间戳是毫秒。"""
    now = datetime(2026, 3, 1, 12, 0, 0, tzinfo=timezone.utc)
    token = create_resume_pdf_download_token(
        RESUME_ID, USER_ID, secret=TEST_SECRET, now=now, ttl_seconds=120
    )

    payload = verify_resume_pdf_download_token(
        token, RESUME_ID, secret=TEST_SECRET, now=now
    )
    assert payload is not None
    assert payload.resume_id == RESUME_ID
    assert payload.user_id == USER_ID
    assert payload.issued_at == now
    assert payload.expires_at == datetime(2026, 3, 1, 12, 2, 0, tzinfo=timezone.utc)


def test_round_trip_with_default_ttl() -> None:
    """不传 `ttl_seconds` 时按 10 分钟上限签，且验得回来。"""
    now = datetime(2026, 3, 1, 12, 0, 0, tzinfo=timezone.utc)
    token = create_resume_pdf_download_token(RESUME_ID, USER_ID, secret=TEST_SECRET, now=now)

    payload = verify_resume_pdf_download_token(token, RESUME_ID, secret=TEST_SECRET, now=now)
    assert payload is not None
    assert (payload.expires_at - payload.issued_at).total_seconds() == MAX_PDF_DOWNLOAD_URL_TTL_SECONDS


@pytest.mark.parametrize(
    ("ttl_seconds", "expected_seconds"),
    [
        (0, 1),  # 下限：夹到 1 秒
        (-5, 1),
        (1, 1),
        (600, 600),  # 上限：夹到 600 秒
        (99999, 600),
        (None, 600),
    ],
)
def test_ttl_is_clamped_like_node(ttl_seconds: int | None, expected_seconds: int) -> None:
    """TTL 夹取规则与 Node `resolveTtlSeconds` 一致（下限 1 秒，上限 600 秒）。"""
    now = datetime(2026, 3, 1, 12, 0, 0, tzinfo=timezone.utc)
    token = create_resume_pdf_download_token(
        RESUME_ID, USER_ID, secret=TEST_SECRET, now=now, ttl_seconds=ttl_seconds
    )

    payload = verify_resume_pdf_download_token(token, RESUME_ID, secret=TEST_SECRET, now=now)
    assert payload is not None
    assert (payload.expires_at - payload.issued_at).total_seconds() == expected_seconds


# ---------------------------------------------------------------------------
# 失败面
# ---------------------------------------------------------------------------


def test_tampered_signature_is_rejected() -> None:
    """改动签名（哪怕一个字符）必须验不过。"""
    token = create_resume_pdf_download_token(RESUME_ID, USER_ID, secret=TEST_SECRET)
    payload, signature = token.split(".")
    tampered = f"{payload}.{'A' if not signature.startswith('A') else 'B'}{signature[1:]}"

    assert verify_resume_pdf_download_token(tampered, RESUME_ID, secret=TEST_SECRET) is None


def test_tampered_payload_is_rejected() -> None:
    """改负载不改签名也必须验不过（否则签名形同虚设）。"""
    token = create_resume_pdf_download_token(RESUME_ID, USER_ID, secret=TEST_SECRET)
    other = create_resume_pdf_download_token("another-resume", USER_ID, secret=TEST_SECRET)
    # 把「另一份简历的负载」和「这份简历的签名」拼起来 —— 典型的越权重放。
    mixed = f"{other.split('.')[0]}.{token.split('.')[1]}"

    assert verify_resume_pdf_download_token(mixed, RESUME_ID, secret=TEST_SECRET) is None


def test_resume_mismatch_is_rejected() -> None:
    """令牌绑了 resumeId，拿去开别的简历必须失败（Node 的 `resume_mismatch`）。"""
    token = create_resume_pdf_download_token(RESUME_ID, USER_ID, secret=TEST_SECRET)

    assert verify_resume_pdf_download_token(token, "another-resume", secret=TEST_SECRET) is None


def test_wrong_secret_is_rejected() -> None:
    """密钥不一致（两边 `AUTH_SECRET` 配错）必须验不过 —— 这正是 M6 要盯的那件事。"""
    token = create_resume_pdf_download_token(RESUME_ID, USER_ID, secret=TEST_SECRET)

    assert verify_resume_pdf_download_token(token, RESUME_ID, secret="a-different-secret") is None


def test_expired_token_is_rejected() -> None:
    """过了 `expiresAt` 就失效（Node 的 `expired`）。"""
    now = datetime(2026, 3, 1, 12, 0, 0, tzinfo=timezone.utc)
    token = create_resume_pdf_download_token(
        RESUME_ID, USER_ID, secret=TEST_SECRET, now=now, ttl_seconds=60
    )

    one_second_before = datetime(2026, 3, 1, 12, 0, 59, tzinfo=timezone.utc)
    assert (
        verify_resume_pdf_download_token(
            token, RESUME_ID, secret=TEST_SECRET, now=one_second_before
        )
        is not None
    )

    # Node 是 `expiresAt <= now` 判过期，所以**踩在 expiresAt 这一刻**就要失效。
    at_expiry = datetime(2026, 3, 1, 12, 1, 0, tzinfo=timezone.utc)
    assert (
        verify_resume_pdf_download_token(token, RESUME_ID, secret=TEST_SECRET, now=at_expiry)
        is None
    )


@pytest.mark.parametrize("malformed", ["", ".", "a.b.c", "only-one-part", ".sig", "payload."])
def test_malformed_tokens_are_rejected(malformed: str) -> None:
    """结构不合法一律 None，不抛异常（调用方拿到 None 就是「拒签重来」）。"""
    assert verify_resume_pdf_download_token(malformed, RESUME_ID, secret=TEST_SECRET) is None


def test_empty_auth_secret_refuses_to_sign() -> None:
    """`AUTH_SECRET` 为空时直接报错，而不是签一个「等于没签」的令牌。

    空密钥是最容易在部署时漏掉、又最难从现象反推的配置错误：Node 会 401，
    但报错点在 Node 那边。这里提前炸，把原因说清楚。
    """
    with pytest.raises(ValueError, match="AUTH_SECRET"):
        create_resume_pdf_download_token(RESUME_ID, USER_ID, secret="")


def test_defaults_to_configured_auth_secret() -> None:
    """不显式传密钥时用配置里的 `AUTH_SECRET`（conftest 写的是测试密钥）。"""
    token = create_resume_pdf_download_token(RESUME_ID, USER_ID)

    assert verify_resume_pdf_download_token(token, RESUME_ID) is not None


# ---------------------------------------------------------------------------
# 与 Node 的真实互签
# ---------------------------------------------------------------------------


def test_node_signed_token_is_accepted() -> None:
    """Node 真实实现签的令牌，Python 必须验得过（冻结点在签发后 1 秒）。"""
    payload = verify_resume_pdf_download_token(
        NODE_SIGNED_TOKEN,
        RESUME_ID,
        secret=TEST_SECRET,
        now=_at(NODE_SIGNED_ISSUED_AT_MS + 1000),
    )

    assert payload is not None
    assert payload.resume_id == RESUME_ID
    assert payload.user_id == USER_ID


def test_node_signed_token_expires_at_the_declared_instant() -> None:
    """同一枚 Node 令牌，越过它自己声明的 `expiresAt` 就必须失效。"""
    assert (
        verify_resume_pdf_download_token(
            NODE_SIGNED_TOKEN, RESUME_ID, secret=TEST_SECRET, now=_at(NODE_SIGNED_EXPIRES_AT_MS)
        )
        is None
    )


def _node_toolchain_available() -> bool:
    """本机是否有跑 Node 侧真实实现所需的 Node 与 `apps/server` 依赖。"""
    return shutil.which("node") is not None and (NODE_SERVER_DIR / "node_modules").is_dir()


@pytest.mark.skipif(
    not _node_toolchain_available(), reason="需要本机 Node 与 apps/server 的 node_modules"
)
def test_node_accepts_python_signed_token() -> None:
    """反向：Python 签的令牌，交给 Node **真实**的 `verifyResumePdfDownloadToken` 去验。

    这是生产链路的方向（Python 签 → Node 验）。缺了它，上面那条只能证明「算法对称」，
    证明不了 Node 真的收。
    """
    token = create_resume_pdf_download_token(RESUME_ID, USER_ID, secret=TEST_SECRET)

    environment = {
        **os.environ,
        # Node 侧的 `packages/env` 会从仓库根 .env 读 AUTH_SECRET，但进程环境变量优先，
        # 所以这里显式覆盖成测试密钥，保证两边用的是同一个。
        "AUTH_SECRET": TEST_SECRET,
    }
    result = subprocess.run(
        ["node", "--import", "tsx", str(NODE_PARITY_SCRIPT), "--verify", token, RESUME_ID],
        cwd=str(NODE_SERVER_DIR),
        env=environment,
        capture_output=True,
        text=True,
        timeout=180,
        check=False,
    )

    assert result.returncode == 0, f"Node 侧验签失败: stdout={result.stdout} stderr={result.stderr}"
    assert '"ok":true' in result.stdout, result.stdout
