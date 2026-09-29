"""Pydantic 请求 / 响应模型。

字段名一律 snake_case，靠 `alias_generator=to_camel` 与线上的 camelCase 对齐 ——
这样 Python 侧代码保持 PEP 8，而进出 HTTP 的 JSON 形状照
`contract/resume-openapi.json` 不走样。
"""

from __future__ import annotations
