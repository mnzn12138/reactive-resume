"""M4 · 新建简历时的初始 `data` 与默认 locale。

`createResume` 要往 `resume.data` 里写一份能被前端编辑器直接打开的文档，所以这里
照 `packages/schema/src/resume/default.ts` 的 `defaultResumeData` +
`packages/api/src/features/resume/initial-data.ts` 的 `createResumeData` 平移过来：

* 七个字段（`picture` / `basics` / `summary` / `sections` / `customSections` /
  `metadata`）一个都不能少，否则前端表单会以「字段缺失」的姿态炸在编辑器里；
* `metadata.page.locale` 用请求带的 locale（Node 从 cookie `locale` 读）；
* `metadata.stylesheet` 固定写空样式表 —— `defaultResumeData` 里没有这个键，
  是 `createResumeData` 补的。

**已知简化**：Node 的 `withSampleData` 会生成一份 636 行的示例简历
（`packages/schema/src/resume/sample.ts`）。本轮不平移，`withSampleData=true` 时仍然
写空文档。理由：示例内容不属于「CRUD 最小集」，平移它等于在 Python 侧再维护一份
简历样例（将来改样例要两边同步）。M5 联调时若前端确实依赖，再决定平移或走 Node。
"""

from __future__ import annotations

import copy
from typing import Any

#: 与 `packages/utils/src/locale.ts` 的 `localeSchema` 一致；本 fork 只发这三个语言包。
SUPPORTED_LOCALES: tuple[str, ...] = ("en-US", "zh-CN", "zh-TW")
DEFAULT_LOCALE = "zh-CN"

#: better-auth 之外的纯前端偏好 cookie，Node 侧 `apps/server/src/rpc/locale.ts` 读同一个键。
LOCALE_COOKIE_NAME = "locale"

#: 与 `packages/schema/src/resume/stylesheet.ts` 的 `EMPTY_SEMANTIC_CSS_SOURCE` 一致。
EMPTY_SEMANTIC_CSS_SOURCE = "@version 1;\n"

_SECTION_ICONS: tuple[str, ...] = (
    "messenger-logo",
    "briefcase",
    "graduation-cap",
    "code-simple",
    "compass-tool",
    "translate",
    "football",
    "trophy",
    "certificate",
    "books",
    "hand-heart",
    "phone",
)

#: `sections` 里 12 个版块的键顺序，照 `defaultResumeData.sections` 的书写顺序。
_SECTION_KEYS: tuple[str, ...] = (
    "profiles",
    "experience",
    "education",
    "projects",
    "skills",
    "languages",
    "interests",
    "awards",
    "certifications",
    "publications",
    "volunteer",
    "references",
)


def resolve_locale(locale_cookie: str | None) -> str:
    """把 cookie `locale` 折算成一个受支持的 locale。

    照 Node `apps/server/src/rpc/locale.ts` 的做法：不认识的取值一律回落默认，
    不报错 —— 语言偏好只是展示问题，不该让建简历失败。

    Args:
        locale_cookie: cookie `locale` 的值，可能为 None 或空串。

    Returns:
        受支持的 locale 字符串，默认 `zh-CN`。
    """
    if locale_cookie and locale_cookie in SUPPORTED_LOCALES:
        return locale_cookie
    return DEFAULT_LOCALE


def _section(icon: str) -> dict[str, Any]:
    """一个空的简历版块（照 `default.ts` 里 `section(icon)` 的 7 字段形状）。"""
    return {
        "title": "",
        "icon": icon,
        "columns": 1,
        "hidden": False,
        "showHeading": True,
        "keepTogether": False,
        "startOnNewPage": False,
        "items": [],
    }


def default_resume_data() -> dict[str, Any]:
    """返回一份全新的空简历 `data`（深拷贝，调用方可以随便改）。"""
    sections: dict[str, Any] = {}
    for key, icon in zip(_SECTION_KEYS, _SECTION_ICONS):
        sections[key] = _section(icon)
    # skills 版块比其它版块多两个布局字段。
    sections["skills"].update({"layout": "default", "keywordLayout": "inline"})

    return {
        "picture": {
            "hidden": False,
            "fit": "cover",
            "url": "",
            "size": 80,
            "rotation": 0,
            "aspectRatio": 1,
            "borderRadius": 0,
            "borderColor": "rgba(0, 0, 0, 0.5)",
            "borderWidth": 0,
            "shadowColor": "rgba(0, 0, 0, 0.5)",
            "shadowWidth": 0,
        },
        "basics": {
            "name": "",
            "headline": "",
            "email": "",
            "phone": "",
            "location": "",
            "website": {"url": "", "label": ""},
            "customFields": [],
        },
        "summary": {
            "title": "",
            "icon": "article",
            "columns": 1,
            "hidden": False,
            "showHeading": True,
            "keepTogether": False,
            "startOnNewPage": False,
            "content": "",
        },
        "sections": sections,
        "customSections": [],
        "metadata": {
            "template": "onyx",
            "layout": {
                "sidebarWidth": 35,
                "pages": [
                    {
                        "fullWidth": False,
                        "main": [
                            "profiles",
                            "summary",
                            "education",
                            "experience",
                            "projects",
                            "volunteer",
                            "references",
                        ],
                        "sidebar": [
                            "skills",
                            "certifications",
                            "awards",
                            "languages",
                            "interests",
                            "publications",
                        ],
                    }
                ],
            },
            "page": {
                "gapX": 4,
                "gapY": 6,
                "marginX": 14,
                "marginY": 12,
                "format": "a4",
                "locale": DEFAULT_LOCALE,
                "hideLinkUnderline": False,
                "hideIcons": False,
                "hideSectionIcons": True,
            },
            "design": {
                "colors": {
                    "primary": "rgba(220, 38, 38, 1)",
                    "text": "rgba(0, 0, 0, 1)",
                    "background": "rgba(255, 255, 255, 1)",
                },
                "level": {"icon": "star", "type": "circle"},
            },
            "typography": {
                "body": {
                    "fontFamily": "IBM Plex Serif",
                    "fontWeights": ["400", "500"],
                    "fontSize": 10,
                    "lineHeight": 1.5,
                },
                "heading": {
                    "fontFamily": "IBM Plex Serif",
                    "fontWeights": ["600"],
                    "fontSize": 14,
                    "lineHeight": 1.5,
                },
            },
            "notes": "",
            "styleRules": [],
        },
    }


def create_resume_data(locale: str) -> dict[str, Any]:
    """`createResume` 写入库里的 `data`。

    Args:
        locale: 受支持的 locale，写进 `metadata.page.locale`。

    Returns:
        一份新的简历 `data`。
    """
    data = copy.deepcopy(default_resume_data())
    data["metadata"]["page"]["locale"] = locale
    data["metadata"]["stylesheet"] = {
        "mode": "semantic",
        "source": {"languageVersion": 1, "text": EMPTY_SEMANTIC_CSS_SOURCE},
    }
    return data
