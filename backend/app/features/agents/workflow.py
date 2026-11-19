"""Connect existing agent and group APIs without allowing model-owned writes."""
from uuid import NAMESPACE_URL, uuid5
from copy import deepcopy

from fastapi import APIRouter, Depends, Request
from pydantic import Field

from app.core.api import success
from app.core.auth import current_user_id, require_current_user
from app.core.models import APIModel
from app.core.repository import RepositoryError
from app.features.groups.schemas import GroupCreate
from app.features.groups.service import GroupService
from .schemas import Conditions, RunStart
from .weather import schedule_conditions


class RecruitmentCreate(APIModel):
    title: str = Field(min_length=1, max_length=45)
    post_body: str = Field(min_length=1, max_length=2000)
    capacity: int | None = Field(default=None, ge=2, le=8)


class ScheduleRequest(APIModel):
    conditions: Conditions = Field(default_factory=Conditions)


class AlternativeSelect(ScheduleRequest):
    festival_id: str = Field(min_length=1, max_length=100)


class WeatherCheckRequest(APIModel):
    simulate_risk: bool = False


def _saved_schedule_conditions(group):
    schedule = group["schedule"]
    items = schedule.get("items") or ([schedule["current"]] if schedule.get("current") else [])
    if not items:
        raise RepositoryError("SCHEDULE_MISSING", "날씨를 확인할 일정이 없습니다.", 409)
    return schedule_conditions(items)


class WorkflowService:
    def __init__(self, agents):
        self.agents = agents
        self.repository = agents.repository

    async def leader_group(self, user_id, group_id):
        group = await self.repository.group(group_id)
        if not group:
            raise RepositoryError("GROUP_NOT_FOUND", "모임을 찾을 수 없습니다.", 404)
        if group["leaderId"] != user_id:
            raise RepositoryError("LEADER_ONLY", "모임장만 수행할 수 있습니다.", 403)
        return group

    async def conditions(self, user_id, group, overrides=None):
        session = await self.agents.memory.session(f"workflow_{group['id']}", user_id)
        conditions = dict(session["conditions"])
        current = group["schedule"].get("current")
        if current:
            conditions["date"] = current["date"]
            conditions["start_time"] = current["time"]
        conditions.update(overrides or {})
        return Conditions.model_validate(conditions)

    async def recruit(self, user_id, run_id, payload):
        async with self.agents.storage.run_lock(run_id):
            run = await self.agents.get(user_id, run_id)
            if run["status"] != "completed" or run["intent"] != "matching":
                raise RepositoryError("MATCHING_REQUIRED", "완료된 매칭 결과를 먼저 확인해 주세요.", 409)
            if not (run["candidate"] or {}).get("items"):
                raise RepositoryError("MATCHING_EMPTY", "매칭 후보가 없습니다. 조건을 변경해 주세요.", 422)
            group_id = f"grp_{uuid5(NAMESPACE_URL, run_id).hex}"
            group = await self.repository.group(group_id)
            if group is not None and group["leaderId"] != user_id:
                raise RepositoryError("LEADER_ONLY", "모임장만 접근할 수 있습니다.", 403)
            if group is None:
                values = GroupCreate(festival_id=run["festivalId"], title=payload.title,
                    post_body=payload.post_body, capacity=payload.capacity or run["conditions"].get("party_size") or 4,
                    join_mode="approval").model_dump(by_alias=True)
                values.update(workflowGroupId=group_id, conditions=run["conditions"])
                group = await GroupService(self.repository).create(user_id, values)
            session_id = f"workflow_{group_id}"
            session = await self.agents.memory.session(session_id, user_id)
            if not session["conditions"]:
                await self.agents.memory.finish_session(dict(session_id=session_id, user_id=user_id,
                    message="매칭 조건으로 모집글 생성", intent="matching", status="completed",
                    conditions=run["conditions"], result={"summary": "참여 신청을 기다립니다."}))
            return {"group": group, "matchingRunId": run_id, "conditions": run["conditions"]}

    async def schedule(self, user_id, group_id, payload):
        group = await self.leader_group(user_id, group_id)
        conditions = await self.conditions(user_id, group, payload.conditions.model_dump(mode="json", exclude_none=True))
        return await self.agents.start(user_id, RunStart(message="모임 참여자 조건에 맞는 일정 생성",
            intent="scheduling", group_id=group_id, conditions=conditions, session_id=f"workflow_{group_id}"))

    async def risk(self, user_id, group_id):
        group = await self.leader_group(user_id, group_id)
        conditions = await self.conditions(user_id, group, _saved_schedule_conditions(group))
        return await self.agents.start(user_id, RunStart(message="악천후에 대비한 대체 축제를 추천해줘",
            intent="risk_response", group_id=group_id, conditions=conditions))

    async def review_weather(self, user_id, group_id, monitor, *, simulate=False):
        group = await self.leader_group(user_id, group_id)
        check = await monitor.check(group_id, simulate=simulate)
        conditions = await self.conditions(user_id, group, _saved_schedule_conditions(group))
        run = await self.agents.start(user_id, RunStart(message="모임 예보를 확인하고 진행 의사를 물어봐 주세요.",
            intent="risk_response", group_id=group_id, conditions=conditions), weather_review={
                "weather": check["weather"], "groupVersion": group["version"],
                "festivalId": group["festivalId"], "schedule": deepcopy(group["schedule"])})
        return {"weatherCheck": check, "run": run}

    async def select(self, user_id, run_id, payload):
        run = await self.agents.get(user_id, run_id)
        if run["status"] != "completed" or run["intent"] != "risk_response" or not run["groupId"]:
            raise RepositoryError("RISK_RESPONSE_REQUIRED", "모임의 대체 축제 추천을 먼저 실행해 주세요.", 409)
        group = await self.leader_group(user_id, run["groupId"])
        if group["festivalId"] != run["festivalId"]:
            raise RepositoryError("RESOURCE_VERSION_CONFLICT", "모임 축제가 변경되었습니다. 다시 추천받아 주세요.", 409)
        if payload.festival_id not in {item["id"] for item in (run["candidate"] or {}).get("items", [])}:
            raise RepositoryError("ALTERNATIVE_NOT_OFFERED", "추천받은 대체 축제를 선택해 주세요.", 422)
        # Only locally persisted festivals can be referenced by the group's FK.
        conditions = Conditions.model_validate({**run["conditions"], **payload.conditions.model_dump(mode="json", exclude_none=True)})
        return await self.agents.start(user_id, RunStart(message="선택한 대체 축제로 일정 재생성",
            intent="scheduling", group_id=group["id"], festival_id=payload.festival_id,
            conditions=conditions), target_festival_id=payload.festival_id)


router = APIRouter(prefix="/workflow", tags=["workflow"], dependencies=[Depends(require_current_user)])


@router.post("/matching/{run_id}/group", status_code=201)
async def create_recruitment(run_id: str, payload: RecruitmentCreate, request: Request):
    return success(await WorkflowService(request.app.state.agents).recruit(current_user_id(request), run_id, payload), request, status_code=201)


@router.post("/groups/{group_id}/schedule", status_code=201)
async def generate_schedule(group_id: str, payload: ScheduleRequest, request: Request):
    return success(await WorkflowService(request.app.state.agents).schedule(current_user_id(request), group_id, payload), request, status_code=201)


@router.post("/groups/{group_id}/risk-response", status_code=201)
async def recommend_alternatives(group_id: str, request: Request):
    return success(await WorkflowService(request.app.state.agents).risk(current_user_id(request), group_id), request, status_code=201)


@router.post("/risk-runs/{run_id}/select", status_code=201)
async def select_alternative(run_id: str, payload: AlternativeSelect, request: Request):
    return success(await WorkflowService(request.app.state.agents).select(current_user_id(request), run_id, payload), request, status_code=201)


@router.post("/groups/{group_id}/weather-check")
async def check_weather(group_id: str, request: Request, payload: WeatherCheckRequest | None = None):
    service = WorkflowService(request.app.state.agents)
    await service.leader_group(current_user_id(request), group_id)
    return success(await request.app.state.weather_monitor.check(group_id, simulate=bool(payload and payload.simulate_risk)), request)


@router.post("/groups/{group_id}/weather-review", status_code=201)
async def review_weather(group_id: str, request: Request, payload: WeatherCheckRequest | None = None):
    result = await WorkflowService(request.app.state.agents).review_weather(
        current_user_id(request), group_id, request.app.state.weather_monitor,
        simulate=bool(payload and payload.simulate_risk))
    return success(result, request, status_code=201)
