from __future__ import annotations

import asyncio
from contextlib import AsyncExitStack
from uuid import uuid4
from weakref import WeakValueDictionary

from .storage import PostgresAgentStorage
from langgraph.types import Command

from app.core.repository import RepositoryError
from .graph import AgentNodes, build_graph
from .providers import OpenAIModel, RuleBasedModel
from .schemas import RunStart, ResumeRun
from .tools import AgentTools
from .policy import validate_plan


class AgentService:
    """Execution boundary with PostgreSQL checkpoints, memory and cross-process resume locking."""
    def __init__(self, repository, settings, model=None, tools=None, storage=None):
        self.repository, self.settings = repository, settings
        self.model = model or (OpenAIModel(settings.openai_api_key.get_secret_value() if settings.openai_api_key else "",settings.openai_model) if settings.agent_model_provider == "openai" else RuleBasedModel())
        self.tools = tools or AgentTools(repository, settings)
        self.stack = AsyncExitStack()
        self.storage = storage if storage is not None else PostgresAgentStorage(settings)
        self.locks = WeakValueDictionary()

    async def open(self):
        try:
            await self.storage.open()
            self.stack.push_async_callback(self.storage.close)
            self.memory = self.storage.memory
            self.graph = build_graph(AgentNodes(self.repository,self.tools,self.model,self.memory,self.settings),self.storage.checkpointer)
        except BaseException:
            await self.close()
            raise
        return self

    async def close(self):
        await self.stack.aclose()
        await self.tools.close()
        if hasattr(self.model,"close"):
            await self.model.close()

    def config(self, run_id):
        limit = max(150, (self.settings.agent_max_iterations+1)*(self.settings.agent_max_tool_rounds*2+8)+30)
        return {"configurable":{"thread_id":run_id},"recursion_limit":limit}

    async def user(self, user_id):
        if not user_id or not await self.repository.user(user_id):
            raise RepositoryError("AUTH_USER_INVALID","유효한 앱 사용자를 확인할 수 없습니다.",403)

    async def start(self, user_id, payload: RunStart, *, target_festival_id=None):
        await self.user(user_id)
        group = None
        if target_festival_id:
            if not payload.group_id or payload.intent != "scheduling":
                raise RepositoryError("ALTERNATIVE_INPUT_INVALID", "대체 일정에는 모임과 scheduling 의도가 필요합니다.", 400)
            festival = await self.repository.festival(target_festival_id)
            if not festival or festival.get("riskStatus") == "cancelled":
                raise RepositoryError("FESTIVAL_UNAVAILABLE", "선택한 대체 축제를 이용할 수 없습니다.", 422)
        if payload.group_id:
            group = await self.repository.group(payload.group_id)
            if not group:
                raise RepositoryError("GROUP_NOT_FOUND","모임을 찾을 수 없습니다.",404)
            if group["leaderId"] != user_id:
                raise RepositoryError("LEADER_ONLY","모임장만 일정 에이전트를 실행할 수 있습니다.",403)
            if payload.festival_id and payload.festival_id != group["festivalId"] and payload.festival_id != target_festival_id:
                raise RepositoryError("FESTIVAL_GROUP_MISMATCH","모임에 연결된 축제로 요청해야 합니다.",400)
        session_id = payload.session_id or f"ses_{uuid4().hex}"
        await self.memory.session(session_id,user_id)
        if payload.remember is not None:
            await self.memory.remember(user_id,payload.remember.model_dump(exclude_none=True))
        run_id = f"run_{uuid4().hex}"
        await self.memory.add_run(run_id,user_id,session_id,payload.group_id)
        conditions = payload.conditions.model_dump(mode="json",exclude_none=True)
        initial = dict(run_id=run_id,session_id=session_id,user_id=user_id,message=payload.message,intent=payload.intent,group_id=payload.group_id,festival_id=payload.festival_id,conditions=conditions,explicit_conditions=conditions,iteration=0,trace=[],errors=[],repair={},status="running",tool_results={},result=None)
        initial.update(target_festival_id=target_festival_id, candidate_history=[], original_schedule=group.get("schedule") if group else None)
        await self.graph.ainvoke(initial,self.config(run_id))
        return await self.get(user_id,run_id)

    async def get(self, user_id, run_id):
        await self.user(user_id)
        await self.memory.run(run_id,user_id)
        snapshot = await self.graph.aget_state(self.config(run_id))
        state = snapshot.values
        if not state:
            raise RepositoryError("AGENT_RUN_INCOMPLETE","실행 초기화가 완료되지 않았습니다.",409)
        interrupts = [item.value for task in snapshot.tasks for item in task.interrupts]
        status = "waiting_approval" if interrupts and interrupts[0]["type"] == "approval_required" else "waiting_input" if interrupts else state["status"]
        await self.memory.update_run({**state,"status":status})
        history = state.get("candidate_history", [])
        return {
            "runId": run_id, "sessionId": state["session_id"], "status": status,
            "checkpointId": snapshot.config["configurable"].get("checkpoint_id"),
            "intent": state["intent"], "festivalId": state.get("festival_id"), "groupId": state.get("group_id"),
            "modelProvider": self.model.name, "repositoryMode": getattr(self.repository, "mode", "database"),
            "conditions": state["conditions"], "candidate": state.get("candidate"),
            "proposalId": state.get("proposal_id"), "result": state.get("result"),
            "errors": state.get("errors", []), "interrupt": interrupts[0] if interrupts else None,
            "iteration": state["iteration"], "trace": state["trace"], "toolCalls": state.get("tool_calls", []),
            "candidateHistory": history,
            "comparison": {"before": state.get("original_schedule"), "after": state.get("candidate"), "attempts": history},
            "sources": {name: {key: value for key, value in result.items() if key != "data"}
                        for name, result in state.get("tool_results", {}).items()},
        }

    async def resume(self, user_id, run_id, payload: ResumeRun):
        await self.memory.run(run_id,user_id)
        async with self.locks.setdefault(run_id,asyncio.Lock()), self.storage.run_lock(run_id):
            current = await self.get(user_id,run_id)
            if payload.checkpoint_id != current["checkpointId"]:
                raise RepositoryError("CHECKPOINT_STALE","최신 실행을 조회한 후 다시 요청해 주세요.",409)
            if not current["interrupt"]:
                raise RepositoryError("RUN_NOT_WAITING","현재 실행은 입력 또는 승인 대기 상태가 아닙니다.",409)
            approval = current["status"] == "waiting_approval"
            if approval:
                if payload.decision not in {"approve","reject","cancel"}:
                    raise RepositoryError("APPROVAL_REQUIRED","approve, reject 또는 cancel이 필요합니다.",400)
                if (payload.answers and payload.answers.model_dump(exclude_none=True)) or payload.group_id or payload.festival_id or payload.message:
                    raise RepositoryError("APPROVAL_INPUT_INVALID","승인 단계에서는 조건을 변경할 수 없습니다. 거절 후 새 실행을 시작해 주세요.",400)
            elif payload.decision in {"approve","reject"}:
                raise RepositoryError("INPUT_REQUIRED","조건 입력 단계에서는 승인을 처리할 수 없습니다.",400)
            answer = payload.model_dump(mode="json",exclude_none=True,exclude={"checkpoint_id"})
            await self.graph.ainvoke(Command(resume=answer),self.config(run_id))
            return await self.get(user_id,run_id)

    async def validate_group(self,user_id,group_id,version=None):
        await self.user(user_id)
        group = await self.repository.group(group_id)
        if not group:
            raise RepositoryError("GROUP_NOT_FOUND","모임을 찾을 수 없습니다.",404)
        if group["leaderId"] != user_id:
            raise RepositoryError("LEADER_ONLY","모임장만 수행할 수 있습니다.",403)
        if version is not None and group["version"] != version:
            raise RepositoryError("RESOURCE_VERSION_CONFLICT","모임 버전이 변경되었습니다.",409)
        items = group["schedule"].get("items") or [group["schedule"].get("current")]
        if not items or not items[0]:
            return {"status":"conflict","errors":[{"code":"SCHEDULE_MISSING","message":"검증할 일정이 없습니다."}]}
        state = dict(group_id=group_id,festival_id=group["festivalId"],conditions={"date":items[0]["date"]},tool_results={})
        for name in ("get_festival","get_availability","get_weather"):
            state["tool_results"][name] = await self.tools.invoke(name,state)
        errors = validate_plan({"summary":"기존 일정 검증","items":items},state["conditions"],state["tool_results"],"scheduling")
        return {"status":"conflict" if errors else "valid","errors":errors,"sources":state["tool_results"]}
