"""M3 · Python 侧取身份。

核心事实（已核实）
------------------
* `session.token` 是**明文** text 列（`packages/db/src/schema/auth.ts`），且项目没开
  better-auth 的 cookieCache —— 所以认人不用解 JWT、也不用读 cookieCache，剥掉 cookie 的
  签名段之后一条 SQL 就够。
* cookie 名：`better-auth.session_token`。

* ⚠️ **cookie 的值不等于 `session.token`**（M6 端到端验收时实测发现，推翻了这条早期假设）。
  better-auth 1.7 起写进浏览器的 cookie 是**带签名**的：

      <session.token> "." base64(HMAC-SHA256(key = AUTH_SECRET, msg = session.token))

  也就是「库里只存前半段，cookie 多带后半段」。直接拿整个 cookie 去 `WHERE token = ?`
  永远查不到 —— 表现是**所有需要登录的接口一律 401**，而这个 401 和「没登录」长得一模
  一样，从现象上完全看不出是这段代码错了。所以必须先剥掉签名段再查，并顺手验签。

  这一段**已经对着 better-auth 1.7.3 的源码逐项核过**，不是反推的猜测：

  | 要素 | 实际值 | 出处 |
  | --- | --- | --- |
  | 谁在签 | `setSessionCookie` → `ctx.setSignedCookie(名字, session.session.token, ctx.context.secret, …)` | `better-auth/dist/cookies/index.mjs` |
  | 算法 | HMAC-SHA256，密钥取 `AUTH_SECRET`（Node 侧解析顺序：`options.secret` → `BETTER_AUTH_SECRET` → `AUTH_SECRET`） | `better-call/dist/crypto.mjs`、`better-auth/dist/context/create-context.mjs` |
  | 签名输入 | **只**有 token 本身（UTF-8 字节），不含过期时间等其它字段 | 同上 |
  | base64 变体 | `btoa(...)` = **标准 base64、带 `=` 填充**（32 字节 → 恒 44 字符且以 `=` 结尾），**不是** base64url | `better-call/dist/crypto.mjs` |
  | 分隔符 | `.`，取**最后一个** | `better-call/dist/context.mjs`（`lastIndexOf`） |
  | 落盘编码 | 再整体 `encodeURIComponent`（`+`→`%2B`、`=`→`%3D`，`.` 不动） | 同上 |

  注意区分：better-auth 里另一处 `createHMAC("SHA-256", "base64urlnopad")` 是给 cookieCache
  （`session_data`）用的，**不是**会话 cookie。本项目没开 cookieCache，跟这里无关。

  签名用的也是 `AUTH_SECRET`，这让它成为 `AUTH_SECRET` 的**第三个**用途（另两个是限流的
  HMAC pepper 与 M5 的 PDF 下载令牌签名）。两边 `AUTH_SECRET` 不一致时这里会直接认不出人
  —— 比「签名错了照样能登录、问题留到别处才炸」要好排查得多。

* 认人的查询（`:token` 已剥掉签名段）：

      SELECT "user".id
      FROM session
      JOIN "user" ON "user".id = session.user_id
      WHERE session.token = :token AND session.expires_at > now()

* 不需要（也不应该）改前端的 `authClient.getSession()`：它直连 Node 的 `/api/auth/get-session`，
  改了会让会话续期退化成 7 天硬过期。

用法（M4 起）：

    from app.identity import get_current_user_id

    @router.get("/resumes")
    def list_resumes(user_id: str = Depends(get_current_user_id)) -> ...:
        ...
"""

from __future__ import annotations

import base64
import hashlib
import hmac
from urllib.parse import unquote

from fastapi import Cookie, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db.models import Session as SessionRow
from app.db.models import User
from app.db.session import get_db

#: better-auth 写入浏览器的会话 cookie 名。
SESSION_COOKIE_NAME = "better-auth.session_token"

_UNAUTHORIZED_DETAIL = "Not authenticated"


def split_signed_token(cookie_value: str) -> tuple[str, str | None]:
    """把 cookie 拆成 `(session_token, signature)`。

    没有 `.` 就按老形态处理（cookie 值即 token 本身），签名段为 None。

    为什么按**最后一个** `.` 切而不是第一个：better-auth 的 `getSignedCookie` 最终走的是
    better-call 的实现（`node_modules/.pnpm/better-call@1.4.0/dist/context.mjs`），那里用的是
    `value.lastIndexOf(".")`。默认的 `generateId` 只出 `[a-zA-Z0-9]`（见
    `@better-auth/core/dist/utils/id.mjs`），两种切法结果一样；但 better-auth 允许配自定义
    `generateId`，一旦 token 里带 `.`，按第一个 `.` 切会把 token 拦腰截断 —— 表现又是
    「所有接口 401」，和当初没剥签名时长得一模一样，照样看不出来。跟着库走最省心。

    Args:
        cookie_value: cookie `better-auth.session_token` 的值。

    Returns:
        `(token, signature)`；`signature` 为 None 表示这个 cookie 没带签名。
    """
    token, separator, signature = cookie_value.rpartition(".")
    # 没有 `.`，或 `.` 就落在开头（对应 better-call 的 `signatureStartPos < 1`）—— 都当没签名。
    if not separator or not token:
        return cookie_value, None
    return token, signature


def signature_matches(token: str, signature: str) -> bool:
    """验 cookie 的签名段。

    Args:
        token: `session.token`，即 cookie 的第一段。
        signature: cookie 的第二段，Node 侧算出的 base64(HMAC-SHA256)。

    Returns:
        签名一致返回 True。
    """
    expected = base64.b64encode(
        hmac.new(
            get_settings().auth_secret.encode("utf-8"),
            token.encode("utf-8"),
            hashlib.sha256,
        ).digest()
    ).decode("ascii")
    return hmac.compare_digest(expected, signature)


def _candidate_cookie_values(cookie_value: str) -> list[str]:
    """列出要拿去查库的候选值。

    为什么要试两个：better-auth 写 `Set-Cookie` 时会对整个 `token.signature` 再套一层
    `encodeURIComponent`（`+`→`%2B`、`=`→`%3D`），而浏览器是把**编码后的串**原样回传的。

    实测确认**到达这里的就是带 `%3D` 的串**：`starlette.requests.cookie_parser` 用的是
    `http.cookies._unquote`，那个函数只剥两端的双引号、**不做** percent 解码
    （实测 `cookie_parser('…%3D')` 原样返回 `'…%3D'`）。所以第二个候选（解码后）是
    **必经之路**，不是「以防万一」的保险 —— 少了它，所有登录接口照样一律 401。

    反过来，若前面挂了会解码的反代 / 网关，第一个候选就成了主路径。两种都试，
    免得「换个浏览器 / 换个网关就登录不上」。
    """
    candidates = [cookie_value]
    if "%" in cookie_value:
        unquoted = unquote(cookie_value)
        if unquoted != cookie_value:
            candidates.append(unquoted)
    return candidates


def resolve_user_id(db: Session, token: str | None) -> str | None:
    """把 cookie 里的值解析成 user id。

    Args:
        db: 数据库 Session。
        token: cookie `better-auth.session_token` 的值，可能为 None 或空串。

    Returns:
        命中的 user id；cookie 缺失、签名不对、token 不存在或已过期时返回 None。
    """
    if not token:
        return None

    for candidate in _candidate_cookie_values(token):
        session_token, signature = split_signed_token(candidate)
        if not session_token:
            continue
        # 带签名就必须验：不验的话「偷到 token 但没偷到签名」也能登录，而且 AUTH_SECRET
        # 配错时会静默退化成「不校验」，比直接 401 难查得多。
        if signature is not None and not signature_matches(session_token, signature):
            continue

        statement = (
            select(SessionRow.user_id)
            .join(User, User.id == SessionRow.user_id)
            .where(SessionRow.token == session_token, SessionRow.expires_at > func.now())
            .limit(1)
        )
        user_id = db.execute(statement).scalar_one_or_none()
        if user_id is not None:
            return user_id

    return None


def get_current_user_id(
    db: Session = Depends(get_db),
    session_token: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
) -> str:
    """FastAPI 依赖：取当前登录用户的 id，失败直接抛 401。

    Args:
        db: 由 `get_db` 注入的数据库 Session。
        session_token: 从 cookie `better-auth.session_token` 读取的值。

    Returns:
        当前登录用户的 id。

    Raises:
        HTTPException: 401 —— 无 cookie、签名不对、token 不存在（伪造）或已过期。
    """
    user_id = resolve_user_id(db, session_token)
    if user_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_UNAUTHORIZED_DETAIL)
    return user_id


def get_current_user(
    db: Session = Depends(get_db),
    session_token: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
) -> User:
    """FastAPI 依赖：取当前登录用户的完整记录，失败直接抛 401。

    Args:
        db: 由 `get_db` 注入的数据库 Session。
        session_token: 从 cookie `better-auth.session_token` 读取的值。

    Returns:
        当前登录的 `User` 行。

    Raises:
        HTTPException: 401 —— 无 cookie、签名不对、token 不存在（伪造）或已过期。
    """
    user_id = resolve_user_id(db, session_token)
    if user_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_UNAUTHORIZED_DETAIL)

    user = db.get(User, user_id)
    if user is None:
        # session 存在但 user 被删掉了（理论上有 FK cascade 兜底，这里再兜一层）。
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_UNAUTHORIZED_DETAIL)
    return user
