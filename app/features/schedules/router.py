from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from app.core.api import APIError, success
from app.core.auth import current_user_id, require_current_user
from app.core.repositories import RepositoryError, SupabaseRepository, get_repository
from app.core.service import ServiceError
from .schemas import ProposalAction, ProposalCreate, ScheduleValidateRequest
from .service import ScheduleService

router = APIRouter(tags=["schedules"], dependencies=[Depends(require_current_user)])


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
async def get_schedule(group_id: str, request: Request):
    repository = get_repository(request)
    user_id = current_user_id(request)
    try:
        schedule = await ScheduleService(repository).get_for_member(group_id, user_id)
    except ServiceError as error:
        raise APIError(error.status_code, error.code, error.message, error.details) from error
    return success(schedule, request)


@router.post("/groups/{group_id}/schedule/validate", operation_id="validateGroupSchedule")
async def validate_schedule(group_id: str, payload: ScheduleValidateRequest, request: Request):
    repository = get_repository(request)
    user_id = current_user_id(request)
    try:
        result = await ScheduleService(repository).validate(group_id, user_id, payload.trigger, payload.version)
    except RepositoryError as error:
        raise repository_error(error) from error
    return success(result, request)


@router.post("/groups/{group_id}/schedule/proposals", operation_id="createScheduleProposal", status_code=201)
async def create_proposal(group_id: str, payload: ProposalCreate, request: Request):
    repository = get_repository(request)
    user_id = current_user_id(request)
    try:
        proposal = await ScheduleService(repository).create_proposal(group_id, user_id, payload.strategy, payload.version)
    except ServiceError as error:
        raise APIError(error.status_code, error.code, error.message, error.details) from error
    except RepositoryError as error:
        raise repository_error(error) from error
    return success(proposal, request, status_code=201)


@router.post("/groups/{group_id}/schedule/proposals/{proposal_id}/approve", operation_id="approveScheduleProposal")
async def approve_proposal(group_id: str, proposal_id: str, payload: ProposalAction, request: Request):
    repository = get_repository(request)
    user_id = current_user_id(request)
    try:
        result = await ScheduleService(repository).decide(group_id, proposal_id, user_id, payload.version, True, payload.reason)
    except RepositoryError as error:
        raise repository_error(error) from error
    return success(result, request)


@router.post("/groups/{group_id}/schedule/proposals/{proposal_id}/reject", operation_id="rejectScheduleProposal")
async def reject_proposal(group_id: str, proposal_id: str, payload: ProposalAction, request: Request):
    repository = get_repository(request)
    user_id = current_user_id(request)
    try:
        result = await ScheduleService(repository).decide(group_id, proposal_id, user_id, payload.version, False, payload.reason)
    except RepositoryError as error:
        raise repository_error(error) from error
    return success(result, request)
