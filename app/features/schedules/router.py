from __future__ import annotations

from fastapi import APIRouter, Header, Request

from app.core.api import APIError, success
from app.core.repositories import RepositoryError, SupabaseRepository, get_repository
from .schemas import ProposalAction, ProposalCreate, ScheduleValidateRequest

router = APIRouter(tags=["schedules"])


async def require_demo(value: str | None, repository: SupabaseRepository) -> str:
    if not value or not await repository.user(value):
        raise APIError(400, "DEMO_USER_INVALID", "유효한 X-Demo-User-Id가 필요합니다.")
    return value


async def get_group(group_id: str, repository: SupabaseRepository) -> dict:
    group = await repository.group(group_id)
    if not group:
        raise APIError(404, "GROUP_NOT_FOUND", "모임을 찾을 수 없습니다.")
    return group


def require_member(group: dict, user_id: str) -> None:
    if not any(item["userId"] == user_id for item in group["members"]):
        raise APIError(403, "GROUP_MEMBER_ONLY", "모임 참여자만 일정에 접근할 수 있습니다.")


def require_leader(group: dict, user_id: str) -> None:
    if group["leaderId"] != user_id:
        raise APIError(403, "LEADER_ONLY", "모임장만 수행할 수 있습니다.")


def repository_error(error: RepositoryError) -> APIError:
    return APIError(error.status_code, error.code, error.message, error.details)


@router.get("/groups/{group_id}/schedule", operation_id="getGroupSchedule")
async def get_schedule(group_id: str, request: Request, x_demo_user_id: str | None = Header(default=None)):
    repository = get_repository(request)
    user_id = await require_demo(x_demo_user_id, repository)
    group = await get_group(group_id, repository)
    require_member(group, user_id)
    return success(group["schedule"], request)


@router.post("/groups/{group_id}/schedule/validate", operation_id="validateGroupSchedule")
async def validate_schedule(group_id: str, payload: ScheduleValidateRequest, request: Request, x_demo_user_id: str | None = Header(default=None)):
    repository = get_repository(request)
    user_id = await require_demo(x_demo_user_id, repository)
    try:
        result = await repository.validate_schedule(group_id, user_id, payload.trigger, payload.version)
    except RepositoryError as error:
        raise repository_error(error) from error
    return success(result, request)


@router.post("/groups/{group_id}/schedule/proposals", operation_id="createScheduleProposal", status_code=201)
async def create_proposal(group_id: str, payload: ProposalCreate, request: Request, x_demo_user_id: str | None = Header(default=None)):
    repository = get_repository(request)
    user_id = await require_demo(x_demo_user_id, repository)
    try:
        proposal = await repository.create_proposal(group_id, user_id, payload.strategy, payload.version)
    except RepositoryError as error:
        raise repository_error(error) from error
    festival_id = (await get_group(group_id, repository))["festivalId"]
    festival = await repository.festival(festival_id)
    operating = next((item for item in (festival or {}).get("operatingHours", []) if item["date"] == proposal["schedule"]["date"]), None)
    if operating and not (operating["open"] <= proposal["schedule"]["time"] <= operating["close"]):
        raise APIError(422, "OUTSIDE_FESTIVAL_OPERATING_HOURS", "참여자 가능 시간이 축제 운영시간 밖입니다.", {"requestedTime": proposal["schedule"]["time"], "open": operating["open"], "close": operating["close"]})
    return success(proposal, request, status_code=201)


@router.post("/groups/{group_id}/schedule/proposals/{proposal_id}/approve", operation_id="approveScheduleProposal")
async def approve_proposal(group_id: str, proposal_id: str, payload: ProposalAction, request: Request, x_demo_user_id: str | None = Header(default=None)):
    repository = get_repository(request)
    user_id = await require_demo(x_demo_user_id, repository)
    try:
        result = await repository.decide_proposal(group_id, proposal_id, user_id, payload.version, True, payload.reason)
    except RepositoryError as error:
        raise repository_error(error) from error
    return success(result, request)


@router.post("/groups/{group_id}/schedule/proposals/{proposal_id}/reject", operation_id="rejectScheduleProposal")
async def reject_proposal(group_id: str, proposal_id: str, payload: ProposalAction, request: Request, x_demo_user_id: str | None = Header(default=None)):
    repository = get_repository(request)
    user_id = await require_demo(x_demo_user_id, repository)
    try:
        result = await repository.decide_proposal(group_id, proposal_id, user_id, payload.version, False, payload.reason)
    except RepositoryError as error:
        raise repository_error(error) from error
    return success(result, request)
