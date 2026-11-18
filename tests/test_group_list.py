"""모임 목록: 일괄 조회(N+1 제거), 실제 인원·대기 수, 신청자 닉네임."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone

import asyncpg
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.features.groups.repository import GroupRepositoryMixin
from app.features.groups.router import router

NOW = datetime(2026, 11, 17, tzinfo=timezone.utc)


def group_row(gid, member_count=1):
    return {"id": gid, "festival_id": "fst_tour_1", "title": "t", "post_body": "b", "leader_id": "usr_l", "join_mode": "approval",
            "capacity": 4, "member_count": member_count, "status": "open", "created_at": NOW, "updated_at": NOW, "version": 1}


def request_row(gid, uid, status="pending", name="하늘"):
    return {"id": f"req_{uid}", "group_id": gid, "user_id": uid, "message": "15시", "status": status, "reason": None,
            "decided_by": None, "decided_at": None, "created_at": NOW, "updated_at": NOW, "display_name": name, "avatar_url": None}


class FakePool:
    def __init__(self, counts_available=True):
        self.queries, self.counts_available = [], counts_available

    async def fetchval(self, sql, *args):
        self.queries.append(sql)
        return 2

    async def fetch(self, sql, *args):
        self.queries.append(sql)
        if "from groups where" in sql:
            return [group_row("grp_1", member_count=9), group_row("grp_2")]
        if "group_counts" in sql:
            if not self.counts_available:
                raise asyncpg.UndefinedFunctionError("function public.group_counts(text[]) does not exist")
            return [{"group_id": "grp_1", "member_count": 3, "pending_request_count": 2}, {"group_id": "grp_2", "member_count": 1, "pending_request_count": 0}]
        if "from group_members" in sql:
            return [{"group_id": "grp_1", "user_id": "usr_l", "role": "leader", "joined_at": NOW, "display_name": "리더", "avatar_url": None}]
        if "from group_join_requests" in sql:
            return [request_row("grp_1", "usr_h")]
        return []


class Repo(GroupRepositoryMixin):
    def __init__(self, pool):
        self.pool = pool

    def _pool(self):
        return self.pool


def test_list_uses_db_counts_and_constant_queries():
    pool = FakePool()
    items, total = asyncio.run(Repo(pool).list_groups(festival_id=None, status=None, keyword=None, offset=0, limit=100))
    assert total == 2
    assert [(i["memberCount"], i["pendingRequestCount"]) for i in items] == [(3, 2), (1, 0)]
    assert len(pool.queries) == 7  # 모임 수와 무관


def test_join_requests_include_display_name():
    items, _ = asyncio.run(Repo(FakePool()).list_groups(festival_id=None, status=None, keyword=None, offset=0, limit=100))
    assert items[0]["joinRequests"][0]["user"]["displayName"] == "하늘"


def test_falls_back_when_count_function_missing():
    items, _ = asyncio.run(Repo(FakePool(counts_available=False)).list_groups(festival_id=None, status=None, keyword=None, offset=0, limit=100))
    assert items[0]["memberCount"] == 9 and items[0]["pendingRequestCount"] == 1


def test_second_page_fetches_related_data_only_for_requested_groups():
    class PagedPool:
        def __init__(self):
            self.rows = [group_row(f"grp_{index:03d}") for index in range(103, 0, -1)]
            self.related_ids = []
            self.page_queries = []

        async def fetchval(self, sql, *args):
            assert "select count(*) from groups" in sql
            return len(self.rows)

        async def fetch(self, sql, *args):
            if "from groups where" in sql:
                self.page_queries.append((sql, args))
                if "limit" not in sql:
                    return self.rows
                limit, offset = args[-2:]
                return self.rows[offset : offset + limit]
            self.related_ids.append(args[0])
            return []

    pool = PagedPool()
    app = FastAPI()
    app.include_router(router)
    app.state.repository = Repo(pool)
    with TestClient(app) as client:
        second_page = client.get("/groups?page=2&pageSize=100")
        out_of_range = client.get("/groups?page=3&pageSize=100")

    assert second_page.status_code == 200
    data = second_page.json()["data"]
    assert data["total"] == 103
    requested_ids = ["grp_003", "grp_002", "grp_001"]
    assert [item["id"] for item in data["items"]] == requested_ids
    assert out_of_range.json()["data"] == {"items": [], "page": 3, "pageSize": 100, "total": 103}
    assert pool.related_ids and all(ids == requested_ids for ids in pool.related_ids)
    assert len(pool.page_queries) == 1
    sql, args = pool.page_queries[0]
    assert "order by created_at desc, id desc" in sql
    assert args == (100, 100)
