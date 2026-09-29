"""M4 · 与 Node 侧同形态的 id 生成。

为什么不用 `uuid4()`：Node 侧 `generateId()`（`packages/utils/src/string.ts`）就是
`uuidv7()`。UUIDv7 的前 48 bit 是毫秒时间戳，因此主键在 B-tree 上大致按写入顺序递增；
换成 v4 虽然字符集与长度一样、URL 形态看不出差别，但会丢掉这层时间局部性，
和 Node 写入的行混在一张表里时顺序也不再可比。

Python 3.13 的标准库还没有 `uuid.uuid7()`（3.14 才加入），所以自己拼 128 bit。
"""

from __future__ import annotations

import secrets
import time
from uuid import UUID

#: UUIDv7 版本号，占 bit 76~79。
_VERSION = 0x7
#: RFC 4122 变体位，占 bit 62~63，固定 `10`。
_VARIANT = 0b10


def generate_id() -> str:
    """生成与 Node `uuidv7()` 输出完全同形的 id（36 字符、小写十六进制、8-4-4-4-12）。

    Returns:
        形如 `018f4c2b-9a1e-7c31-8f2a-6d5b4c3a2e1f` 的字符串。
    """
    timestamp_ms = int(time.time() * 1000) & 0xFFFF_FFFF_FFFF
    rand_a = secrets.randbits(12)
    rand_b = secrets.randbits(62)

    value = (
        (timestamp_ms << 80)
        | (_VERSION << 76)
        | (rand_a << 64)
        | (_VARIANT << 62)
        | rand_b
    )
    return str(UUID(int=value))
