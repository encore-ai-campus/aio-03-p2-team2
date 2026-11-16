from __future__ import annotations

from typing import Any
import json

import asyncpg

from app.core.repository import RepositoryBase, _iso


class AlertRepositoryMixin(RepositoryBase):
    async def alert(self, alert_id: str, user_id: str) -> dict | None:
        row = await self._pool().fetchrow("select * from alerts where id=$1 and user_id=$2", alert_id, user_id)
        return self._alert_view(row) if row else None

    async def alerts(self, user_id: str, status: str | None, alert_type: str | None) -> list[dict]:
        clauses = ["user_id=$1"]
        args: list[Any] = [user_id]
        if status:
            args.append(status); clauses.append(f"status=${len(args)}")
        if alert_type:
            args.append(alert_type); clauses.append(f"type=${len(args)}")
        rows = await self._pool().fetch(f"select * from alerts where {' and '.join(clauses)} order by created_at desc", *args)
        return [self._alert_view(row) for row in rows]

    @staticmethod
    def _alert_view(row: asyncpg.Record) -> dict:
        return {"isTest": row.get("is_test", False), "evidence": json.loads(row["evidence"]) if isinstance(row.get("evidence"),str) else row.get("evidence"), "id": row["id"], "type": row["type"], "festivalId": row["festival_id"], "groupId": row["group_id"], "severity": row["severity"], "title": row["title"], "message": row["message"], "status": row["status"], "choice": row["choice"], "createdAt": _iso(row["created_at"]), "answeredAt": _iso(row["answered_at"])}

    async def update_alert(self, alert_id: str, user_id: str, *, status: str | None = None, choice: str | None = None) -> dict | None:
        alert = await self.alert(alert_id, user_id)
        if not alert:
            return None
        if choice:
            await self._pool().execute("update alerts set status='answered', choice=$1, answered_at=now() where id=$2 and user_id=$3", choice, alert_id, user_id)
        elif status:
            await self._pool().execute("update alerts set status=$1, read_at=case when $1='read' then now() else read_at end where id=$2 and user_id=$3", status, alert_id, user_id)
        return await self.alert(alert_id, user_id)
