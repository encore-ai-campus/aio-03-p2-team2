from __future__ import annotations

import json
from datetime import datetime, timezone

from app.core.repository import RepositoryBase


class MatchingRepositoryMixin(RepositoryBase):
    async def matching_run_exists(self, run_id: str, user_id: str) -> bool:
        return bool(await self._pool().fetchval("select 1 from matching_runs where id=$1 and user_id=$2", run_id, user_id))

    async def matching_run(self, run_id: str, user_id: str) -> dict | None:
        row = await self._pool().fetchrow("select * from matching_runs where id=$1 and user_id=$2", run_id, user_id)
        if not row:
            return None
        candidates = await self._pool().fetch("select mc.*, u.display_name, u.avatar_url from matching_candidates mc join users u on u.id=mc.candidate_user_id where mc.run_id=$1 order by mc.rank", run_id)
        items = [{"user": {"id": c["candidate_user_id"], "displayName": c["display_name"], "avatarUrl": c["avatar_url"]}, "score": c["score"], "parts": c["parts"], "reasons": c["reasons"] or []} for c in candidates]
        return {"runId": row["id"], "festivalId": row["festival_id"], "userId": row["user_id"], "conditions": row["conditions"], "candidates": items, "group": {"id": row["group_id"], "created": True} if row["group_id"] else None, "status": row["status"]}

    async def matching_candidates(self, run_id: str, user_id: str, *, offset: int = 0, limit: int = 20) -> tuple[list[dict], int]:
        """Return only the requested candidate page from PostgreSQL."""
        run_exists = await self._pool().fetchval(
            "select 1 from matching_runs where id=$1 and user_id=$2",
            run_id,
            user_id,
        )
        if not run_exists:
            return [], 0
        total = await self._pool().fetchval(
            "select count(*) from matching_candidates where run_id=$1",
            run_id,
        )
        rows = await self._pool().fetch(
            """
            select mc.candidate_user_id, mc.score, mc.parts, mc.reasons,
                   u.display_name, u.avatar_url
            from matching_candidates mc
            join users u on u.id=mc.candidate_user_id
            where mc.run_id=$1
            order by mc.rank
            offset $2 limit $3
            """,
            run_id,
            offset,
            limit,
        )
        items = [
            {
                "user": {"id": row["candidate_user_id"], "displayName": row["display_name"], "avatarUrl": row["avatar_url"]},
                "score": row["score"],
                "parts": row["parts"],
                "reasons": row["reasons"] or [],
            }
            for row in rows
        ]
        return items, int(total or 0)

    async def create_matching_run(self, user_id: str, festival_id: str, conditions: dict, candidates: list[dict], top_k: int, create_group: bool, group_id: str | None) -> dict:
        run_id = f"mat_{datetime.now(timezone.utc).strftime('%y%m%d%H%M%S%f')}"
        async with self._pool().acquire() as connection:
            async with connection.transaction():
                await connection.execute("insert into matching_runs (id,user_id,festival_id,conditions,top_k,create_group,group_id,status,candidate_count,completed_at) values ($1,$2,$3,$4::jsonb,$5,$6,$7,'done',$8,now())", run_id, user_id, festival_id, json.dumps(conditions), top_k, create_group, group_id, len(candidates))
                for rank, candidate in enumerate(candidates, start=1):
                    await connection.execute("insert into matching_candidates (run_id,candidate_user_id,rank,score,parts,reasons) values ($1,$2,$3,$4,$5::jsonb,$6)", run_id, candidate["user"]["id"], rank, candidate["score"], json.dumps(candidate["parts"]), candidate["reasons"])
        return await self.matching_run(run_id, user_id)  # type: ignore[return-value]
