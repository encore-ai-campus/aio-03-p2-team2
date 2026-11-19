"""Compatibility URLs delegate to the shared graph; there is no approval bypass."""

from contextlib import nullcontext

from fastapi import APIRouter, Depends, Request

from app.core.api import success
from app.core.auth import current_user_id, require_current_user
from app.core.repository import RepositoryError
from app.core.repositories import get_repository
from app.features.agents.schemas import ResumeRun, RunStart
from app.features.agents.workflow import WorkflowService
from .schemas import ProposalAction, ProposalCreate, ScheduleValidateRequest

router = APIRouter(tags=["schedules"], dependencies=[Depends(require_current_user)])


@router.get("/groups/{group_id}/schedule", operation_id="getGroupSchedule")
async def get_schedule(group_id: str, request: Request):
    service = request.app.state.agents
    user_id = current_user_id(request)
    await service.user(user_id)
    group = await get_repository(request).group(group_id)
    if not group:
        raise RepositoryError("GROUP_NOT_FOUND", "모임을 찾을 수 없습니다.", 404)
    if not any(member["userId"] == user_id for member in group["members"]):
        raise RepositoryError("GROUP_MEMBER_ONLY", "참여자만 접근할 수 있습니다.", 403)
    return success(group["schedule"], request)


async def _proposal_execution(service, user_id, proposal_id):
    try:
        return await service.memory.run_for_proposal(proposal_id, user_id)
    except RepositoryError as error:
        if error.code not in {"AGENT_PROPOSAL_REQUIRED", "AGENT_RUN_FORBIDDEN"}:
            raise
        return None


async def _proposal_run(service, user_id, group_id, proposal_id, execution):
    if execution is None:
        return None
    try:
        current = await service.get(user_id, execution["id"], update_index=False)
    except RepositoryError as error:
        if error.code not in {"AGENT_RUN_NOT_FOUND", "AGENT_RUN_INCOMPLETE"}:
            raise
        return None
    if current["groupId"] == group_id and current["proposalId"] == proposal_id:
        return current
    return None


@router.get("/groups/{group_id}/schedule/draft", operation_id="getScheduleDraft")
async def get_draft(group_id: str, request: Request):
    service = request.app.state.agents
    user_id = current_user_id(request)
    await service.user(user_id)
    group = await WorkflowService(service).leader_group(user_id, group_id)
    for proposal in reversed(group["schedule"]["proposals"]):
        if proposal["status"] == "draft":
            execution = await _proposal_execution(service, user_id, proposal["id"])
            if execution is None:
                continue
            async with service.storage.run_lock(execution["id"]):
                current = await _proposal_run(service, user_id, group_id, proposal["id"], execution)
            if current and current["status"] == "waiting_approval":
                return success(current, request)
    return success(None, request)


@router.post("/groups/{group_id}/schedule/validate", operation_id="validateGroupSchedule")
async def validate_schedule(group_id: str, payload: ScheduleValidateRequest, request: Request):
    result = await request.app.state.agents.validate_group(
        current_user_id(request), group_id, payload.version
    )
    return success(result, request)


@router.post(
    "/groups/{group_id}/schedule/proposals",
    status_code=201,
    operation_id="createScheduleProposal",
)
async def create_proposal(group_id: str, payload: ProposalCreate, request: Request):
    service = request.app.state.agents
    user_id = current_user_id(request)
    await service.user(user_id)
    group = await get_repository(request).group(group_id)
    if not group:
        raise RepositoryError("GROUP_NOT_FOUND", "모임을 찾을 수 없습니다.", 404)
    if group["version"] != payload.version:
        raise RepositoryError("RESOURCE_VERSION_CONFLICT", "모임 버전이 변경되었습니다.", 409)
    result = await service.start(
        user_id,
        RunStart(
            message="참여자 조건을 반영해 일정을 생성해 주세요.",
            intent="scheduling",
            group_id=group_id,
        ),
    )
    return success(result, request, status_code=201)


async def decide(group_id, proposal_id, payload, request, user_id, decision):
    service = request.app.state.agents
    await service.user(user_id)
    group = await WorkflowService(service).leader_group(user_id, group_id)
    if group["version"] != payload.version:
        raise RepositoryError("RESOURCE_VERSION_CONFLICT", "모임 버전이 변경되었습니다.", 409)
    proposal = next((item for item in group["schedule"]["proposals"] if item["id"] == proposal_id), None)
    if proposal is None:
        raise RepositoryError("PROPOSAL_NOT_FOUND", "해당 모임의 제안이 아닙니다.", 404)
    execution = await _proposal_execution(service, user_id, proposal_id)
    if decision == "reject" and proposal["status"] == "draft":
        lock = service.storage.run_lock(execution["id"]) if execution else nullcontext()
        async with lock:
            current = await _proposal_run(service, user_id, group_id, proposal_id, execution)
            if current is None or current["status"] not in {"waiting_approval", "waiting_input", "completed"}:
                # No active graph invocation can write this draft while the execution lock is held.
                await get_repository(request).reject_agent_proposal(group_id, proposal_id, user_id)
                return success({"status": "rejected", "proposalId": proposal_id}, request)
        if current["status"] == "waiting_input":
            decision = "cancel"
    else:
        current = await _proposal_run(service, user_id, group_id, proposal_id, execution)
    if current is None:
        raise RepositoryError("AGENT_PROPOSAL_REQUIRED", "승인 가능한 에이전트 제안이 없습니다.", 409)
    resumed = await service.resume(
        user_id,
        current["runId"],
        ResumeRun(checkpoint_id=current["checkpointId"], decision=decision),
    )
    return success(resumed, request)


@router.post(
    "/groups/{group_id}/schedule/proposals/{proposal_id}/approve",
    operation_id="approveScheduleProposal",
)
async def approve(group_id: str, proposal_id: str, payload: ProposalAction, request: Request):
    return await decide(group_id, proposal_id, payload, request, current_user_id(request), "approve")


@router.post(
    "/groups/{group_id}/schedule/proposals/{proposal_id}/reject",
    operation_id="rejectScheduleProposal",
)
async def reject(group_id: str, proposal_id: str, payload: ProposalAction, request: Request):
    return await decide(group_id, proposal_id, payload, request, current_user_id(request), "reject")
