"""모임 목록: 일괄 조회(N+1 제거), 실제 인원·대기 수, 신청자 닉네임."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone

import asyncpg

from app.features.groups.repository import GroupRepositoryMixin

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
    items = asyncio.run(Repo(pool).list_groups(festival_id=None, status=None, keyword=None))
    assert [(i["memberCount"], i["pendingRequestCount"]) for i in items] == [(3, 2), (1, 0)]
    assert len(pool.queries) == 6  # 모임 수와 무관


def test_join_requests_include_display_name():
    items = asyncio.run(Repo(FakePool()).list_groups(festival_id=None, status=None, keyword=None))
    assert items[0]["joinRequests"][0]["user"]["displayName"] == "하늘"


def test_falls_back_when_count_function_missing():
    items = asyncio.run(Repo(FakePool(counts_available=False)).list_groups(festival_id=None, status=None, keyword=None))
    assert items[0]["memberCount"] == 9 and items[0]["pendingRequestCount"] == 1
