from __future__ import annotations

import json
from datetime import datetime, timezone

from app.core.repository import RepositoryBase, RepositoryError


class ScheduleRepositoryMixin(RepositoryBase):
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
