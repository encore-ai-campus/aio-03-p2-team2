from __future__ import annotations

import json
from datetime import date, datetime, time, timezone
from typing import Any, Iterable

import asyncpg

from app.core.database import Database


class RepositoryError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 409, details: Any | None = None) -> None:
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details
        super().__init__(message)


def _time(value: str | time | None) -> time | None:
    if value is None or isinstance(value, time):
        return value
    return time.fromisoformat(value)


def _hhmm(value: Any) -> str | None:
    if value is None:
        return None
    return value.strftime("%H:%M") if hasattr(value, "strftime") else str(value)[:5]


def _iso(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    if isinstance(value, date):
        return value.isoformat()
    return str(value)


class SupabaseRepository:
    """PostgreSQL repository used by the HTTP features.

    The API deliberately keeps response shaping here so routers do not need to
    know the snake_case database schema. All write methods use a transaction
    when more than one table must change together.
    """

    def __init__(self, database: Database) -> None:
        self.database = database

    def _pool(self) -> asyncpg.Pool:
        if self.database.pool is None:
            raise RepositoryError("DATABASE_UNAVAILABLE", "데이터베이스에 연결할 수 없습니다.", 503)
        return self.database.pool

    async def user(self, user_id: str) -> dict | None:
        row = await self._pool().fetchrow(
            """
            select u.id, u.display_name, u.avatar_url,
                   p.interests, p.budget_manwon, p.travel_style, p.mbti,
                   p.preferred_party_size, p.available_from, p.default_join_mode,
                   n.push, n.email, n.risk_alert
            from users u
            left join user_profiles p on p.user_id = u.id
            left join notification_consents n on n.user_id = u.id
            where u.id = $1 and u.status = 'active'
            """,
            user_id,
        )
        return self._user_view(row) if row else None

    async def users(self, *, exclude_id: str | None = None) -> list[dict]:
        query = "select id from users where status = 'active'"
        args: list[Any] = []
        if exclude_id:
            query += " and id <> $1"
            args.append(exclude_id)
        query += " order by id"
        rows = await self._pool().fetch(query, *args)
        result = []
        for row in rows:
            item = await self.user(row["id"])
            if item:
                result.append(item)
        return result

    @staticmethod
    def _user_view(row: asyncpg.Record) -> dict:
        return {
            "id": row["id"],
            "displayName": row["display_name"],
            "avatarUrl": row["avatar_url"],
            "profile": {
                "interests": row["interests"] or [],
                "budgetManwon": row["budget_manwon"],
                "travelStyle": row["travel_style"],
                "mbti": row["mbti"] or [],
                "preferredPartySize": row["preferred_party_size"],
                "availableFrom": _hhmm(row["available_from"]),
                "defaultJoinMode": row["default_join_mode"] or "approval",
            },
            "notificationConsent": {
                "push": bool(row["push"]) if row["push"] is not None else False,
                "email": bool(row["email"]) if row["email"] is not None else False,
                "riskAlert": bool(row["risk_alert"]) if row["risk_alert"] is not None else False,
            },
        }

    async def update_profile(self, user_id: str, values: dict[str, Any]) -> dict | None:
        if not values:
            return await self.user(user_id)
        mapping = {
            "interests": "interests",
            "budgetManwon": "budget_manwon",
            "travelStyle": "travel_style",
            "mbti": "mbti",
            "preferredPartySize": "preferred_party_size",
            "availableFrom": "available_from",
            "defaultJoinMode": "default_join_mode",
        }
        fields = [(mapping[key], value) for key, value in values.items() if key in mapping]
        if not fields:
            return await self.user(user_id)
        assignments = []
        args: list[Any] = [user_id]
        for index, (column, value) in enumerate(fields, start=2):
            assignments.append(f"{column} = ${index}")
            args.append(_time(value) if column == "available_from" else value)
        await self._pool().execute(
            f"update user_profiles set {', '.join(assignments)}, updated_at = now() where user_id = $1",
            *args,
        )
        return await self.user(user_id)

    async def update_consents(self, user_id: str, values: dict[str, Any]) -> dict | None:
        mapping = {"push": "push", "email": "email", "riskAlert": "risk_alert"}
        fields = [(mapping[key], value) for key, value in values.items() if key in mapping]
        if fields:
            assignments = []
            args: list[Any] = [user_id]
            for index, (column, value) in enumerate(fields, start=2):
                assignments.append(f"{column} = ${index}")
                args.append(value)
            await self._pool().execute(
                f"update notification_consents set {', '.join(assignments)}, updated_at = now() where user_id = $1",
                *args,
            )
        row = await self._pool().fetchrow(
            "select push, email, risk_alert from notification_consents where user_id = $1",
            user_id,
        )
        return {"push": row["push"], "email": row["email"], "riskAlert": row["risk_alert"]} if row else None

    async def festival(self, festival_id: str) -> dict | None:
        row = await self._pool().fetchrow(
            "select * from festivals_with_status where id = $1",
            festival_id,
        )
        if not row:
            return None
        return await self._festival_view(row)

    async def festivals(
        self,
        *,
        year: int | None = None,
        month: int | None = None,
        start_date: date | None = None,
        end_date: date | None = None,
        region: str | None = None,
        category: str | None = None,
        keyword: str | None = None,
        status: str = "all",
    ) -> list[dict]:
        clauses = ["1 = 1"]
        args: list[Any] = []

        def add(clause: str, value: Any) -> None:
            args.append(value)
            clauses.append(clause.replace("?", f"${len(args)}"))

        if year is not None:
            add("extract(year from start_date) = ?", year)
        if month is not None:
            add("extract(month from start_date) = ?", month)
        if start_date is not None:
            add("end_date >= ?", start_date)
        if end_date is not None:
            add("start_date <= ?", end_date)
        if region:
            args.extend([region, region])
            clauses.append(f"(region = ${len(args) - 1} or city = ${len(args)})")
        if category:
            add("category = ?", category)
        if keyword:
            args.extend([f"%{keyword}%", f"%{keyword}%", f"%{keyword}%"])
            clauses.append(f"(name ilike ${len(args) - 2} or coalesce(description, '') ilike ${len(args) - 1} or array_to_string(tags, ' ') ilike ${len(args)})")
        if status == "available":
            clauses.append("end_date >= current_date and risk_status <> 'cancelled'")
        elif status == "past":
            clauses.append("end_date < current_date")
        rows = await self._pool().fetch(
            f"select * from festivals_with_status where {' and '.join(clauses)} order by start_date asc, id asc",
            *args,
        )
        return [await self._festival_view(row) for row in rows]

    async def _festival_view(self, row: asyncpg.Record) -> dict:
        hours = await self._pool().fetch(
            "select date, open_time, close_time, note from festival_operating_hours where festival_id = $1 order by date",
            row["id"],
        )
        return {
            "id": row["id"],
            "name": row["name"],
            "region": row["region"],
            "city": row["city"],
            "startDate": _iso(row["start_date"]),
            "endDate": _iso(row["end_date"]),
            "category": row["category"],
            "description": row["description"] or row["overview"] or "",
            "tags": row["tags"] or [],
            "status": row["status"],
            "source": "official_api" if row["source_updated_at"] else "manual",
            "sourceUpdatedAt": _iso(row["source_updated_at"]),
            "venue": {
                "name": row["venue_name"],
                "address": row["venue_address"],
                "latitude": row["latitude"],
                "longitude": row["longitude"],
            },
            "operatingHours": [
                {"date": _iso(item["date"]), "open": _hhmm(item["open_time"]), "close": _hhmm(item["close_time"]), "note": item["note"]}
                for item in hours
            ],
            "riskStatus": row["risk_status"],
        }

    async def upsert_festival(self, data: dict[str, Any]) -> dict:
        festival_id = data.get("id") or f"fst_{datetime.now(timezone.utc).strftime('%y%m%d%H%M%S%f')}"
        venue = data.get("venue") or {}
        async with self._pool().acquire() as connection:
            async with connection.transaction():
                await connection.execute(
                    """
                    insert into festivals (id, name, region, city, start_date, end_date, category, description,
                        tags, venue_name, venue_address, latitude, longitude, risk_status, source_updated_at)
                    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now())
                    on conflict (id) do update set name=excluded.name, region=excluded.region,
                        city=excluded.city, start_date=excluded.start_date, end_date=excluded.end_date,
                        category=excluded.category, description=excluded.description, tags=excluded.tags,
                        venue_name=excluded.venue_name, venue_address=excluded.venue_address,
                        latitude=excluded.latitude, longitude=excluded.longitude,
                        risk_status=excluded.risk_status, source_updated_at=now(), updated_at=now()
                    """,
                    festival_id, data["name"], data["region"], data.get("city"), date.fromisoformat(data["startDate"]), date.fromisoformat(data["endDate"]),
                    data["category"], data.get("description", ""), data.get("tags", []), venue.get("name"),
                    venue.get("address"), venue.get("latitude"), venue.get("longitude"), data.get("riskStatus", "normal"),
                )
                await connection.execute("delete from festival_operating_hours where festival_id = $1", festival_id)
                for item in data.get("operatingHours", []):
                    await connection.execute(
                        "insert into festival_operating_hours (festival_id, date, open_time, close_time, note) values ($1,$2,$3,$4,$5)",
                        festival_id, date.fromisoformat(item["date"]), _time(item["open"]), _time(item["close"]), item.get("note"),
                    )
        return await self.festival(festival_id)  # type: ignore[return-value]

    async def create_sync_job(self, kind: str, params: dict, requested_by: str | None = None) -> dict:
        row = await self._pool().fetchrow(
            "insert into external_sync_runs (kind, params, requested_by) values ($1,$2::jsonb,$3) returning *",
            kind, json.dumps(params), requested_by,
        )
        return self._job_view(row)

    async def update_sync_job(self, job_id: str, **values: Any) -> dict | None:
        allowed = {"status", "accepted", "rejected", "rejections", "error", "started_at", "finished_at"}
        fields = [(key, value) for key, value in values.items() if key in allowed]
        if fields:
            assignments = []
            args: list[Any] = [job_id]
            for index, (key, value) in enumerate(fields, start=2):
                assignments.append(f"{key} = ${index}" + ("::jsonb" if key == "rejections" else ""))
                if key in {"started_at", "finished_at"} and value == "now()":
                    value = datetime.now(timezone.utc)
                args.append(json.dumps(value) if key == "rejections" else value)
            await self._pool().execute(f"update external_sync_runs set {', '.join(assignments)} where id = $1", *args)
        return await self.sync_job(job_id)

    async def sync_job(self, job_id: str) -> dict | None:
        row = await self._pool().fetchrow("select * from external_sync_runs where id = $1", job_id)
        return self._job_view(row) if row else None

    @staticmethod
    def _job_view(row: asyncpg.Record) -> dict:
        return {
            "jobId": row["id"], "status": row["status"], "kind": row["kind"],
            "accepted": row["accepted"], "rejected": row["rejected"], "rejections": row["rejections"],
            "error": row["error"], "acceptedAt": _iso(row["created_at"]),
        }

    async def group(self, group_id: str, *, include_comments: bool = True) -> dict | None:
        row = await self._pool().fetchrow("select * from groups where id = $1", group_id)
        if not row:
            return None
        members = await self._pool().fetch(
            "select gm.user_id, gm.role, gm.joined_at, u.display_name, u.avatar_url from group_members gm join users u on u.id = gm.user_id where gm.group_id = $1 and gm.left_at is null order by gm.joined_at",
            group_id,
        )
        requests = await self._pool().fetch(
            "select id, group_id, user_id, message, status, reason, decided_by, decided_at, created_at, updated_at from group_join_requests where group_id = $1 order by created_at",
            group_id,
        )
        comments = await self._pool().fetch(
            "select c.id, c.group_id, c.author_id, c.text, c.created_at, u.display_name from group_comments c join users u on u.id = c.author_id where c.group_id = $1 and c.deleted_at is null order by c.created_at",
            group_id,
        ) if include_comments else []
        schedule = await self._pool().fetchrow("select * from group_schedules where group_id = $1", group_id)
        proposals = await self._pool().fetch("select * from schedule_proposals where group_id = $1 order by created_at", group_id)
        return {
            "id": row["id"], "festivalId": row["festival_id"], "title": row["title"], "postBody": row["post_body"],
            "leaderId": row["leader_id"], "joinMode": row["join_mode"], "capacity": row["capacity"],
            "memberCount": row["member_count"], "status": row["status"], "members": [
                {"userId": m["user_id"], "role": m["role"], "joinedAt": _iso(m["joined_at"]), "user": {"id": m["user_id"], "displayName": m["display_name"], "avatarUrl": m["avatar_url"]}}
                for m in members
            ],
            "pendingRequestCount": sum(item["status"] == "pending" for item in requests),
            "joinRequests": [self._join_request_view(item) for item in requests],
            "comments": [self._comment_view(item) for item in comments],
            "schedule": self._schedule_view(schedule, proposals),
            "createdAt": _iso(row["created_at"]), "updatedAt": _iso(row["updated_at"]), "version": row["version"],
        }

    @staticmethod
    def _join_request_view(row: asyncpg.Record) -> dict:
        return {"id": row["id"], "groupId": row["group_id"], "userId": row["user_id"], "message": row["message"], "status": row["status"], "reason": row["reason"], "decidedBy": row["decided_by"], "decidedAt": _iso(row["decided_at"]), "createdAt": _iso(row["created_at"]), "updatedAt": _iso(row["updated_at"])}

    @staticmethod
    def _comment_view(row: asyncpg.Record) -> dict:
        return {"id": row["id"], "groupId": row["group_id"], "author": {"id": row["author_id"], "displayName": row["display_name"]}, "text": row["text"], "createdAt": _iso(row["created_at"])}

    @staticmethod
    def _schedule_view(row: asyncpg.Record | None, proposals: Iterable[asyncpg.Record]) -> dict:
        items = (row["items"] if row else []) or []
        current = items[0] if items else None
        return {
            "version": row["version"] if row else 1,
            "current": current,
            "validation": {"status": row["validation_status"], "conflict": row["conflict"]} if row and row["validation_status"] else None,
            "proposals": [
                {"id": p["id"], "groupId": p["group_id"], "status": p["status"], "strategy": p["strategy"], "schedule": (p["items"] or [None])[0], "createdAt": _iso(p["created_at"]), "version": p["base_version"], "reason": p["reason"]}
                for p in proposals
            ],
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
        rows = await self._pool().fetch(f"select id from groups where {' and '.join(clauses)} order by created_at desc", *args)
        return [await self.group(row["id"], include_comments=False) for row in rows]  # type: ignore[misc]

    async def create_group(self, user_id: str, payload: dict) -> dict:
        group_id = f"grp_{datetime.now(timezone.utc).strftime('%y%m%d%H%M%S%f')}"
        async with self._pool().acquire() as connection:
            async with connection.transaction():
                festival = await connection.fetchrow("select id, name, start_date from festivals where id = $1", payload["festivalId"])
                if not festival:
                    raise RepositoryError("FESTIVAL_NOT_FOUND", "축제를 찾을 수 없습니다.", 404)
                await connection.execute(
                    "insert into groups (id, festival_id, leader_id, title, post_body, join_mode, capacity, member_count, status, version) values ($1,$2,$3,$4,$5,$6,$7,1,'open',1)",
                    group_id, payload["festivalId"], user_id, payload["title"], payload["postBody"], payload["joinMode"], payload["capacity"],
                )
                await connection.execute("insert into group_members (group_id, user_id, role) values ($1,$2,'leader')", group_id, user_id)
                await connection.execute(
                    "insert into group_schedules (group_id, items, version, validation_status, updated_by) values ($1,$2::jsonb,1,'valid',$3)",
                    group_id, json.dumps([{"date": _iso(festival["start_date"]), "time": "13:00", "label": festival["name"], "description": "모임 기본 일정"}]), user_id,
                )
        return await self.group(group_id)  # type: ignore[return-value]

    async def update_group(self, group_id: str, values: dict, version: int) -> dict | None:
        fields = [(key, values[key]) for key in ("title", "postBody", "capacity") if key in values]
        if not fields:
            return await self.group(group_id)
        mapping = {"title": "title", "postBody": "post_body", "capacity": "capacity"}
        assignments = []
        args: list[Any] = [group_id, version]
        for index, (key, value) in enumerate(fields, start=3):
            assignments.append(f"{mapping[key]} = ${index}"); args.append(value)
        assignments.extend(["version = version + 1", "updated_at = now()"])
        row = await self._pool().fetchrow(f"update groups set {', '.join(assignments)} where id = $1 and version = $2 returning id", *args)
        if not row:
            return None
        await self._pool().execute("update groups set status = case when member_count >= capacity then 'full' else 'open' end where id = $1 and status not in ('closed','cancelled')", group_id)
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

    async def create_join_request(self, group_id: str, user_id: str, message: str | None) -> dict:
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

    async def approve_join_request(self, group_id: str, request_id: str, leader_id: str, version: int) -> dict:
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

    async def reject_join_request(self, group_id: str, request_id: str, leader_id: str, version: int, reason: str | None) -> dict | None:
        group = await self._pool().fetchrow("select leader_id, version from groups where id=$1", group_id)
        if not group:
            raise RepositoryError("GROUP_NOT_FOUND", "모임을 찾을 수 없습니다.", 404)
        if group["leader_id"] != leader_id:
            raise RepositoryError("LEADER_ONLY", "모임장만 수행할 수 있습니다.", 403)
        if group["version"] != version:
            raise RepositoryError("RESOURCE_VERSION_CONFLICT", "리소스 버전이 변경되었습니다.", 409)
        row = await self._pool().fetchrow("update group_join_requests set status='rejected', reason=$1, decided_by=$2, decided_at=now(), updated_at=now() where id=$3 and group_id=$4 and status='pending' returning *", reason, leader_id, request_id, group_id)
        return self._join_request_view(row) if row else None

    async def leave_group(self, group_id: str, user_id: str) -> None:
        async with self._pool().acquire() as connection:
            async with connection.transaction():
                member = await connection.fetchrow("select role from group_members where group_id=$1 and user_id=$2 and left_at is null", group_id, user_id)
                if not member:
                    raise RepositoryError("GROUP_MEMBER_ONLY", "참여 멤버만 탈퇴할 수 있습니다.", 403)
                if member["role"] == "leader":
                    raise RepositoryError("LEADER_CANNOT_LEAVE", "모임장은 먼저 모임을 종료하거나 양도해야 합니다.", 422)
                await connection.execute("update group_members set left_at=now() where group_id=$1 and user_id=$2 and left_at is null", group_id, user_id)
                await connection.execute("update groups set member_count=greatest(member_count-1,0), version=version+1, status=case when member_count-1 >= capacity then 'full' else 'open' end, updated_at=now() where id=$1", group_id)

    async def messages(self, group_id: str, *, before: str | None, after: str | None, limit: int) -> list[dict]:
        clauses = ["m.group_id=$1"]
        args: list[Any] = [group_id]
        if before:
            args.append(before); clauses.append(f"m.id < ${len(args)}")
        if after:
            args.append(after); clauses.append(f"m.id > ${len(args)}")
        args.append(limit)
        rows = await self._pool().fetch(
            f"select m.id,m.group_id,m.sender_id,m.type,m.text,m.system_event,m.client_message_id,m.created_at,u.display_name,u.avatar_url from group_messages m left join users u on u.id=m.sender_id where {' and '.join(clauses)} order by m.created_at desc limit ${len(args)}",
            *args,
        )
        return [self._message_view(row) for row in reversed(rows)]

    @staticmethod
    def _message_view(row: asyncpg.Record) -> dict:
        return {"id": row["id"], "groupId": row["group_id"], "sender": {"id": row["sender_id"] or "system", "displayName": row["display_name"] or "FestaMate", "avatarUrl": row["avatar_url"]}, "type": row["type"], "text": row["text"], "systemEvent": row["system_event"], "clientMessageId": row["client_message_id"], "createdAt": _iso(row["created_at"])}

    async def add_message(self, group_id: str, user_id: str, text: str, client_message_id: str | None = None) -> dict:
        if client_message_id:
            existing = await self._pool().fetchrow("select m.id,m.group_id,m.sender_id,m.type,m.text,m.system_event,m.client_message_id,m.created_at,u.display_name,u.avatar_url from group_messages m left join users u on u.id=m.sender_id where m.group_id=$1 and m.sender_id=$2 and m.client_message_id=$3", group_id, user_id, client_message_id)
            if existing:
                return self._message_view(existing)
        row = await self._pool().fetchrow("insert into group_messages (group_id,sender_id,type,text,client_message_id) values ($1,$2,'user',$3,$4) returning id", group_id, user_id, text, client_message_id)
        full = await self._pool().fetchrow("select m.id,m.group_id,m.sender_id,m.type,m.text,m.system_event,m.client_message_id,m.created_at,u.display_name,u.avatar_url from group_messages m left join users u on u.id=m.sender_id where m.id=$1", row["id"])
        return self._message_view(full)

    async def schedule(self, group_id: str) -> dict | None:
        group = await self.group(group_id)
        return group["schedule"] if group else None

    async def validate_schedule(self, group_id: str, user_id: str, trigger: str, version: int | None) -> dict:
        group = await self.group(group_id)
        if not group:
            raise RepositoryError("GROUP_NOT_FOUND", "모임을 찾을 수 없습니다.", 404)
        if group["leaderId"] != user_id:
            raise RepositoryError("LEADER_ONLY", "모임장만 수행할 수 있습니다.", 403)
        if version is not None and group["version"] != version:
            raise RepositoryError("RESOURCE_VERSION_CONFLICT", "리소스 버전이 변경되었습니다.", 409)
        current = group["schedule"]["current"]
        members = []
        required = current.get("time") if current else None
        for member in group["members"]:
            profile = await self.user(member["userId"])
            available = (profile or {}).get("profile", {}).get("availableFrom") or "00:00"
            satisfied = not current or available <= current.get("time", "23:59")
            if not satisfied and (required is None or available > required):
                required = available
            members.append({"userId": member["userId"], "availableFrom": available, "satisfied": satisfied})
        status = "valid" if not current or all(item["satisfied"] for item in members) else "conflict"
        conflict = None if status == "valid" else {"requiredStartTime": required, "currentStartTime": current.get("time"), "reason": "모든 참여자의 시작 가능 시간을 만족하지 않습니다.", "trigger": trigger}
        await self._pool().execute("update group_schedules set validation_status=$1, conflict=$2::jsonb, validated_at=now() where group_id=$3", status, json.dumps(conflict) if conflict else None, group_id)
        return {"status": status, "conflict": conflict, "members": members, "validatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")}

    async def create_proposal(self, group_id: str, user_id: str, strategy: str | None, version: int) -> dict:
        group = await self.group(group_id)
        if not group:
            raise RepositoryError("GROUP_NOT_FOUND", "모임을 찾을 수 없습니다.", 404)
        if group["leaderId"] != user_id:
            raise RepositoryError("LEADER_ONLY", "모임장만 수행할 수 있습니다.", 403)
        if group["version"] != version:
            raise RepositoryError("RESOURCE_VERSION_CONFLICT", "리소스 버전이 변경되었습니다.", 409)
        members = []
        for member in group["members"]:
            profile = await self.user(member["userId"])
            members.append((profile or {}).get("profile", {}).get("availableFrom") or "10:00")
        desired = max(members, default="10:00")
        current = group["schedule"]["current"]
        proposal_id = f"prp_{datetime.now(timezone.utc).strftime('%y%m%d%H%M%S%f')}"
        item = {"date": current["date"], "time": desired, "label": current["label"], "description": "모든 참여자 가능 시간 기반 제안"}
        await self._pool().execute("insert into schedule_proposals (id,group_id,base_version,items,strategy,status,created_by) values ($1,$2,$3,$4::jsonb,$5,'draft',$6)", proposal_id, group_id, group["schedule"]["version"], json.dumps([item]), strategy or "all_members_available", user_id)
        return {"id": proposal_id, "groupId": group_id, "status": "draft", "strategy": strategy or "all_members_available", "schedule": item, "createdAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"), "version": group["schedule"]["version"]}

    async def decide_proposal(self, group_id: str, proposal_id: str, user_id: str, version: int, approve: bool, reason: str | None) -> dict:
        async with self._pool().acquire() as connection:
            async with connection.transaction():
                group = await connection.fetchrow("select * from groups where id=$1 for update", group_id)
                if not group:
                    raise RepositoryError("GROUP_NOT_FOUND", "모임을 찾을 수 없습니다.", 404)
                if group["leader_id"] != user_id:
                    raise RepositoryError("LEADER_ONLY", "모임장만 수행할 수 있습니다.", 403)
                if group["version"] != version:
                    raise RepositoryError("RESOURCE_VERSION_CONFLICT", "리소스 버전이 변경되었습니다.", 409)
                proposal = await connection.fetchrow("select * from schedule_proposals where id=$1 and group_id=$2 for update", proposal_id, group_id)
                if not proposal:
                    raise RepositoryError("PROPOSAL_NOT_FOUND", "일정 제안을 찾을 수 없습니다.", 404)
                if proposal["status"] != "draft":
                    raise RepositoryError("PROPOSAL_EXPIRED", "초안 상태의 일정 제안만 승인할 수 있습니다.")
                status = "approved" if approve else "rejected"
                await connection.execute("update schedule_proposals set status=$1, reason=$2, decided_by=$3, decided_at=now() where id=$4", status, reason, user_id, proposal_id)
                item = (proposal["items"] or [None])[0]
                if approve:
                    await connection.execute("update group_schedules set items=$1::jsonb, version=version+1, validation_status='valid', conflict=null, updated_by=$2, updated_at=now() where group_id=$3", json.dumps([item]), user_id, group_id)
                    await connection.execute("update groups set version=version+1, updated_at=now() where id=$1", group_id)
        return await self.schedule(group_id)  # type: ignore[return-value]

    async def alert(self, alert_id: str, user_id: str) -> dict | None:
        row = await self._pool().fetchrow("select * from alerts where id=$1 and user_id=$2", alert_id, user_id)
        return self._alert_view(row) if row else None

    async def alerts(self, user_id: str, status: str | None, alert_type: str | None) -> list[dict]:
        clauses = ["user_id=$1"]; args: list[Any] = [user_id]
        if status: args.append(status); clauses.append(f"status=${len(args)}")
        if alert_type: args.append(alert_type); clauses.append(f"type=${len(args)}")
        rows = await self._pool().fetch(f"select * from alerts where {' and '.join(clauses)} order by created_at desc", *args)
        return [self._alert_view(row) for row in rows]

    @staticmethod
    def _alert_view(row: asyncpg.Record) -> dict:
        return {"id": row["id"], "type": row["type"], "festivalId": row["festival_id"], "groupId": row["group_id"], "severity": row["severity"], "title": row["title"], "message": row["message"], "status": row["status"], "choice": row["choice"], "createdAt": _iso(row["created_at"]), "answeredAt": _iso(row["answered_at"])}

    async def update_alert(self, alert_id: str, user_id: str, *, status: str | None = None, choice: str | None = None) -> dict | None:
        alert = await self.alert(alert_id, user_id)
        if not alert:
            return None
        if choice:
            await self._pool().execute("update alerts set status='answered', choice=$1, answered_at=now() where id=$2 and user_id=$3", choice, alert_id, user_id)
        elif status:
            await self._pool().execute("update alerts set status=$1, read_at=case when $1='read' then now() else read_at end where id=$2 and user_id=$3", status, alert_id, user_id)
        return await self.alert(alert_id, user_id)

    async def matching_run(self, run_id: str, user_id: str) -> dict | None:
        row = await self._pool().fetchrow("select * from matching_runs where id=$1 and user_id=$2", run_id, user_id)
        if not row:
            return None
        candidates = await self._pool().fetch("select mc.*, u.display_name, u.avatar_url from matching_candidates mc join users u on u.id=mc.candidate_user_id where mc.run_id=$1 order by mc.rank", run_id)
        items = [{"user": {"id": c["candidate_user_id"], "displayName": c["display_name"], "avatarUrl": c["avatar_url"]}, "score": c["score"], "parts": c["parts"], "reasons": c["reasons"] or []} for c in candidates]
        return {"runId": row["id"], "festivalId": row["festival_id"], "userId": row["user_id"], "conditions": row["conditions"], "candidates": items, "group": {"id": row["group_id"], "created": True} if row["group_id"] else None, "status": row["status"]}

    async def create_matching_run(self, user_id: str, festival_id: str, conditions: dict, candidates: list[dict], top_k: int, create_group: bool, group_id: str | None) -> dict:
        run_id = f"mat_{datetime.now(timezone.utc).strftime('%y%m%d%H%M%S%f')}"
        async with self._pool().acquire() as connection:
            async with connection.transaction():
                await connection.execute("insert into matching_runs (id,user_id,festival_id,conditions,top_k,create_group,group_id,status,candidate_count,completed_at) values ($1,$2,$3,$4::jsonb,$5,$6,$7,'done',$8,now())", run_id, user_id, festival_id, json.dumps(conditions), top_k, create_group, group_id, len(candidates))
                for rank, candidate in enumerate(candidates, start=1):
                    await connection.execute("insert into matching_candidates (run_id,candidate_user_id,rank,score,parts,reasons) values ($1,$2,$3,$4,$5::jsonb,$6)", run_id, candidate["user"]["id"], rank, candidate["score"], json.dumps(candidate["parts"]), candidate["reasons"])
        return await self.matching_run(run_id, user_id)  # type: ignore[return-value]


def get_repository(request: Any) -> SupabaseRepository:
    return SupabaseRepository(request.app.state.database)
