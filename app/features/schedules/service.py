from __future__ import annotations

from typing import Any

from app.core.service import ServiceError


class ScheduleService:
    def __init__(self, repository: Any) -> None:
        self.repository = repository

    async def get_for_member(self, group_id: str, user_id: str) -> dict:
        group = await self._group(group_id)
        self._require_member(group, user_id)
        return group["schedule"]

    async def create_proposal(self, group_id: str, user_id: str, strategy: str | None, version: int) -> dict:
        proposal = await self.repository.create_proposal(group_id, user_id, strategy, version)
        group = await self._group(group_id)
        festival = await self.repository.festival(group["festivalId"])
        operating = next((item for item in (festival or {}).get("operatingHours", []) if item["date"] == proposal["schedule"]["date"]), None)
        if operating and not (operating["open"] <= proposal["schedule"]["time"] <= operating["close"]):
            raise ServiceError(
                422,
                "OUTSIDE_FESTIVAL_OPERATING_HOURS",
                "참여자 가능 시간이 축제 운영시간 밖입니다.",
                {"requestedTime": proposal["schedule"]["time"], "open": operating["open"], "close": operating["close"]},
            )
        return proposal

    async def validate(self, group_id: str, user_id: str, trigger: str, version: int | None) -> dict:
        return await self.repository.validate_schedule(group_id, user_id, trigger, version)

    async def decide(self, group_id: str, proposal_id: str, user_id: str, version: int, approve: bool, reason: str | None) -> dict:
        return await self.repository.decide_proposal(group_id, proposal_id, user_id, version, approve, reason)

    async def _group(self, group_id: str) -> dict:
        group = await self.repository.group(group_id)
        if not group:
            raise ServiceError(404, "GROUP_NOT_FOUND", "모임을 찾을 수 없습니다.")
        return group

    @staticmethod
    def _require_member(group: dict, user_id: str) -> None:
        if not any(item["userId"] == user_id for item in group["members"]):
            raise ServiceError(403, "GROUP_MEMBER_ONLY", "모임 참여자만 일정에 접근할 수 있습니다.")
