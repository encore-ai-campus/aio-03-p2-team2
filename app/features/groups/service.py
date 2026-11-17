from __future__ import annotations

from datetime import date
from typing import Any

from app.core.service import ServiceError


class GroupService:
    def __init__(self, repository: Any) -> None:
        self.repository = repository

    async def get(self, group_id: str) -> dict:
        group = await self.repository.group(group_id)
        if not group:
            raise ServiceError(404, "GROUP_NOT_FOUND", "모임을 찾을 수 없습니다.")
        return group

    @staticmethod
    def require_leader(group: dict, user_id: str) -> None:
        if group["leaderId"] != user_id:
            raise ServiceError(403, "LEADER_ONLY", "모임장만 수행할 수 있습니다.")

    @staticmethod
    def require_member(group: dict, user_id: str) -> None:
        if not any(item["userId"] == user_id for item in group["members"]):
            raise ServiceError(403, "GROUP_MEMBER_ONLY", "모임 참여자만 수행할 수 있습니다.")

    async def validate_create(self, festival_id: str) -> None:
        festival = await self.repository.festival(festival_id)
        if not festival or festival["riskStatus"] == "cancelled" or festival["endDate"] < date.today().isoformat():
            raise ServiceError(422, "FESTIVAL_NOT_AVAILABLE", "종료되었거나 이용할 수 없는 축제입니다.")

    @staticmethod
    def validate_capacity(group: dict, values: dict) -> None:
        if values.get("capacity", group["capacity"]) < group["memberCount"]:
            raise ServiceError(409, "GROUP_CAPACITY_EXCEEDED", "현재 멤버 수보다 작은 정원은 설정할 수 없습니다.")

    async def create(self, user_id: str, payload: dict) -> dict:
        await self.validate_create(payload["festivalId"])
        conditions = dict(payload.get("conditions") or {})
        if payload.get("date"):
            conditions["date"] = str(payload["date"])
        if payload.get("startTime"):
            conditions["start_time"] = payload["startTime"]
        if conditions.get("date"):
            festival = await self.repository.festival(payload["festivalId"])
            if not festival["startDate"] <= conditions["date"] <= festival["endDate"]:
                raise ServiceError(422, "MATCHING_DATE_INVALID", "참여 날짜는 축제 운영 기간 안에서 선택해 주세요.")
        payload = {**payload, "conditions": conditions}
        return await self.repository.create_group(user_id, payload)

    async def update(self, group_id: str, user_id: str, values: dict, version: int) -> dict:
        group = await self.get(group_id)
        self.require_leader(group, user_id)
        self.validate_capacity(group, values)
        updated = await self.repository.update_group(group_id, values, version, user_id)
        if not updated:
            raise ServiceError(409, "RESOURCE_VERSION_CONFLICT", "리소스 버전이 변경되었습니다.", {"latest": await self.repository.group(group_id)})
        return updated

    async def create_join_request(self, group_id: str, user_id: str, message: str | None, version: int | None = None) -> dict:
        """Application boundary for the join policy and its atomic repository action."""
        return await self.repository.create_join_request(group_id, user_id, message, version)

    async def approve_join_request(self, group_id: str, request_id: str, leader_id: str, version: int) -> dict:
        return await self.repository.approve_join_request(group_id, request_id, leader_id, version)

    async def reject_join_request(self, group_id: str, request_id: str, leader_id: str, version: int, reason: str | None) -> dict | None:
        return await self.repository.reject_join_request(group_id, request_id, leader_id, version, reason)

    async def leave(self, group_id: str, user_id: str) -> None:
        await self.repository.leave_group(group_id, user_id)
