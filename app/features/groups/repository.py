from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Iterable

import asyncpg

from app.core.repository import RepositoryBase, RepositoryError, _iso, assert_rpc_success


class GroupRepositoryMixin(RepositoryBase):
    # 신청 목록은 신청자 닉네임을 함께 조회한다 (화면에 ID 조각 대신 이름 표시)
    _JOIN_REQUEST_SELECT = (
        "select r.id, r.group_id, r.user_id, r.message, r.status, r.reason, r.decided_by, r.decided_at, "
        "r.created_at, r.updated_at, u.display_name, u.avatar_url "
        "from group_join_requests r left join users u on u.id = r.user_id"
    )
    _MEMBER_SELECT = (
        "select gm.group_id, gm.user_id, gm.role, gm.joined_at, u.display_name, u.avatar_url "
        "from group_members gm join users u on u.id = gm.user_id"
    )

    async def _group_counts(self, group_ids: list[str]) -> dict[str, tuple[int, int]]:
        """실제 활성 멤버 수·신청 대기 수 (db/003_group_counts.sql 의 security definer 함수).

        신청 목록은 RLS 로 본인·모임장만 보이므로, 개수는 DB 함수로만 정확히 셀 수 있다.
        함수가 아직 적용되지 않은 DB 에서는 빈 dict 를 돌려 기존 계산으로 대체한다.
        """
        if not group_ids:
            return {}
        try:
            rows = await self._pool().fetch("select * from public.group_counts($1::text[])", group_ids)
        except asyncpg.UndefinedFunctionError:
            return {}
        return {row["group_id"]: (row["member_count"], row["pending_request_count"]) for row in rows}

    def _group_view(self, row, members, requests, comments, schedule, proposals, counts: tuple[int, int] | None) -> dict:
        member_count, pending_count = counts if counts else (row["member_count"], sum(item["status"] == "pending" for item in requests))
        return {
            "id": row["id"], "festivalId": row["festival_id"], "title": row["title"], "postBody": row["post_body"], "leaderId": row["leader_id"], "joinMode": row["join_mode"], "capacity": row["capacity"], "memberCount": member_count, "status": row["status"],
            "members": [{"userId": m["user_id"], "role": m["role"], "joinedAt": _iso(m["joined_at"]), "user": {"id": m["user_id"], "displayName": m["display_name"], "avatarUrl": m["avatar_url"]}} for m in members],
            "pendingRequestCount": pending_count, "joinRequests": [self._join_request_view(item) for item in requests], "comments": [self._comment_view(item) for item in comments], "schedule": self._schedule_view(schedule, proposals), "createdAt": _iso(row["created_at"]), "updatedAt": _iso(row["updated_at"]), "version": row["version"],
        }

    async def group(self, group_id: str, *, include_comments: bool = True) -> dict | None:
        row = await self._pool().fetchrow("select * from groups where id = $1", group_id)
        if not row:
            return None
        members = await self._pool().fetch(f"{self._MEMBER_SELECT} where gm.group_id = $1 and gm.left_at is null order by gm.joined_at", group_id)
        requests = await self._pool().fetch(f"{self._JOIN_REQUEST_SELECT} where r.group_id = $1 order by r.created_at", group_id)
        comments = await self._pool().fetch("select c.id, c.group_id, c.author_id, c.text, c.created_at, u.display_name from group_comments c join users u on u.id = c.author_id where c.group_id = $1 and c.deleted_at is null order by c.created_at", group_id) if include_comments else []
        schedule = await self._pool().fetchrow("select * from group_schedules where group_id = $1", group_id)
        proposals = await self._pool().fetch("select * from schedule_proposals where group_id = $1 order by created_at", group_id)
        counts = (await self._group_counts([group_id])).get(group_id)
        return self._group_view(row, members, requests, comments, schedule, proposals, counts)

    @staticmethod
    def _join_request_view(row: asyncpg.Record) -> dict:
        view = {"id": row["id"], "groupId": row["group_id"], "userId": row["user_id"], "message": row["message"], "status": row["status"], "reason": row["reason"], "decidedBy": row["decided_by"], "decidedAt": _iso(row["decided_at"]), "createdAt": _iso(row["created_at"]), "updatedAt": _iso(row["updated_at"])}
        keys = row.keys() if hasattr(row, "keys") else []
        if "display_name" in keys:
            view["user"] = {"id": row["user_id"], "displayName": row["display_name"], "avatarUrl": row["avatar_url"] if "avatar_url" in keys else None}
        return view

    @staticmethod
    def _comment_view(row: asyncpg.Record) -> dict:
        return {"id": row["id"], "groupId": row["group_id"], "author": {"id": row["author_id"], "displayName": row["display_name"]}, "text": row["text"], "createdAt": _iso(row["created_at"])}

    @staticmethod
    def _schedule_view(row: asyncpg.Record | None, proposals: Iterable[asyncpg.Record]) -> dict:
        items = (row["items"] if row else []) or []
        items = json.loads(items) if isinstance(items,str) else items
        return {
            "version": row["version"] if row else 1,
            "current": items[0] if items else None,
            "items": items,
            "validation": {"status": row["validation_status"], "conflict": row["conflict"]} if row and row["validation_status"] else None,
            "proposals": [{"id": p["id"], "groupId": p["group_id"], "status": p["status"], "strategy": p["strategy"], "schedule": ((json.loads(p["items"]) if isinstance(p["items"],str) else p["items"]) or [None])[0], "items": (json.loads(p["items"]) if isinstance(p["items"],str) else p["items"]) or [], "createdAt": _iso(p["created_at"]), "version": p["base_version"], "reason": p["reason"]} for p in proposals],
        }

    async def list_groups(self, *, festival_id: str | None, status: str | None, keyword: str | None) -> list[dict]:
        clauses = ["1 = 1"]
        args: list[Any] = []
        if festival_id:
            args.append(festival_id); clauses.append(f"festival_id = ${len(args)}")
        if status:
            args.append(status); clauses.append(f"status = ${len(args)}")
        if keyword:
            args.append(f"%{keyword}%"); clauses.append(f"(title ilike ${len(args)} or post_body ilike ${len(args)})")
        rows = await self._pool().fetch(f"select * from groups where {' and '.join(clauses)} order by created_at desc", *args)
        if not rows:
            return []
        # 모임마다 5~6번 조회하던 것(N+1)을 모임 수와 무관하게 6번으로 묶는다
        ids = [row["id"] for row in rows]
        pool = self._pool()
        member_rows = await pool.fetch(f"{self._MEMBER_SELECT} where gm.group_id = any($1::text[]) and gm.left_at is null order by gm.joined_at", ids)
        request_rows = await pool.fetch(f"{self._JOIN_REQUEST_SELECT} where r.group_id = any($1::text[]) order by r.created_at", ids)
        schedule_rows = await pool.fetch("select * from group_schedules where group_id = any($1::text[])", ids)
        proposal_rows = await pool.fetch("select * from schedule_proposals where group_id = any($1::text[]) order by created_at", ids)
        counts = await self._group_counts(ids)

        def by_group(items):
            grouped: dict[str, list] = {}
            for item in items:
                grouped.setdefault(item["group_id"], []).append(item)
            return grouped

        members, requests, proposals = by_group(member_rows), by_group(request_rows), by_group(proposal_rows)
        schedules = {item["group_id"]: item for item in schedule_rows}
        return [
            self._group_view(row, members.get(row["id"], []), requests.get(row["id"], []), [], schedules.get(row["id"]), proposals.get(row["id"], []), counts.get(row["id"]))
            for row in rows
        ]

    async def comments(self, group_id: str, *, offset: int = 0, limit: int = 20) -> tuple[list[dict], int]:
        """Read comments from PostgreSQL with server-side pagination."""
        pool = self._pool()
        total = await pool.fetchval(
            "select count(*) from group_comments where group_id=$1 and deleted_at is null",
            group_id,
        )
        rows = await pool.fetch(
            """
            select c.id, c.group_id, c.author_id, c.text, c.created_at, u.display_name
            from group_comments c
            join users u on u.id = c.author_id
            where c.group_id=$1 and c.deleted_at is null
            order by c.created_at asc, c.id asc
            offset $2 limit $3
            """,
            group_id,
            offset,
            limit,
        )
        return [self._comment_view(row) for row in rows], int(total or 0)

    async def join_requests(
        self,
        group_id: str,
        *,
        status: str | None = None,
        offset: int = 0,
        limit: int = 20,
    ) -> tuple[list[dict], int]:
        """Read join requests from PostgreSQL with server-side pagination."""
        clauses = ["r.group_id=$1"]
        args: list[Any] = [group_id]
        if status:
            args.append(status)
            clauses.append(f"r.status=${len(args)}")
        where = " and ".join(clauses)
        pool = self._pool()
        total = await pool.fetchval(f"select count(*) from group_join_requests r where {where}", *args)
        args.extend([offset, limit])
        rows = await pool.fetch(
            f"{self._JOIN_REQUEST_SELECT} where {where} order by r.created_at asc, r.id asc offset ${len(args)-1} limit ${len(args)}",
            *args,
        )
        return [self._join_request_view(row) for row in rows], int(total or 0)

    async def create_group(self, user_id: str, payload: dict) -> dict:
        group_id = payload.get("workflowGroupId") or f"grp_{datetime.now(timezone.utc).strftime('%y%m%d%H%M%S%f')}"
        async with self._pool().acquire() as connection:
            async with connection.transaction():
                festival = await connection.fetchrow("select id, name, start_date from festivals where id = $1", payload["festivalId"])
                if not festival:
                    raise RepositoryError("FESTIVAL_NOT_FOUND", "축제를 찾을 수 없습니다.", 404)
                await connection.execute("insert into groups (id, festival_id, leader_id, title, post_body, join_mode, capacity, member_count, status, version) values ($1,$2,$3,$4,$5,$6,$7,1,'open',1)", group_id, payload["festivalId"], user_id, payload["title"], payload["postBody"], payload["joinMode"], payload["capacity"])
                await connection.execute("insert into group_members (group_id, user_id, role) values ($1,$2,'leader')", group_id, user_id)
                await connection.execute("insert into group_schedules (group_id, items, version, validation_status, updated_by) values ($1,$2::jsonb,1,'valid',$3)", group_id, json.dumps([{"date": payload.get("conditions", {}).get("date") or _iso(festival["start_date"]), "time": payload.get("conditions", {}).get("start_time") or "13:00", "label": festival["name"], "description": "모임 기본 일정"}]), user_id)
        return await self.group(group_id)  # type: ignore[return-value]

    async def update_group(self, group_id: str, values: dict, version: int, leader_id: str) -> dict | None:
        fields = [(key, values[key]) for key in ("title", "postBody", "capacity") if key in values]
        if not fields:
            return await self.group(group_id)
        async with self._pool().acquire() as connection:
            async with connection.transaction():
                result = await connection.fetchval(
                    "select public.rpc_update_group($1,$2,$3,$4,$5,$6)",
                    group_id,
                    leader_id,
                    version,
                    values.get("title"),
                    values.get("postBody"),
                    values.get("capacity"),
                )
                assert_rpc_success(result)
        return await self.group(group_id)

    async def add_comment(self, group_id: str, user_id: str, text: str) -> dict:
        row = await self._pool().fetchrow("insert into group_comments (group_id, author_id, text) values ($1,$2,$3) returning id, group_id, author_id, text, created_at", group_id, user_id, text)
        full = await self._pool().fetchrow("select c.id, c.group_id, c.author_id, c.text, c.created_at, u.display_name from group_comments c join users u on u.id=c.author_id where c.id=$1", row["id"])
        return self._comment_view(full)

    async def delete_comment(self, group_id: str, comment_id: str, user_id: str) -> bool:
        row = await self._pool().fetchrow("select c.author_id, g.leader_id from group_comments c join groups g on g.id=c.group_id where c.id=$1 and c.group_id=$2 and c.deleted_at is null", comment_id, group_id)
        if not row:
            return False
        if user_id not in {row["author_id"], row["leader_id"]}:
            raise RepositoryError("COMMENT_DELETE_FORBIDDEN", "댓글 삭제 권한이 없습니다.", 403)
        await self._pool().execute("update group_comments set deleted_at=now(), updated_at=now() where id=$1", comment_id)
        return True

    async def join_request(self, group_id: str, request_id: str) -> asyncpg.Record | None:
        return await self._pool().fetchrow("select * from group_join_requests where id=$1 and group_id=$2", request_id, group_id)

    async def create_join_request(self, group_id: str, user_id: str, message: str | None, version: int | None = None) -> dict:
        async with self._pool().acquire() as connection:
            async with connection.transaction():
                result = await connection.fetchval(
                    "select public.rpc_create_group_join_request($1,$2,$3,$4)",
                    group_id,
                    user_id,
                    message,
                    version,
                )
                result = assert_rpc_success(result)
        if result.get("mode") == "approval":
            item = await self.join_request(group_id, result["request_id"])
            if not item:
                raise RepositoryError("JOIN_REQUEST_NOT_FOUND", "참여 신청을 찾을 수 없습니다.", 503)
            return {"request": self._join_request_view(item), "membership": None, "group": await self.group(group_id)}
        group = await self.group(group_id)
        member = next(item for item in group["members"] if item["userId"] == user_id)
        return {"request": None, "membership": member, "group": group}

        '''Legacy pre-RPC implementation retained only as migration reference.
        if False:
            return None
        async with self._pool().acquire() as connection:
            async with connection.transaction():
                group = await connection.fetchrow("select * from groups where id=$1 for update", group_id)
                if not group:
                    raise RepositoryError("GROUP_NOT_FOUND", "모임을 찾을 수 없습니다.", 404)
                member = await connection.fetchrow("select 1 from group_members where group_id=$1 and user_id=$2 and left_at is null", group_id, user_id)
                if member:
                    raise RepositoryError("ALREADY_MEMBER", "이미 참여 중인 모임입니다.")
                pending = await connection.fetchrow("select 1 from group_join_requests where group_id=$1 and user_id=$2 and status='pending'", group_id, user_id)
                if pending:
                    raise RepositoryError("JOIN_REQUEST_ALREADY_EXISTS", "이미 대기 중인 참여 신청이 있습니다.")
                if group["status"] in {"full", "closed", "cancelled"}:
                    raise RepositoryError("GROUP_CLOSED", "참여할 수 없는 모임입니다.")
                if group["join_mode"] == "instant":
                    if group["member_count"] >= group["capacity"]:
                        raise RepositoryError("GROUP_CAPACITY_EXCEEDED", "모임 정원이 가득 찼습니다.")
                    await connection.execute("insert into group_members (group_id,user_id,role) values ($1,$2,'member')", group_id, user_id)
                    await connection.execute("update groups set member_count=member_count+1, version=version+1, status=case when member_count+1 >= capacity then 'full' else 'open' end, updated_at=now() where id=$1", group_id)
                    item = None
                else:
                    item = await connection.fetchrow("insert into group_join_requests (group_id,user_id,message) values ($1,$2,$3) returning *", group_id, user_id, message)
        if item:
            return {"request": self._join_request_view(item), "membership": None, "group": await self.group(group_id)}
        group = await self.group(group_id)
        member = next(item for item in group["members"] if item["userId"] == user_id)
        return {"request": None, "membership": member, "group": group}

        '''

    async def approve_join_request(self, group_id: str, request_id: str, leader_id: str, version: int) -> dict:
        async with self._pool().acquire() as connection:
            async with connection.transaction():
                result = await connection.fetchval(
                    "select public.rpc_approve_group_join_request($1,$2,$3,$4)",
                    group_id,
                    request_id,
                    leader_id,
                    version,
                )
                result = assert_rpc_success(result)
        group_view = await self.group(group_id)
        member = next(item for item in group_view["members"] if item["userId"] == result["user_id"])
        return {"membership": member, "group": group_view}

        '''Legacy pre-RPC implementation retained only as migration reference.
        if False:
            return None
        approved_user_id: str | None = None
        async with self._pool().acquire() as connection:
            async with connection.transaction():
                group = await connection.fetchrow("select * from groups where id=$1 for update", group_id)
                if not group:
                    raise RepositoryError("GROUP_NOT_FOUND", "모임을 찾을 수 없습니다.", 404)
                if group["leader_id"] != leader_id:
                    raise RepositoryError("LEADER_ONLY", "모임장만 수행할 수 있습니다.", 403)
                if group["version"] != version:
                    raise RepositoryError("RESOURCE_VERSION_CONFLICT", "리소스 버전이 변경되었습니다.", 409)
                item = await connection.fetchrow("select * from group_join_requests where id=$1 and group_id=$2 for update", request_id, group_id)
                if not item:
                    raise RepositoryError("JOIN_REQUEST_NOT_FOUND", "참여 신청을 찾을 수 없습니다.", 404)
                if item["status"] != "pending":
                    raise RepositoryError("JOIN_REQUEST_NOT_PENDING", "대기 중인 참여 신청이 아닙니다.")
                if group["member_count"] >= group["capacity"]:
                    raise RepositoryError("GROUP_CAPACITY_EXCEEDED", "모임 정원이 가득 찼습니다.")
                approved_user_id = item["user_id"]
                await connection.execute("update group_join_requests set status='approved', decided_by=$1, decided_at=now(), updated_at=now() where id=$2", leader_id, request_id)
                await connection.execute("insert into group_members (group_id,user_id,role) values ($1,$2,'member')", group_id, item["user_id"])
                await connection.execute("update groups set member_count=member_count+1, version=version+1, status=case when member_count+1 >= capacity then 'full' else 'open' end, updated_at=now() where id=$1", group_id)
                await connection.execute("insert into group_messages (group_id,type,text,system_event) values ($1,'system',$2,'member_approved')", group_id, "새 멤버가 합류했습니다.")
                await connection.execute("insert into alerts (user_id,type,festival_id,group_id,severity,title,message,event_key) values ($1,'festival_changed',$2,$3,'info','참여 신청이 승인되었습니다','모임 채팅에 참여할 수 있습니다.',$4)", item["user_id"], group["festival_id"], group_id, f"join-approved:{request_id}")
        group_view = await self.group(group_id)
        member = next(item for item in group_view["members"] if item["userId"] == approved_user_id)
        return {"membership": member, "group": group_view}

        '''

    async def reject_join_request(self, group_id: str, request_id: str, leader_id: str, version: int, reason: str | None) -> dict | None:
        async with self._pool().acquire() as connection:
            async with connection.transaction():
                group = await connection.fetchrow("select leader_id, version from groups where id=$1 for update", group_id)
                if not group:
                    raise RepositoryError("GROUP_NOT_FOUND", "모임을 찾을 수 없습니다.", 404)
                if group["leader_id"] != leader_id:
                    raise RepositoryError("LEADER_ONLY", "모임장만 수행할 수 있습니다.", 403)
                if group["version"] != version:
                    raise RepositoryError("RESOURCE_VERSION_CONFLICT", "리소스 버전이 변경되었습니다.", 409)
                row = await connection.fetchrow(
                    "update group_join_requests set status='rejected', reason=$1, decided_by=$2, decided_at=now(), updated_at=now() "
                    "where id=$3 and group_id=$4 and status='pending' returning *",
                    reason,
                    leader_id,
                    request_id,
                    group_id,
                )
                if row:
                    await connection.execute("update groups set version=version+1, updated_at=now() where id=$1", group_id)
        return self._join_request_view(row) if row else None

    async def leave_group(self, group_id: str, user_id: str) -> None:
        async with self._pool().acquire() as connection:
            async with connection.transaction():
                group = await connection.fetchrow("select id from groups where id=$1 for update", group_id)
                if not group:
                    raise RepositoryError("GROUP_NOT_FOUND", "모임을 찾을 수 없습니다.", 404)
                member = await connection.fetchrow("select role from group_members where group_id=$1 and user_id=$2 and left_at is null", group_id, user_id)
                if not member:
                    raise RepositoryError("GROUP_MEMBER_ONLY", "참여 멤버만 탈퇴할 수 있습니다.", 403)
                if member["role"] == "leader":
                    raise RepositoryError("LEADER_CANNOT_LEAVE", "모임장은 먼저 모임을 종료하거나 양도해야 합니다.", 422)
                await connection.execute("update group_members set left_at=now() where group_id=$1 and user_id=$2 and left_at is null", group_id, user_id)
                await connection.execute("update groups set member_count=greatest(member_count-1,0), version=version+1, status=case when member_count-1 >= capacity then 'full' else 'open' end, updated_at=now() where id=$1", group_id)
