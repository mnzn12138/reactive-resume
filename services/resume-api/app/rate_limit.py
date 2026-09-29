"""M4 · 进程内滑动窗口限流（对齐 Node 的 `resumeMutationRateLimit`）。

Node 侧：`packages/api/src/middleware/rate-limit/index.ts` 用
`MemoryRatelimiter(rateLimitConfig.orpc.resumeMutations)`，即 **300 次 / 60 秒**，
key 为 `resume-mutation:{user.id ?? "anon"}:{inputKeyPart}`；`inputKeyPart` 依次找
`resumeId / threadId / conversationId / messageId / fileId / id`，取不到就是 `no-id`。
四个写接口（create / update / patch / delete）才挂这个中间件，读接口不限。

两个刻意的选择：

* **进程内，不搞分布式**。Python 服务按单实例部署就够了；将来多实例再换 Redis，
  接口不变。
* **key 用 `AUTH_SECRET` 做 HMAC pepper**。契约第 6 节要求 Python 必须读到与 Node
  完全一致的 `AUTH_SECRET`（它是 pepper，读不到就限流失效）。Node 当前只在短信 / IP
  限流里用 pepper，`resumeMutationRateLimit` 本身没用 —— 我们照契约把 pepper 加上，
  代价只是桶名不可预测，语义不变。见 README「与 Node 的差异」。
"""

from __future__ import annotations

import hashlib
import hmac
import threading
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass

from app.config import get_settings

#: 与 Node `rateLimitConfig.orpc.resumeMutations` 逐项对齐。
RESUME_MUTATION_MAX_REQUESTS = 300
RESUME_MUTATION_WINDOW_SECONDS = 60.0

_RATE_LIMIT_PREFIX = "resume-mutation"


@dataclass(frozen=True)
class RateLimitDecision:
    """一次限流判定结果。

    Attributes:
        allowed: 是否放行。
        retry_after: 拒绝时距离窗口腾出位置的秒数；放行时为 0。
    """

    allowed: bool
    retry_after: float


class SlidingWindowLimiter:
    """单进程滑动窗口限流器。

    每个 key 一个 `deque[float]`，只保留窗口内的时间戳；窗口外的时间戳在每次判定时
    顺手清掉，所以内存不会随时间无界增长。
    """

    def __init__(
        self,
        max_requests: int,
        window_seconds: float,
        *,
        pepper: str = "",
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        """Args:
            max_requests: 窗口内允许的最大请求数。
            window_seconds: 窗口长度（秒）。
            pepper: HMAC pepper；为空则直接用 key 原文做桶名。
            clock: 单调时钟，测试里可以换掉。
        """
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.pepper = pepper
        self._clock = clock
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def reset(self) -> None:
        """清空全部计数（测试用）。"""
        with self._lock:
            self._hits.clear()

    def bucket(self, key: str) -> str:
        """把业务 key 折成桶名。

        Args:
            key: 业务侧可读的限流 key。

        Returns:
            有 pepper 时是 HMAC-SHA256 摘要，否则是 key 原文。
        """
        if not self.pepper:
            return key
        return hmac.new(self.pepper.encode("utf-8"), key.encode("utf-8"), hashlib.sha256).hexdigest()

    def check(self, key: str) -> RateLimitDecision:
        """判定并记账。

        Args:
            key: 业务侧可读的限流 key。

        Returns:
            放行或拒绝的决定。
        """
        now = self._clock()
        bucket = self.bucket(key)

        with self._lock:
            hits = self._hits.setdefault(bucket, deque())
            cutoff = now - self.window_seconds
            while hits and hits[0] <= cutoff:
                hits.popleft()

            if len(hits) >= self.max_requests:
                return RateLimitDecision(allowed=False, retry_after=hits[0] + self.window_seconds - now)

            hits.append(now)
            return RateLimitDecision(allowed=True, retry_after=0.0)


#: 全局单例：与 Node 的 `resumeMutationLimiter` 对应。
resume_mutation_limiter = SlidingWindowLimiter(
    max_requests=RESUME_MUTATION_MAX_REQUESTS,
    window_seconds=RESUME_MUTATION_WINDOW_SECONDS,
    pepper=get_settings().auth_secret,
)


def resume_mutation_key(user_id: str, resume_id: str | None = None) -> str:
    """拼出与 Node 同源语义的限流 key。

    Args:
        user_id: 当前登录用户 id；公开路径理论上不会走到写操作，所以总是有值。
        resume_id: 路径上的简历 id；`createResume` 还没有 id，传 None。

    Returns:
        形如 `resume-mutation:<user_id>:id:<resume_id>` 的 key。
    """
    input_part = f"id:{resume_id}" if resume_id else "no-id"
    return f"{_RATE_LIMIT_PREFIX}:{user_id}:{input_part}"
