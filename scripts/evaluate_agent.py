"""Controlled fault injection, NOT a live LLM benchmark. Compare identical inputs."""
import asyncio
from copy import deepcopy
from datetime import datetime,timezone
import json
from pathlib import Path
from tempfile import TemporaryDirectory

from tests.ephemeral_storage import EphemeralAgentStorage
from app.core.config import Settings
from app.core.demo_repository import DemoRepository
from app.features.agents.service import AgentService
from app.features.agents.providers import RuleBasedModel
from app.features.agents.policy import validate_plan
from app.features.agents.schemas import RunStart,Conditions
from app.features.agents.tools import AgentTools,ToolFailure


class ControlledModel(RuleBasedModel):
    def __init__(self,fault,repair): self.fault,self.repair=fault,repair
    async def generate(self,state):
        result=await super().generate(state)
        if state["iteration"] == 0:
            if self.fault == "too_early": result["items"][0]["time"]="00:00"
            if self.fault == "wrong_date": result["items"][0]["date"]="2000-01-01"
            if self.fault == "overlap": result["items"][1]["time"]=result["items"][0]["time"]
        return result
    async def reflect(self,state):
        if not self.repair: return {"action":"stop","reason":"비교 기준: 성찰 후 재실행 비활성화"}
        return await super().reflect(state)


class ControlledTools(AgentTools):
    def __init__(self,*args,fault,**kwargs): super().__init__(*args,**kwargs); self.fault=fault; self.calls=0
    async def get_weather(self,state):
        self.calls+=1
        if self.fault == "outage" or (self.fault == "transient" and self.calls <= 2):
            raise ToolFailure("TOOL_NETWORK_ERROR","시험에서 주입한 통신 실패",True)
        return await super().get_weather(state)


async def measure(root,repair):
    rows=[]
    for fault in ("normal","too_early","wrong_date","overlap","transient","outage"):
        repo=DemoRepository()
        group=await repo.create_group("usr_demo_02",dict(festivalId="fst_demo_music",title="평가",postBody="격리된 테스트 데이터",joinMode="approval",capacity=4))
        config=Settings(_env_file=None,database_url=None,agent_data_dir=root/("after" if repair else "before")/fault,agent_max_iterations=2,agent_tool_retries=1)
        tools=ControlledTools(repo,config,fault=fault)
        service=await AgentService(repo,config,model=ControlledModel(fault,repair),tools=tools,storage=EphemeralAgentStorage()).open()
        try:
            result=await service.start("usr_demo_02",RunStart(message="오후 2시 이후 일정 생성",group_id=group["id"],conditions=Conditions(start_time="14:00")))
            snapshot=await service.graph.aget_state(service.config(result["runId"]))
            state=snapshot.values
            # Completion means a VALID proposal ready for human approval; no automatic write.
            completed=result["status"] == "waiting_approval"
            plan_events=[event for event in result["trace"] if event["node"] == "plan_tools"]
            correct_tools=all(event["tools"] == ["get_festival","get_availability","get_weather"] for event in plan_events)
            consistent=not validate_plan(state.get("candidate"),state["conditions"],state["tool_results"],"scheduling") if state.get("candidate") else False
            candidate_events=sum(event["node"] == "generate_candidate" for event in result["trace"])
            rows.append(dict(case=fault,status=result["status"],completed=completed,correctTools=correct_tools,consistent=consistent,reasoningReruns=max(0,candidate_events-1),toolRetries=sum(call["attempt"] > 1 for call in result["toolCalls"]),trace=result["trace"],toolCalls=result["toolCalls"]))
        finally: await service.close()
    count=len(rows)
    return {"metrics":{"taskCompletionRate":sum(r["completed"] for r in rows)/count,"toolSelectionAccuracy":sum(r["correctTools"] for r in rows)/count,"consistencyScore":sum(r["consistent"] for r in rows)/count,"averageReasoningReruns":sum(r["reasoningReruns"] for r in rows)/count},"cases":rows}


async def evaluate(output):
    with TemporaryDirectory(prefix="festamate-eval-") as directory:
        root=Path(directory)
        report={"measuredAt":datetime.now(timezone.utc).isoformat(),"mode":"controlled_fault_injection_rules_demo_in_memory","limits":"Not live OpenAI/API performance; identical six cases, same providers and tool retry cap. Only reflect policy changes.","before":await measure(root,False),"after":await measure(root,True)}
    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps({phase:report[phase]["metrics"] for phase in ("before","after")},ensure_ascii=False,indent=2))

if __name__ == "__main__":
    import argparse
    parser=argparse.ArgumentParser()
    parser.add_argument("--output",type=Path,default=Path("data/agent-evaluation.json"))
    asyncio.run(evaluate(parser.parse_args().output))
