from __future__ import annotations

from fastapi import APIRouter, Header, Request

from app.core.api import APIError, success
from app.core.schemas import ProposalAction, ProposalCreate, ScheduleValidateRequest
from app.core.store import new_id, now_iso, store

router = APIRouter(tags=["schedules"])


def require_demo(value: str | None) -> str:
    if not value or not store.user(value):
        raise APIError(400, "DEMO_USER_INVALID", "유효한 X-Demo-User-Id가 필요합니다.")
    return value


def get_group(group_id: str) -> dict:
    group = store.group_ref(group_id)
    if not group:
        raise APIError(404, "GROUP_NOT_FOUND", "모임을 찾을 수 없습니다.")
    return group


def require_member(group: dict, user_id: str) -> None:
    if not store.member(group, user_id):
        raise APIError(403, "GROUP_MEMBER_ONLY", "모임 참여자만 조회할 수 있습니다.")


def require_leader(group: dict, user_id: str) -> None:
    if group["leaderId"] != user_id:
        raise APIError(403, "LEADER_ONLY", "모임장만 수행할 수 있습니다.")


def check_version(group: dict, version: int | None) -> None:
    if version is not None and group["version"] != version:
        raise APIError(409, "RESOURCE_VERSION_CONFLICT", "리소스 버전이 변경되었습니다.", {"latest": store.serialize_group(group)})


def member_validation(group: dict) -> tuple[str, list[dict], dict | None]:
    current = group["schedule"]["current"]
    current_time = current["time"] if current else None
    members = []
    required = current_time
    for membership in group["members"]:
        user = store.users[membership["userId"]]
        available_from = user["profile"].get("availableFrom") or "00:00"
        satisfied = current_time is None or available_from <= current_time
        if not satisfied and (required is None or available_from > required):
            required = available_from
        members.append({"userId": membership["userId"], "availableFrom": available_from, "satisfied": satisfied})
    if current_time is None or all(item["satisfied"] for item in members):
        return "valid", members, None
    return "conflict", members, {"requiredStartTime": required, "currentStartTime": current_time, "reason": "모든 참여자의 시작 가능 시각을 만족하지 않습니다.", "trigger": "manual"}


@router.get("/groups/{group_id}/schedule", operation_id="getGroupSchedule")
def get_schedule(group_id: str, request: Request, x_demo_user_id: str | None = Header(default=None)):
    user_id = require_demo(x_demo_user_id)
    group = get_group(group_id)
    require_member(group, user_id)
    return success(group["schedule"], request)


@router.post("/groups/{group_id}/schedule/validate", operation_id="validateGroupSchedule")
def validate_schedule(group_id: str, payload: ScheduleValidateRequest, request: Request, x_demo_user_id: str | None = Header(default=None)):
    user_id = require_demo(x_demo_user_id)
    group = get_group(group_id)
    require_leader(group, user_id)
    check_version(group, payload.version)
    status, members, conflict = member_validation(group)
    if conflict:
        conflict["trigger"] = payload.trigger
    group["schedule"]["validation"] = {"status": status, "conflict": conflict, "members": members, "validatedAt": now_iso()}
    return success(group["schedule"]["validation"], request)


@router.post("/groups/{group_id}/schedule/proposals", operation_id="createScheduleProposal", status_code=201)
def create_proposal(group_id: str, payload: ProposalCreate, request: Request, x_demo_user_id: str | None = Header(default=None)):
    user_id = require_demo(x_demo_user_id)
    group = get_group(group_id)
    require_leader(group, user_id)
    check_version(group, payload.version)
    festival = store.festivals[group["festivalId"]]
    status, members, _ = member_validation(group)
    desired = max((item["availableFrom"] for item in members), default="10:00")
    operating = next((item for item in festival.get("operatingHours", []) if item["date"] == group["schedule"]["current"]["date"]), None)
    if operating and not (operating["open"] <= desired <= operating["close"]):
        raise APIError(422, "OUTSIDE_FESTIVAL_OPERATING_HOURS", "참여자 가능 시간이 축제 운영시간 밖입니다.", {"requestedTime": desired, "open": operating["open"], "close": operating["close"]})
    proposal = {"id": new_id("prp"), "groupId": group_id, "status": "draft", "strategy": payload.strategy or "all_members_available", "schedule": {"date": group["schedule"]["current"]["date"], "time": desired, "label": festival["name"], "description": "모든 참여자 가능 시간 기반 제안"}, "createdAt": now_iso(), "version": group["schedule"]["version"]}
    group["schedule"]["proposals"].append(proposal)
    return success(proposal, request, status_code=201)


@router.post("/groups/{group_id}/schedule/proposals/{proposal_id}/approve", operation_id="approveScheduleProposal")
def approve_proposal(group_id: str, proposal_id: str, payload: ProposalAction, request: Request, x_demo_user_id: str | None = Header(default=None)):
    user_id = require_demo(x_demo_user_id)
    group = get_group(group_id)
    require_leader(group, user_id)
    check_version(group, payload.version)
    proposal = next((item for item in group["schedule"]["proposals"] if item["id"] == proposal_id), None)
    if not proposal:
        raise APIError(404, "PROPOSAL_NOT_FOUND", "일정 제안을 찾을 수 없습니다.")
    if proposal["status"] != "draft":
        raise APIError(409, "PROPOSAL_EXPIRED", "초안 상태의 일정 제안만 승인할 수 있습니다.")
    with store.lock:
        proposal["status"] = "approved"
        group["schedule"]["current"] = proposal["schedule"]
        group["schedule"]["version"] += 1
        group["version"] += 1
        group["updatedAt"] = now_iso()
        message = store.add_message(group, None, f"일정이 {proposal['schedule']['date']} {proposal['schedule']['time']}로 확정되었습니다.", "system")
        for member in group["members"]:
            store.create_alert(member["userId"], {"type": "schedule_changed", "festivalId": group["festivalId"], "groupId": group_id, "severity": "info", "title": "모임 일정이 확정되었습니다", "message": f"{proposal['schedule']['date']} {proposal['schedule']['time']} 일정으로 확정되었습니다."})
    return success(group["schedule"], request)


@router.post("/groups/{group_id}/schedule/proposals/{proposal_id}/reject", operation_id="rejectScheduleProposal")
def reject_proposal(group_id: str, proposal_id: str, payload: ProposalAction, request: Request, x_demo_user_id: str | None = Header(default=None)):
    user_id = require_demo(x_demo_user_id)
    group = get_group(group_id)
    require_leader(group, user_id)
    check_version(group, payload.version)
    proposal = next((item for item in group["schedule"]["proposals"] if item["id"] == proposal_id), None)
    if not proposal:
        raise APIError(404, "PROPOSAL_NOT_FOUND", "일정 제안을 찾을 수 없습니다.")
    proposal["status"] = "rejected"
    proposal["reason"] = payload.reason
    return success(proposal, request)
