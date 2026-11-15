"""Compatibility URLs delegate to the shared graph; there is no approval bypass."""
from fastapi import APIRouter,Depends,Request
from app.core.api import success
from app.core.auth import current_user_id, require_current_user
from app.core.repositories import get_repository
from app.core.repository import RepositoryError
from app.features.agents.schemas import RunStart, ResumeRun
from .schemas import ProposalAction,ProposalCreate,ScheduleValidateRequest
router = APIRouter(tags=["schedules"], dependencies=[Depends(require_current_user)])
@router.get("/groups/{group_id}/schedule",operation_id="getGroupSchedule")
async def get_schedule(group_id: str,request: Request):
    service = request.app.state.agents
    await service.user(current_user_id(request))
    group = await get_repository(request).group(group_id)
    if not group: raise RepositoryError("GROUP_NOT_FOUND","모임을 찾을 수 없습니다.",404)
    if not any(m["userId"] == current_user_id(request) for m in group["members"]): raise RepositoryError("GROUP_MEMBER_ONLY","참여자만 접근할 수 있습니다.",403)
    return success(group["schedule"],request)
@router.post("/groups/{group_id}/schedule/validate",operation_id="validateGroupSchedule")
async def validate_schedule(group_id: str,payload: ScheduleValidateRequest,request: Request):
    return success(await request.app.state.agents.validate_group(current_user_id(request),group_id,payload.version),request)
@router.post("/groups/{group_id}/schedule/proposals",status_code=201,operation_id="createScheduleProposal")
async def create_proposal(group_id: str,payload: ProposalCreate,request: Request):
    service = request.app.state.agents
    await service.user(current_user_id(request))
    group = await get_repository(request).group(group_id)
    if not group: raise RepositoryError("GROUP_NOT_FOUND","모임을 찾을 수 없습니다.",404)
    if group["version"] != payload.version: raise RepositoryError("RESOURCE_VERSION_CONFLICT","모임 버전이 변경되었습니다.",409)
    result = await service.start(current_user_id(request),RunStart(message="참여자 조건을 반영해 일정을 생성해 주세요.",intent="scheduling",group_id=group_id))
    return success(result,request,status_code=201)
async def decide(group_id,proposal_id,payload,request,user_id,decision):
    service = request.app.state.agents
    await service.user(user_id)
    run = await service.memory.run_for_proposal(proposal_id,user_id)
    if run["group_id"] != group_id: raise RepositoryError("PROPOSAL_NOT_FOUND","해당 모임의 제안이 아닙니다.",404)
    group = await get_repository(request).group(group_id)
    if group["version"] != payload.version: raise RepositoryError("RESOURCE_VERSION_CONFLICT","모임 버전이 변경되었습니다.",409)
    current = await service.get(user_id,run["id"])
    return success(await service.resume(user_id,run["id"],ResumeRun(checkpoint_id=current["checkpointId"],decision=decision)),request)
@router.post("/groups/{group_id}/schedule/proposals/{proposal_id}/approve",operation_id="approveScheduleProposal")
async def approve(group_id: str,proposal_id: str,payload: ProposalAction,request: Request):
    return await decide(group_id,proposal_id,payload,request,current_user_id(request),"approve")
@router.post("/groups/{group_id}/schedule/proposals/{proposal_id}/reject",operation_id="rejectScheduleProposal")
async def reject(group_id: str,proposal_id: str,payload: ProposalAction,request: Request):
    return await decide(group_id,proposal_id,payload,request,current_user_id(request),"reject")
