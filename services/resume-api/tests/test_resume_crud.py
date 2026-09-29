"""M4 · 简历 CRUD 7 个端点的用例。

每个端点至少覆盖四件事（端点本身没有某种失败面时，在用例名里写明为什么跳过）：

* happy path —— 响应形状与 `contract/resume-openapi.json` 一致；
* 未认证 → 401；
* 越权 → **404**（不是 403，与 Node 一致）；
* 参数非法 → 400。

另有两组跨端点的用例：

* `test_*.py::test_response_shapes_match_contract`：直接读契约 JSON，逐个端点对
  200 响应的字段集合做**集合相等**的 diff（改契约就会红）；
* `test_write_operations_are_rate_limited` / `test_read_operations_are_not_rate_limited`：
  限流只挂在写操作上。
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable, Iterator
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.db.models import Resume
from app.db.session import get_db
from app.identity import SESSION_COOKIE_NAME
from app.rate_limit import resume_mutation_limiter
from app.schemas.resume import to_iso_millis

SERVICE_ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = SERVICE_ROOT / "contract" / "resume-openapi.json"

#: 每个用例都要用的最小简历 `data`（够 patch 与脱敏测试用，不必是完整 ResumeData）。
SAMPLE_DATA = {
    "basics": {"name": "张三", "headline": "后端工程师"},
    "summary": {"content": "简介"},
    "metadata": {"notes": "作者私有的备注"},
}


# ---------------------------------------------------------------------------
# 夹具
# ---------------------------------------------------------------------------


@pytest.fixture()
def api_client(db_session: Session) -> Iterator[TestClient]:
    """挂在 `app.main.app` 上的 TestClient，只把 `get_db` 换成用例自己的 Session。"""
    from app.main import app

    app.dependency_overrides[get_db] = lambda: db_session
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def _reset_rate_limiter() -> Iterator[None]:
    """每个用例前后清空限流计数，用例之间不互相干扰。"""
    resume_mutation_limiter.reset()
    yield
    resume_mutation_limiter.reset()


@pytest.fixture()
def resume_factory(db_session: Session) -> Callable[..., Resume]:
    """直接插一行 resume（绕开 API，方便构造锁定 / 带密码 / 私有等状态）。"""

    def _make_resume(
        *,
        user_id: str,
        slug: str = "my-resume",
        name: str = "我的简历",
        tags: list[str] | None = None,
        is_public: bool = False,
        is_locked: bool = False,
        password: str | None = None,
        data: dict | None = None,
    ) -> Resume:
        now = datetime.now(timezone.utc)
        row = Resume(
            id=uuid4().hex,
            name=name,
            slug=slug,
            tags=tags if tags is not None else [],
            is_public=is_public,
            is_locked=is_locked,
            password=password,
            data=data if data is not None else dict(SAMPLE_DATA),
            user_id=user_id,
            created_at=now,
            updated_at=now,
        )
        db_session.add(row)
        db_session.commit()
        return row

    return _make_resume


@pytest.fixture()
def authed(api_client: TestClient, session_factory: Callable[..., str], user_id: str) -> str:
    """已登录的客户端（cookie 设好），返回 user id。"""
    api_client.cookies.set(
        SESSION_COOKIE_NAME,
        session_factory(user_id=user_id, expires_at=datetime.now(timezone.utc) + timedelta(days=1)),
    )
    return user_id


def _access_cookie(resume_id: str, password_hash: str) -> str:
    """照 Node `access.ts` 的 `signResumeAccessToken` 算出通过密码验证后的 cookie 值。"""
    return hashlib.sha256(f"{resume_id}:{password_hash}".encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# 与契约的形状 diff
# ---------------------------------------------------------------------------


def _contract_response_schema(method: str, path: str, code: str = "200") -> dict:
    """取契约里某个响应的 schema（数组则剥掉 `items` 一层）。"""
    spec = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    schema = spec["paths"][path][method]["responses"][code]["content"]["application/json"]["schema"]
    if schema.get("type") == "array":
        return schema["items"]
    return schema


def test_response_shapes_match_contract(
    api_client: TestClient,
    authed: str,
    resume_factory: Callable[..., Resume],
    user_id: str,
) -> None:
    """7 个端点的 200 响应字段集合，与契约逐项做集合相等的 diff。"""
    resume = resume_factory(user_id=user_id, is_public=True)

    list_schema = _contract_response_schema("get", "/resumes")
    body = api_client.get("/resumes").json()
    assert set(body[0]) == set(list_schema["properties"])

    get_schema = _contract_response_schema("get", "/resumes/{id}")
    assert set(api_client.get(f"/resumes/{resume.id}").json()) == set(get_schema["properties"])

    created_id = api_client.post(
        "/resumes", json={"name": "新简历", "slug": "new-resume", "tags": []}
    ).json()
    create_schema = _contract_response_schema("post", "/resumes")
    assert create_schema["type"] == "string"
    assert isinstance(created_id, str)

    update_schema = _contract_response_schema("put", "/resumes/{id}")
    assert set(
        api_client.put(f"/resumes/{created_id}", json={"name": "改过的名字"}).json()
    ) == set(update_schema["properties"])

    patch_schema = _contract_response_schema("patch", "/resumes/{id}")
    assert set(
        api_client.patch(
            f"/resumes/{created_id}",
            json={"operations": [{"op": "replace", "path": "/basics/name", "value": "李四"}]},
        ).json()
    ) == set(patch_schema["properties"])

    slug_schema = _contract_response_schema("get", "/resumes/{username}/{slug}")
    slug_body = api_client.get(f"/resumes/{_username_of(api_client, user_id)}/my-resume").json()
    assert set(slug_body) == set(slug_schema["properties"])

    # delete 的输出是 `z.void()`，契约里是 anyOf[{not:{}},{not:{}}]，即「没有内容」。
    assert api_client.delete(f"/resumes/{created_id}").json() is None


def _username_of(api_client: TestClient, user_id: str) -> str:
    """从库里取用户名（公开页路径要用）。"""
    from app.db.models import User

    session = api_client.app.dependency_overrides[get_db]()
    return session.get(User, user_id).username


# ---------------------------------------------------------------------------
# listResumes
# ---------------------------------------------------------------------------


def test_list_resumes_returns_only_current_users_resumes(
    api_client: TestClient,
    authed: str,
    user_factory: Callable[..., object],
    resume_factory: Callable[..., Resume],
    user_id: str,
) -> None:
    """只返回当前用户的简历。"""
    other_user = user_factory()
    resume_factory(user_id=user_id, slug="mine-1")
    resume_factory(user_id=user_id, slug="mine-2")
    resume_factory(user_id=other_user.id, slug="theirs")

    body = api_client.get("/resumes").json()
    assert {item["slug"] for item in body} == {"mine-1", "mine-2"}


def test_list_resumes_default_sort_is_last_updated_desc(
    api_client: TestClient, authed: str, resume_factory: Callable[..., Resume], user_id: str
) -> None:
    """默认按 `updatedAt` 倒序。"""
    older = resume_factory(user_id=user_id, slug="older")
    newer = resume_factory(user_id=user_id, slug="newer")
    older.updated_at = datetime.now(timezone.utc) - timedelta(hours=1)
    api_client.app.dependency_overrides[get_db]().commit()

    body = api_client.get("/resumes").json()
    assert [item["slug"] for item in body] == ["newer", "older"]


def test_list_resumes_sort_by_name(
    api_client: TestClient, authed: str, resume_factory: Callable[..., Resume], user_id: str
) -> None:
    """`sort=name` 按名字升序。"""
    resume_factory(user_id=user_id, slug="b", name=" zebra ")
    resume_factory(user_id=user_id, slug="a", name="apple")

    body = api_client.get("/resumes", params={"sort": "name"}).json()
    assert [item["slug"] for item in body] == ["a", "b"]


def test_list_resumes_filter_by_tags(
    api_client: TestClient, authed: str, resume_factory: Callable[..., Resume], user_id: str
) -> None:
    """`tags` 过滤走 Postgres 的 `@>`（简历含全部给定标签才算命中）。"""
    resume_factory(user_id=user_id, slug="both", tags=["cv", "2026"])
    resume_factory(user_id=user_id, slug="one", tags=["cv"])

    body = api_client.get("/resumes", params={"tags": ["cv", "2026"]}).json()
    assert [item["slug"] for item in body] == ["both"]


def test_list_resumes_bracket_notation_tags(
    api_client: TestClient, authed: str, resume_factory: Callable[..., Resume], user_id: str
) -> None:
    """oRPC 的 OpenAPI 通道发的是 `tags[0]=...`，这种记法也要能解析。"""
    resume_factory(user_id=user_id, slug="both", tags=["cv", "2026"])
    resume_factory(user_id=user_id, slug="one", tags=["cv"])

    body = api_client.get("/resumes?tags%5B0%5D=cv&tags%5B1%5D=2026").json()
    assert [item["slug"] for item in body] == ["both"]


def test_list_resumes_unauthenticated_returns_401(api_client: TestClient) -> None:
    """未认证 → 401，错误体是 oRPC 信封。"""
    response = api_client.get("/resumes")
    assert response.status_code == 401
    assert response.json()["code"] == "UNAUTHORIZED"


def test_list_resumes_invalid_sort_returns_400(api_client: TestClient, authed: str) -> None:
    """`sort` 不在枚举里 → 400。"""
    response = api_client.get("/resumes", params={"sort": "notASort"})
    assert response.status_code == 400
    assert response.json()["code"] == "BAD_REQUEST"


# ---------------------------------------------------------------------------
# createResume
# ---------------------------------------------------------------------------


def test_create_resume_returns_new_id_and_persists_defaults(
    api_client: TestClient, authed: str, db_session: Session
) -> None:
    """happy path：返回新 id，库里落的是默认空简历 + 默认 locale。"""
    response = api_client.post(
        "/resumes", json={"name": "我的简历", "slug": "my-resume", "tags": ["cv"]}
    )
    assert response.status_code == 200
    resume_id = response.json()

    row = db_session.get(Resume, resume_id)
    assert row.name == "我的简历"
    assert row.slug == "my-resume"
    assert row.tags == ["cv"]
    assert row.user_id == authed
    assert row.is_public is False
    assert set(row.data) == {"picture", "basics", "summary", "sections", "customSections", "metadata"}
    assert row.data["metadata"]["page"]["locale"] == "zh-CN"
    assert row.data["metadata"]["stylesheet"]["source"]["text"] == "@version 1;\n"


def test_create_resume_honours_locale_cookie(
    api_client: TestClient, authed: str, db_session: Session
) -> None:
    """cookie `locale` 决定 `metadata.page.locale`；不认识的值回落 zh-CN。"""
    api_client.cookies.set("locale", "en-US")
    resume_id = api_client.post("/resumes", json={"name": "n", "slug": "s1"}).json()
    assert db_session.get(Resume, resume_id).data["metadata"]["page"]["locale"] == "en-US"

    api_client.cookies.set("locale", "klingon")
    resume_id = api_client.post("/resumes", json={"name": "n", "slug": "s2"}).json()
    assert db_session.get(Resume, resume_id).data["metadata"]["page"]["locale"] == "zh-CN"


def test_create_resume_unauthenticated_returns_401(api_client: TestClient) -> None:
    """未认证 → 401。"""
    response = api_client.post("/resumes", json={"name": "n", "slug": "s"})
    assert response.status_code == 401
    assert response.json()["code"] == "UNAUTHORIZED"


def test_create_resume_blank_name_returns_400(api_client: TestClient, authed: str) -> None:
    """`name` 去空白后为空 → 400（Node 侧 `z.string().trim().min(1)`）。"""
    response = api_client.post("/resumes", json={"name": "   ", "slug": "s"})
    assert response.status_code == 400
    assert response.json()["code"] == "BAD_REQUEST"


def test_create_resume_missing_required_field_returns_400(api_client: TestClient, authed: str) -> None:
    """缺 `slug` → 400。"""
    response = api_client.post("/resumes", json={"name": "n"})
    assert response.status_code == 400
    assert response.json()["code"] == "BAD_REQUEST"


def test_create_resume_duplicate_slug_returns_400(
    api_client: TestClient, authed: str, resume_factory: Callable[..., Resume], user_id: str
) -> None:
    """同一用户下 slug 重复 → 400 `RESUME_SLUG_ALREADY_EXISTS`。"""
    resume_factory(user_id=user_id, slug="taken")

    response = api_client.post("/resumes", json={"name": "n", "slug": "taken"})
    assert response.status_code == 400
    assert response.json()["code"] == "RESUME_SLUG_ALREADY_EXISTS"


def test_create_resume_same_slug_other_user_is_allowed(
    api_client: TestClient,
    authed: str,
    user_factory: Callable[..., object],
    resume_factory: Callable[..., Resume],
) -> None:
    """别人的 slug 不冲突（唯一约束是 `(slug, user_id)`）。"""
    resume_factory(user_id=user_factory().id, slug="shared-slug")

    response = api_client.post("/resumes", json={"name": "n", "slug": "shared-slug"})
    assert response.status_code == 200


def test_write_operations_are_rate_limited(
    api_client: TestClient, authed: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """写操作触到窗口上限 → 429 `TOO_MANY_REQUESTS`。

    用 `monkeypatch` 压阈值而不是直接改属性：用例结束后会自动恢复，
    不会把 `max_requests=1` 泄漏给后面的用例。
    """
    monkeypatch.setattr(resume_mutation_limiter, "max_requests", 1)

    assert api_client.post("/resumes", json={"name": "n", "slug": "a"}).status_code == 200
    response = api_client.post("/resumes", json={"name": "n", "slug": "b"})
    assert response.status_code == 429
    assert response.json()["code"] == "TOO_MANY_REQUESTS"


def test_read_operations_are_not_rate_limited(
    api_client: TestClient,
    authed: str,
    resume_factory: Callable[..., Resume],
    user_id: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """限流只挂在写操作上，读接口不受影响。"""
    monkeypatch.setattr(resume_mutation_limiter, "max_requests", 1)
    resume_factory(user_id=user_id)

    assert api_client.get("/resumes").status_code == 200
    assert api_client.get("/resumes").status_code == 200


# ---------------------------------------------------------------------------
# getResume
# ---------------------------------------------------------------------------


def test_get_resume_returns_full_data(
    api_client: TestClient, authed: str, resume_factory: Callable[..., Resume], user_id: str
) -> None:
    """happy path：含完整 `data` 与 `hasPassword`。"""
    resume = resume_factory(user_id=user_id, password="hashed-secret")

    body = api_client.get(f"/resumes/{resume.id}").json()
    assert body["id"] == resume.id
    assert body["data"] == SAMPLE_DATA
    assert body["hasPassword"] is True
    # 时间戳是毫秒精度 + `Z` 结尾，与 Node `Date.toISOString()` 同形。
    assert body["updatedAt"].endswith("Z")


def test_get_resume_unauthenticated_returns_401(api_client: TestClient) -> None:
    """未认证 → 401。"""
    assert api_client.get("/resumes/whatever").status_code == 401


def test_get_resume_other_users_resume_returns_404(
    api_client: TestClient,
    authed: str,
    user_factory: Callable[..., object],
    resume_factory: Callable[..., Resume],
) -> None:
    """越权 → 404（不是 403，避免泄露简历是否存在）。"""
    foreign = resume_factory(user_id=user_factory().id)

    assert api_client.get(f"/resumes/{foreign.id}").status_code == 404


def test_get_resume_unknown_id_returns_404(api_client: TestClient, authed: str) -> None:
    """id 不存在 → 404。"""
    response = api_client.get("/resumes/does-not-exist")
    assert response.status_code == 404
    assert response.json()["code"] == "NOT_FOUND"


# ---------------------------------------------------------------------------
# updateResume
# ---------------------------------------------------------------------------


def test_update_resume_updates_only_provided_fields(
    api_client: TestClient, authed: str, resume_factory: Callable[..., Resume], user_id: str
) -> None:
    """happy path：只改传了的字段，没传的保持原值。"""
    resume = resume_factory(user_id=user_id, name="原名", tags=["old"])

    body = api_client.put(
        f"/resumes/{resume.id}", json={"name": "新名", "isPublic": True}
    ).json()
    assert body["name"] == "新名"
    assert body["isPublic"] is True
    assert body["tags"] == ["old"]
    assert body["hasPassword"] is False


def test_update_resume_replaces_data_and_tags(
    api_client: TestClient, authed: str, resume_factory: Callable[..., Resume], user_id: str
) -> None:
    """`data` / `tags` / `showDownloadButtons` 都能改。"""
    resume = resume_factory(user_id=user_id)

    body = api_client.put(
        f"/resumes/{resume.id}",
        json={"tags": ["a"], "data": {"basics": {"name": "李四"}}, "showDownloadButtons": False},
    ).json()
    assert body["tags"] == ["a"]
    assert body["data"] == {"basics": {"name": "李四"}}
    assert body["showDownloadButtons"] is False


def test_update_resume_empty_body_is_noop(
    api_client: TestClient, authed: str, resume_factory: Callable[..., Resume], user_id: str
) -> None:
    """不带 body（或空 body）等价于空更新，返回当前状态。"""
    resume = resume_factory(user_id=user_id, name="原样")

    body = api_client.put(f"/resumes/{resume.id}", json={}).json()
    assert body["name"] == "原样"


def test_update_resume_unauthenticated_returns_401(
    api_client: TestClient, resume_factory: Callable[..., Resume], user_id: str
) -> None:
    """未认证 → 401。"""
    resume = resume_factory(user_id=user_id)
    assert api_client.put(f"/resumes/{resume.id}", json={"name": "x"}).status_code == 401


def test_update_resume_other_users_resume_returns_404(
    api_client: TestClient,
    authed: str,
    user_factory: Callable[..., object],
    resume_factory: Callable[..., Resume],
) -> None:
    """越权 → 404。"""
    foreign = resume_factory(user_id=user_factory().id)
    assert api_client.put(f"/resumes/{foreign.id}", json={"name": "x"}).status_code == 404


def test_update_resume_locked_returns_400(
    api_client: TestClient, authed: str, resume_factory: Callable[..., Resume], user_id: str
) -> None:
    """锁定的简历不能改 → 400 `RESUME_LOCKED`。"""
    resume = resume_factory(user_id=user_id, is_locked=True)

    response = api_client.put(f"/resumes/{resume.id}", json={"name": "x"})
    assert response.status_code == 400
    assert response.json()["code"] == "RESUME_LOCKED"


def test_update_resume_duplicate_slug_returns_400(
    api_client: TestClient, authed: str, resume_factory: Callable[..., Resume], user_id: str
) -> None:
    """改成别人的 slug 撞了自己 → 400 `RESUME_SLUG_ALREADY_EXISTS`。"""
    resume_factory(user_id=user_id, slug="taken")
    target = resume_factory(user_id=user_id, slug="target")

    response = api_client.put(f"/resumes/{target.id}", json={"slug": "taken"})
    assert response.status_code == 400
    assert response.json()["code"] == "RESUME_SLUG_ALREADY_EXISTS"


def test_update_resume_blank_slug_returns_400(
    api_client: TestClient, authed: str, resume_factory: Callable[..., Resume], user_id: str
) -> None:
    """`slug` 去空白后为空 → 400。"""
    resume = resume_factory(user_id=user_id)
    assert api_client.put(f"/resumes/{resume.id}", json={"slug": " "}).status_code == 400


# ---------------------------------------------------------------------------
# patchResume
# ---------------------------------------------------------------------------


def test_patch_resume_replaces_nested_field(
    api_client: TestClient, authed: str, resume_factory: Callable[..., Resume], user_id: str
) -> None:
    """happy path：JSON Patch 改到 `data` 里的嵌套字段。"""
    resume = resume_factory(user_id=user_id)

    body = api_client.patch(
        f"/resumes/{resume.id}",
        json={"operations": [{"op": "replace", "path": "/basics/name", "value": "李四"}]},
    ).json()
    assert body["data"]["basics"]["name"] == "李四"
    assert body["name"] == resume.name


def test_patch_resume_add_and_remove(
    api_client: TestClient, authed: str, resume_factory: Callable[..., Resume], user_id: str
) -> None:
    """`add` / `remove` 也能用。"""
    resume = resume_factory(user_id=user_id)

    body = api_client.patch(
        f"/resumes/{resume.id}",
        json={
            "operations": [
                {"op": "add", "path": "/basics/email", "value": "a@b.test"},
                {"op": "remove", "path": "/summary"},
            ]
        },
    ).json()
    assert body["data"]["basics"]["email"] == "a@b.test"
    assert "summary" not in body["data"]


def test_patch_resume_cannot_touch_columns_outside_data(
    api_client: TestClient, authed: str, resume_factory: Callable[..., Resume], user_id: str
) -> None:
    """patch 的根是 `data`，改不到 `name` / `slug` 这些列 —— `/name` 在 data 里不存在 → 400。"""
    resume = resume_factory(user_id=user_id, name="原名")

    response = api_client.patch(
        f"/resumes/{resume.id}",
        json={"operations": [{"op": "replace", "path": "/name", "value": "越权改名"}]},
    )
    assert response.status_code == 400
    assert response.json()["code"] == "INVALID_PATCH_OPERATIONS"
    assert resume.name == "原名"


def test_patch_resume_unauthenticated_returns_401(
    api_client: TestClient, resume_factory: Callable[..., Resume], user_id: str
) -> None:
    """未认证 → 401。"""
    resume = resume_factory(user_id=user_id)
    response = api_client.patch(f"/resumes/{resume.id}", json={"operations": []})
    assert response.status_code == 401


def test_patch_resume_other_users_resume_returns_404(
    api_client: TestClient,
    authed: str,
    user_factory: Callable[..., object],
    resume_factory: Callable[..., Resume],
) -> None:
    """越权 → 404。"""
    foreign = resume_factory(user_id=user_factory().id)
    response = api_client.patch(
        f"/resumes/{foreign.id}",
        json={"operations": [{"op": "replace", "path": "/basics/name", "value": "x"}]},
    )
    assert response.status_code == 404


def test_patch_resume_empty_operations_returns_400(
    api_client: TestClient, authed: str, resume_factory: Callable[..., Resume], user_id: str
) -> None:
    """空 operations → 400（Node 侧 `.min(1)`）。"""
    resume = resume_factory(user_id=user_id)
    response = api_client.patch(f"/resumes/{resume.id}", json={"operations": []})
    assert response.status_code == 400
    assert response.json()["code"] == "BAD_REQUEST"


def test_patch_resume_unknown_op_returns_400(
    api_client: TestClient, authed: str, resume_factory: Callable[..., Resume], user_id: str
) -> None:
    """op 不在 RFC 6902 里 → 400。"""
    resume = resume_factory(user_id=user_id)
    response = api_client.patch(
        f"/resumes/{resume.id}", json={"operations": [{"op": "frobnicate", "path": "/a"}]}
    )
    assert response.status_code == 400
    assert response.json()["code"] == "BAD_REQUEST"


def test_patch_resume_invalid_json_pointer_returns_400(
    api_client: TestClient, authed: str, resume_factory: Callable[..., Resume], user_id: str
) -> None:
    """`path` 不是合法 JSON Pointer → 400，并回带出错下标。"""
    resume = resume_factory(user_id=user_id)
    response = api_client.patch(
        f"/resumes/{resume.id}",
        json={"operations": [{"op": "remove", "path": "basics/name"}]},
    )
    assert response.status_code == 400
    body = response.json()
    assert body["code"] == "INVALID_PATCH_OPERATIONS"
    assert body["data"]["index"] == 0


def test_patch_resume_unresolvable_path_returns_400(
    api_client: TestClient, authed: str, resume_factory: Callable[..., Resume], user_id: str
) -> None:
    """路径不存在 → 400。"""
    resume = resume_factory(user_id=user_id)
    response = api_client.patch(
        f"/resumes/{resume.id}",
        json={"operations": [{"op": "replace", "path": "/nope", "value": 1}]},
    )
    assert response.status_code == 400
    assert response.json()["code"] == "INVALID_PATCH_OPERATIONS"


def test_patch_resume_locked_returns_400(
    api_client: TestClient, authed: str, resume_factory: Callable[..., Resume], user_id: str
) -> None:
    """锁定 → 400 `RESUME_LOCKED`。"""
    resume = resume_factory(user_id=user_id, is_locked=True)
    response = api_client.patch(
        f"/resumes/{resume.id}",
        json={"operations": [{"op": "replace", "path": "/basics/name", "value": "x"}]},
    )
    assert response.status_code == 400
    assert response.json()["code"] == "RESUME_LOCKED"


def test_patch_resume_version_conflict_returns_409(
    api_client: TestClient, authed: str, resume_factory: Callable[..., Resume], user_id: str
) -> None:
    """`expectedUpdatedAt` 对不上 → 409，回带当前 `updatedAt`。"""
    resume = resume_factory(user_id=user_id)
    stale = to_iso_millis(resume.updated_at - timedelta(minutes=5))

    response = api_client.patch(
        f"/resumes/{resume.id}",
        json={
            "operations": [{"op": "replace", "path": "/basics/name", "value": "x"}],
            "expectedUpdatedAt": stale,
        },
    )
    assert response.status_code == 409
    assert response.json()["code"] == "RESUME_VERSION_CONFLICT"


def test_patch_resume_matching_expected_updated_at_succeeds(
    api_client: TestClient, authed: str, resume_factory: Callable[..., Resume], user_id: str
) -> None:
    """`expectedUpdatedAt` 对得上 → 200。

    毫秒级比较：Postgres 的 `updated_at` 带微秒，直接比会永远 409。
    """
    resume = resume_factory(user_id=user_id)
    current = to_iso_millis(resume.updated_at)

    response = api_client.patch(
        f"/resumes/{resume.id}",
        json={
            "operations": [{"op": "replace", "path": "/basics/name", "value": "王五"}],
            "expectedUpdatedAt": current,
        },
    )
    assert response.status_code == 200
    assert response.json()["data"]["basics"]["name"] == "王五"


# ---------------------------------------------------------------------------
# deleteResume
# ---------------------------------------------------------------------------


def test_delete_resume_removes_row(
    api_client: TestClient,
    authed: str,
    resume_factory: Callable[..., Resume],
    user_id: str,
    db_session: Session,
) -> None:
    """happy path：200，行真的没了。"""
    resume = resume_factory(user_id=user_id)

    response = api_client.delete(f"/resumes/{resume.id}")
    assert response.status_code == 200
    assert db_session.get(Resume, resume.id) is None


def test_delete_resume_unauthenticated_returns_401(
    api_client: TestClient, resume_factory: Callable[..., Resume], user_id: str
) -> None:
    """未认证 → 401。"""
    resume = resume_factory(user_id=user_id)
    assert api_client.delete(f"/resumes/{resume.id}").status_code == 401


def test_delete_resume_other_users_resume_returns_404(
    api_client: TestClient,
    authed: str,
    user_factory: Callable[..., object],
    resume_factory: Callable[..., Resume],
) -> None:
    """越权 → 404，且别人的简历还在。"""
    foreign = resume_factory(user_id=user_factory().id)
    assert api_client.delete(f"/resumes/{foreign.id}").status_code == 404


def test_delete_resume_locked_returns_400(
    api_client: TestClient, authed: str, resume_factory: Callable[..., Resume], user_id: str
) -> None:
    """锁定 → 400 `RESUME_LOCKED`。"""
    resume = resume_factory(user_id=user_id, is_locked=True)

    response = api_client.delete(f"/resumes/{resume.id}")
    assert response.status_code == 400
    assert response.json()["code"] == "RESUME_LOCKED"


# ---------------------------------------------------------------------------
# getResumeBySlug（公开）
# ---------------------------------------------------------------------------


def test_get_resume_by_slug_public_without_cookie(
    api_client: TestClient, resume_factory: Callable[..., Resume], user_id: str, user_factory: Callable[..., object]
) -> None:
    """happy path：公开简历，不需要 cookie。"""
    from app.db.models import User

    owner = api_client.app.dependency_overrides[get_db]().get(User, user_id)
    resume = resume_factory(user_id=user_id, is_public=True, slug="public-cv")

    body = api_client.get(f"/resumes/{owner.username}/public-cv").json()
    assert body["id"] == resume.id
    assert body["isPublic"] is True


def test_get_resume_by_slug_owner_can_see_private(
    api_client: TestClient, authed: str, resume_factory: Callable[..., Resume], user_id: str
) -> None:
    """带 cookie 的 owner 能看自己的私有简历。"""
    from app.db.models import User

    owner = api_client.app.dependency_overrides[get_db]().get(User, user_id)
    resume = resume_factory(user_id=user_id, is_public=False, slug="private-cv")

    body = api_client.get(f"/resumes/{owner.username}/private-cv").json()
    assert body["id"] == resume.id


def test_get_resume_by_slug_stranger_cannot_see_private(
    api_client: TestClient, resume_factory: Callable[..., Resume], user_id: str
) -> None:
    """陌生人对私有简历 → 404（与「不存在」同形，不泄露存在性）。"""
    from app.db.models import User

    owner = api_client.app.dependency_overrides[get_db]().get(User, user_id)
    resume_factory(user_id=user_id, is_public=False, slug="private-cv")

    response = api_client.get(f"/resumes/{owner.username}/private-cv")
    assert response.status_code == 404
    assert response.json()["code"] == "NOT_FOUND"


def test_get_resume_by_slug_unknown_slug_returns_404(
    api_client: TestClient, resume_factory: Callable[..., Resume], user_id: str
) -> None:
    """slug 不存在 → 404。"""
    from app.db.models import User

    owner = api_client.app.dependency_overrides[get_db]().get(User, user_id)
    assert api_client.get(f"/resumes/{owner.username}/nope").status_code == 404


def test_get_resume_by_slug_unknown_username_returns_404(api_client: TestClient) -> None:
    """username 不存在 → 404。"""
    assert api_client.get("/resumes/nobody/cv").status_code == 404


def test_get_resume_by_slug_password_protected_returns_401(
    api_client: TestClient, resume_factory: Callable[..., Resume], user_id: str
) -> None:
    """设了密码且没通过验证 → 401 `NEED_PASSWORD`。"""
    from app.db.models import User

    owner = api_client.app.dependency_overrides[get_db]().get(User, user_id)
    resume_factory(user_id=user_id, is_public=True, slug="locked-cv", password="hashed")

    response = api_client.get(f"/resumes/{owner.username}/locked-cv")
    assert response.status_code == 401
    assert response.json()["code"] == "NEED_PASSWORD"


def test_get_resume_by_slug_password_verified_cookie_passes(
    api_client: TestClient, resume_factory: Callable[..., Resume], user_id: str
) -> None:
    """带着 `resume_access_<id>` cookie（Node 验密后发的那个）就能看。"""
    from app.db.models import User

    owner = api_client.app.dependency_overrides[get_db]().get(User, user_id)
    resume = resume_factory(user_id=user_id, is_public=True, slug="locked-cv", password="hashed")
    api_client.cookies.set(f"resume_access_{resume.id}", _access_cookie(resume.id, "hashed"))

    assert api_client.get(f"/resumes/{owner.username}/locked-cv").status_code == 200


def test_get_resume_by_slug_redacts_owner_only_fields(
    api_client: TestClient, resume_factory: Callable[..., Resume], user_id: str
) -> None:
    """非 owner 视角：`name` 变 `Resume`，`data.metadata.notes` 清空。"""
    from app.db.models import User

    owner = api_client.app.dependency_overrides[get_db]().get(User, user_id)
    resume_factory(user_id=user_id, is_public=True, slug="public-cv")

    body = api_client.get(f"/resumes/{owner.username}/public-cv").json()
    assert body["name"] == "Resume"
    assert body["data"]["metadata"]["notes"] == ""
    # 简历本身的内容照出，只脱敏上面两处。
    assert body["data"]["basics"]["name"] == "张三"


def test_get_resume_by_slug_owner_sees_unredacted(
    api_client: TestClient, authed: str, resume_factory: Callable[..., Resume], user_id: str
) -> None:
    """owner 自己看不做脱敏。"""
    from app.db.models import User

    owner = api_client.app.dependency_overrides[get_db]().get(User, user_id)
    resume_factory(user_id=user_id, is_public=False, slug="mine", name="我的简历")

    body = api_client.get(f"/resumes/{owner.username}/mine").json()
    assert body["name"] == "我的简历"
    assert body["data"]["metadata"]["notes"] == "作者私有的备注"


def test_get_resume_by_slug_increments_views_for_stranger(
    api_client: TestClient,
    resume_factory: Callable[..., Resume],
    user_id: str,
    db_session: Session,
) -> None:
    """陌生人访问 → `resume_statistics.views` +1。"""
    from app.db.models import ResumeStatistics, User
    from sqlalchemy import select

    owner = db_session.get(User, user_id)
    resume = resume_factory(user_id=user_id, is_public=True, slug="public-cv")

    api_client.get(f"/resumes/{owner.username}/public-cv")
    api_client.get(f"/resumes/{owner.username}/public-cv")

    row = db_session.execute(
        select(ResumeStatistics).where(ResumeStatistics.resume_id == resume.id)
    ).scalar_one()
    assert row.views == 2


def test_get_resume_by_slug_owner_view_does_not_count(
    api_client: TestClient,
    authed: str,
    resume_factory: Callable[..., Resume],
    user_id: str,
    db_session: Session,
) -> None:
    """owner 自己预览不计入统计（否则作者每次预览都在给自己的数据灌水）。"""
    from app.db.models import ResumeStatistics, User
    from sqlalchemy import select

    owner = db_session.get(User, user_id)
    resume = resume_factory(user_id=user_id, is_public=True, slug="public-cv")

    api_client.get(f"/resumes/{owner.username}/public-cv")

    row = db_session.execute(
        select(ResumeStatistics).where(ResumeStatistics.resume_id == resume.id)
    ).scalar_one_or_none()
    assert row is None


# ---------------------------------------------------------------------------
# 其它跨端点的边界
# ---------------------------------------------------------------------------


def test_python_side_never_sets_auth_cookies(
    api_client: TestClient, authed: str, resume_factory: Callable[..., Resume], user_id: str
) -> None:
    """Python 侧不发 cookie、不刷新会话：响应里不该出现 `Set-Cookie`。

    会话生命周期仍归 Node 的 Better Auth，Python 只**读** `session` 表认人。
    """
    resume = resume_factory(user_id=user_id)
    for response in (
        api_client.get("/resumes"),
        api_client.post("/resumes", json={"name": "n", "slug": "s"}),
        api_client.get(f"/resumes/{resume.id}"),
    ):
        assert "set-cookie" not in {key.lower() for key in response.headers}


def test_generated_ids_are_uuidv7_shaped(api_client: TestClient, authed: str) -> None:
    """id 必须是 UUIDv7 的形态（与 Node `generateId()` 同字符集 / 同长度）。"""
    import re

    resume_id = api_client.post("/resumes", json={"name": "n", "slug": "s"}).json()
    assert re.fullmatch(
        r"[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", resume_id
    )
