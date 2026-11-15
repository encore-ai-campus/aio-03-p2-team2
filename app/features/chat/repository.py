from __future__ import annotations

from typing import Any

import asyncpg

from app.core.repository import RepositoryBase, _iso


class ChatRepositoryMixin(RepositoryBase):
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
