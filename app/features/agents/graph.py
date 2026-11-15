from __future__ import annotations

import asyncio
from copy import deepcopy
from datetime import datetime, timezone

from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt

from app.core.repository import RepositoryError
from .policy import error, infer_intent, select_tools, validate_plan
from .schemas import Conditions
from .state import AgentState
from .tools import ToolFailure


class AgentNodes:
    def __init__(self, repository, tools, model, memory, settings):
        self.repository, self.tools, self.model = repository, tools, model
        self.memory, self.settings = memory, settings

    def update(self, state, node, **values):
        event = {"node":node,"at":datetime.now(timezone.utc).isoformat(),"iteration":state.get("iteration",0)}
        if "errors" in values:
            event["errorCodes"] = [item["code"] for item in values["errors"]]
        if "repair" in values:
            event["repair"] = values["repair"]
        if "tools" in values:
            event["tools"] = values["tools"]
        return {**values,"trace":state.get("trace",[]) + [event]}

    async def load_context(self, state):
        session = await self.memory.session(state["session_id"],state["user_id"])
        preferences = await self.memory.preferences(state["user_id"])
        context = {"preferences":preferences,"summary":session["summary"],"messages":session["messages"][-6:]}
        conditions = {**preferences,**session["conditions"],**state["conditions"]}
        return self.update(state,"load_context",context=context,conditions=conditions)

    async def parse_request(self, state):
        try:
            parsed = await self.model.parse(state["message"],state["context"])
            intent = state["intent"] if state["intent"] != "auto" else parsed["intent"]
            # Explicit structured fields have precedence over model extraction and memory.
            conditions = {**state["conditions"],**parsed.get("conditions",{}),**state.get("explicit_conditions",{})}
            conditions = Conditions.model_validate(conditions).model_dump(mode="json",exclude_none=True)
        except Exception:
            return self.update(state,"parse_request",status="failed",errors=[error("MODEL_UNAVAILABLE","조건 해석에 실패했습니다. 모델 설정 또는 입력을 확인해 주세요.")])
        group = None
        festival_id = state.get("festival_id")
        if state.get("group_id"):
            group = await self.repository.group(state["group_id"])
            if not group:
                return self.update(state,"parse_request",status="failed",errors=[error("GROUP_NOT_FOUND","모임을 찾을 수 없습니다.")])
            if group["leaderId"] != state["user_id"]:
                raise RepositoryError("LEADER_ONLY","모임장만 일정 에이전트를 실행할 수 있습니다.",403)
            if festival_id and festival_id != group["festivalId"]:
                raise RepositoryError("FESTIVAL_GROUP_MISMATCH","모임에 연결된 축제로 요청해야 합니다.",400)
            festival_id = group["festivalId"]
            current = group["schedule"].get("current")
            if current and not conditions.get("date"):
                conditions["date"] = current["date"]
        missing = []
        if intent == "scheduling" and not group:
            missing.append("groupId")
        if not festival_id:
            missing.append("festivalId")
        if not conditions.get("date"):
            missing.append("date")
        return self.update(state,"parse_request",intent=intent,conditions=conditions,group=group,festival_id=festival_id,missing=missing,status="running")

    async def ask_user(self, state):
        payload = {"type":"input_required","missing":state.get("missing",[]),"errors":state.get("errors",[]),"message":"누락 조건 또는 검증 오류를 확인하고 answers, groupId, festivalId로 응답해 주세요."}
        answer = interrupt(payload)
        if answer.get("decision") == "cancel":
            return self.update(state,"ask_user",status="cancelled")
        conditions = Conditions.model_validate(answer.get("answers") or {}).model_dump(mode="json",exclude_none=True)
        return self.update(state,"ask_user",conditions={**state["conditions"],**conditions},explicit_conditions={**state.get("explicit_conditions",{}),**conditions},group_id=answer.get("group_id") or state.get("group_id"),festival_id=answer.get("festival_id") or state.get("festival_id"),message=answer.get("message") or state["message"],errors=[],repair={},status="running")

    async def plan_tools(self, state):
        group = await self.repository.group(state["group_id"]) if state.get("group_id") else None
        if group and group["leaderId"] != state["user_id"]:
            raise RepositoryError("LEADER_ONLY","모임장만 실행을 계속할 수 있습니다.",403)
        return self.update(state,"plan_tools",tools=select_tools(state),tool_results={},tool_attempts=0,group=group)

    async def execute_tools(self, state):
        results, attempts = {}, 0
        calls = []
        for name in state["tools"]:
            for attempt in range(self.settings.agent_tool_retries + 1):
                try:
                    results[name] = await self.tools.invoke(name,{**state,"tool_results":results})
                    calls.append({"tool":name,"attempt":attempt+1,"status":"ok","source":results[name]["source"],"mode":results[name]["mode"]})
                    break
                except ToolFailure as exc:
                    calls.append({"tool":name,"attempt":attempt+1,"status":"error","code":exc.code})
                    if exc.retryable and attempt < self.settings.agent_tool_retries:
                        attempts += 1
                        await asyncio.sleep(0.05 * (attempt+1))
                        continue
                    return self.update(state,"execute_tools",tool_results=results,tool_attempts=attempts,tool_calls=state.get("tool_calls",[])+calls,errors=[error(exc.code,exc.message,tool=name,attempts=attempt+1)])
                except RepositoryError:
                    raise
                except Exception:
                    return self.update(state,"execute_tools",tool_results=results,tool_attempts=attempts,errors=[error("TOOL_RESPONSE_INVALID",f"{name} 도구 실행에 실패했습니다.",tool=name)])
        return self.update(state,"execute_tools",tool_results=results,tool_attempts=attempts,tool_calls=state.get("tool_calls",[])+calls,errors=[])

    async def generate_candidate(self, state):
        try:
            candidate = await self.model.generate(state)
            return self.update(state,"generate_candidate",candidate=candidate)
        except Exception:
            return self.update(state,"generate_candidate",candidate=None,errors=[error("MODEL_UNAVAILABLE","후보 생성에 실패했습니다. 모델 설정과 응답을 확인해야 합니다.")])

    async def validate_candidate(self, state):
        errors = validate_plan(state.get("candidate"),state["conditions"],state["tool_results"],state["intent"])
        return self.update(state,"validate_candidate",errors=errors)

    async def reflect_and_repair(self, state):
        if state["iteration"] >= self.settings.agent_max_iterations:
            return self.update(state,"reflect_and_repair",status="failed",repair={"action":"stop","reason":"판단 수정 횟수 한도에 도달했습니다."})
        try:
            strategy = await self.model.reflect(state)
        except Exception:
            strategy = {"action":"stop","reason":"수정 전략 생성에 실패했습니다."}
        action = strategy.get("action")
        if action not in {"regenerate","refresh_tools","ask_user","stop"}:
            strategy = {"action":"stop","reason":"허용되지 않는 수정 전략입니다."}
        return self.update(state,"reflect_and_repair",iteration=state["iteration"]+1,repair=strategy,status="failed" if strategy["action"] == "stop" else "running")

    async def save_proposal(self, state):
        group = state["group"]
        proposal_id = f"prp_{state['run_id'].replace('run_','')[:20]}_{state['iteration']}"
        try:
            proposal = await self.repository.save_agent_proposal(state["group_id"],state["user_id"],proposal_id,state["candidate"],group["version"],group["schedule"]["version"])
        except RepositoryError as exc:
            if exc.code == "RESOURCE_VERSION_CONFLICT":
                return self.update(state,"save_proposal",errors=[error(exc.code,exc.message)])
            raise
        return self.update(state,"save_proposal",proposal_id=proposal["id"],base_version=group["schedule"]["version"],base_group_version=group["version"],approval=None,status="running",errors=[])

    async def await_approval(self, state):
        answer = interrupt({"type":"approval_required","proposalId":state["proposal_id"],"candidate":state["candidate"],"groupVersion":state["base_group_version"],"scheduleVersion":state["base_version"]})
        decision = answer.get("decision")
        if decision not in {"approve","reject","cancel"}:
            raise RepositoryError("APPROVAL_REQUIRED","approve, reject 또는 cancel이 필요합니다.",400)
        return self.update(state,"await_approval",approval=decision,status="running" if decision == "approve" else "rejected" if decision == "reject" else "cancelled")

    async def revalidate_and_commit(self, state):
        # Refresh every external input; never trust the earlier checkpoint's weather or members.
        group = await self.repository.group(state["group_id"])
        if not group or group["leaderId"] != state["user_id"]:
            raise RepositoryError("LEADER_ONLY","현재 모임장만 일정을 확정할 수 있습니다.",403)
        committed = next((p for p in group["schedule"]["proposals"] if p["id"] == state["proposal_id"] and p["status"] == "approved"),None)
        if committed:
            return self.update(state,"revalidate_and_commit",result=group["schedule"],status="completed",errors=[])
        if group["version"] != state["base_group_version"] or group["schedule"]["version"] != state["base_version"]:
            await self.repository.reject_agent_proposal(state["group_id"],state["proposal_id"],state["user_id"])
            return self.update(state,"revalidate_and_commit",errors=[error("RESOURCE_VERSION_CONFLICT","참여자 또는 일정이 변경되어 새 제안과 승인이 필요합니다.")])
        refreshed = await self.execute_tools({**state,"group":group})
        if refreshed.get("errors"):
            return self.update(state,"revalidate_and_commit",tool_calls=refreshed.get("tool_calls",[]),errors=refreshed["errors"])
        errors = validate_plan(state["candidate"],state["conditions"],refreshed["tool_results"],state["intent"])
        if errors:
            await self.repository.reject_agent_proposal(state["group_id"],state["proposal_id"],state["user_id"])
            return self.update(state,"revalidate_and_commit",tool_calls=refreshed.get("tool_calls",[]),tool_results=refreshed["tool_results"],errors=errors)
        try:
            result = await self.repository.commit_agent_proposal(state["group_id"],state["proposal_id"],state["user_id"],state["base_group_version"],state["base_version"],refreshed["tool_results"]["get_availability"]["data"])
        except RepositoryError as exc:
            if exc.code == "RESOURCE_VERSION_CONFLICT":
                return self.update(state,"revalidate_and_commit",errors=[error(exc.code,exc.message)])
            raise
        return self.update(state,"revalidate_and_commit",tool_calls=refreshed.get("tool_calls",[]),tool_results=refreshed["tool_results"],result=result,status="completed",errors=[])

    async def finalize(self, state):
        status = state["status"]
        if status == "running":
            status = "completed"
        if status in {"cancelled","rejected","failed"} and state.get("proposal_id"):
            await self.repository.reject_agent_proposal(state["group_id"],state["proposal_id"],state["user_id"])
        update = self.update(state,"finalize",status=status,result=state.get("result") or (state.get("candidate") if status == "completed" else {"summary":state.get("repair",{}).get("reason") or status}))
        await self.memory.finish_session({**state,**update})
        return update


def build_graph(nodes: AgentNodes, checkpointer):
    graph = StateGraph(AgentState)
    names = ["load_context","parse_request","ask_user","plan_tools","execute_tools","generate_candidate","validate_candidate","reflect_and_repair","save_proposal","await_approval","revalidate_and_commit","finalize"]
    for name in names:
        graph.add_node(name,getattr(nodes,name))
    graph.add_edge(START,"load_context")
    graph.add_edge("load_context","parse_request")
    graph.add_conditional_edges("parse_request",lambda s: "finalize" if s["status"] == "failed" else "ask_user" if s["missing"] else "plan_tools",path_map=['finalize', 'ask_user', 'plan_tools'])
    graph.add_conditional_edges("ask_user",lambda s: "finalize" if s["status"] == "cancelled" else "parse_request",path_map=['finalize', 'parse_request'])
    graph.add_edge("plan_tools","execute_tools")
    graph.add_conditional_edges("execute_tools",lambda s: "reflect_and_repair" if s["errors"] else "generate_candidate",path_map=['reflect_and_repair', 'generate_candidate'])
    graph.add_conditional_edges("generate_candidate",lambda s: "reflect_and_repair" if not s.get("candidate") else "validate_candidate",path_map=['reflect_and_repair', 'validate_candidate'])
    graph.add_conditional_edges("validate_candidate",lambda s: "reflect_and_repair" if s["errors"] else "save_proposal" if s["intent"] == "scheduling" else "finalize",path_map=['reflect_and_repair', 'save_proposal', 'finalize'])
    graph.add_conditional_edges("reflect_and_repair",lambda s: {"stop":"finalize","ask_user":"ask_user","refresh_tools":"plan_tools","regenerate":"generate_candidate"}[s["repair"]["action"]],path_map=['finalize', 'ask_user', 'plan_tools', 'generate_candidate'])
    graph.add_conditional_edges("save_proposal",lambda s: "reflect_and_repair" if s["errors"] else "await_approval",path_map=['reflect_and_repair', 'await_approval'])
    graph.add_conditional_edges("await_approval",lambda s: "revalidate_and_commit" if s["approval"] == "approve" else "finalize",path_map=['revalidate_and_commit', 'finalize'])
    graph.add_conditional_edges("revalidate_and_commit",lambda s: "reflect_and_repair" if s["errors"] else "finalize",path_map=['reflect_and_repair', 'finalize'])
    graph.add_edge("finalize",END)
    return graph.compile(checkpointer=checkpointer)
