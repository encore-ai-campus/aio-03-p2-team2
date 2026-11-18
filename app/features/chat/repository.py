from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import asyncpg

from app.core.repository import RepositoryBase, _iso


class ChatRepositoryMixin(RepositoryBase):
    async def active_chat_member_ids(self, group_id: str) -> set[str]:
        rows = await self._pool().fetch(
            "select user_id from group_members where group_id=$1 and left_at is null",
            group_id,
        )
        return {row["user_id"] for row in rows}

    async def messages(self, group_id: str, *, before: str | None, after: str | None, limit: int) -> list[dict]:
        clauses = ["m.group_id=$1"]
        args: list[Any] = [group_id]
        for cursor, operator in ((before, "<"), (after, ">")):
            if cursor:
                args.append(cursor)
                clauses.append(
                    f"(m.created_at, m.id) {operator} ("
                    f"select c.created_at, c.id from group_messages c where c.group_id=$1 and c.id=${len(args)})"
                )
        args.append(limit)
        direction = "asc" if after is not None else "desc"
        rows = await self._pool().fetch(
            "select m.id,m.group_id,m.sender_id,m.type,m.text,m.system_event,m.client_message_id,"
            "m.created_at,u.display_name,u.avatar_url from group_messages m left join users u on u.id=m.sender_id "
            f"where {' and '.join(clauses)} order by m.created_at {direction}, m.id {direction} limit ${len(args)}",
            *args,
        )
        return [self._message_view(row) for row in (rows if after is not None else reversed(rows))]

    @staticmethod
    def _message_view(row: asyncpg.Record) -> dict:
        created_at = row["created_at"]
        timestamp = created_at.astimezone(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z") if isinstance(created_at, datetime) else _iso(created_at)
        return {"id": row["id"], "groupId": row["group_id"], "sender": {"id": row["sender_id"] or "system", "displayName": row["display_name"] or "FestaMate", "avatarUrl": row["avatar_url"]}, "type": row["type"], "text": row["text"], "systemEvent": row["system_event"], "clientMessageId": row["client_message_id"], "createdAt": timestamp}

    async def add_message(self, group_id: str, user_id: str, text: str, client_message_id: str | None = None) -> dict:
        async with self._pool().acquire() as connection:
            async with connection.transaction():
                if client_message_id:
                    # The current Supabase schema does not expose a unique
                    # constraint for this legacy column. Serialize retries
                    # by message key so concurrent requests remain idempotent.
                    lock_key = f"{group_id}:{user_id}:{client_message_id}"
                    await connection.fetchval("select pg_advisory_xact_lock(hashtextextended($1, 0))", lock_key)
                    row = await connection.fetchrow(
                        "select id from group_messages where group_id=$1 and sender_id=$2 and client_message_id=$3",
                        group_id,
                        user_id,
                        client_message_id,
                    )
                else:
                    row = None
                if not row:
                    row = await connection.fetchrow(
                        "insert into group_messages (group_id,sender_id,type,text,client_message_id) values ($1,$2,'user',$3,$4) returning id",
                        group_id,
                        user_id,
                        text,
                        client_message_id,
                    )
                full = await connection.fetchrow(
                    "select m.id,m.group_id,m.sender_id,m.type,m.text,m.system_event,m.client_message_id,m.created_at,u.display_name,u.avatar_url "
                    "from group_messages m left join users u on u.id=m.sender_id where m.id=$1",
                    row["id"],
                )
        return self._message_view(full)
