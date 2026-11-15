"""Injected test double only. The FastAPI runtime never selects this storage."""
import asyncio
from contextlib import asynccontextmanager
from copy import deepcopy

from langgraph.checkpoint.memory import InMemorySaver
from app.core.repository import RepositoryError


class EphemeralAgentStorage:
    def __init__(self):
        self.memory = self
        self.checkpointer = InMemorySaver()
        self.sessions, self.prefs, self.runs, self.locks = {}, {}, {}, {}

    async def open(self): return self
    async def close(self): pass

    @asynccontextmanager
    async def run_lock(self, run_id):
        async with self.locks.setdefault(run_id, asyncio.Lock()): yield

    async def session(self, session_id, user_id):
        row=self.sessions.setdefault(session_id,dict(user_id=user_id,summary={},messages=[],conditions={}))
        if row["user_id"] != user_id: raise RepositoryError("SESSION_FORBIDDEN","다른 사용자의 세션입니다.",403)
        return deepcopy(row)

    async def preferences(self,user_id): return deepcopy(self.prefs.get(user_id,{}))
    async def remember(self,user_id,confirmed): self.prefs.setdefault(user_id,{}).update(deepcopy(confirmed))
    async def add_run(self,run_id,user_id,session_id,group_id):
        self.runs[run_id]=dict(id=run_id,user_id=user_id,session_id=session_id,group_id=group_id,status="running",proposal_id=None)
    async def run(self,run_id,user_id):
        row=self.runs.get(run_id)
        if not row: raise RepositoryError("AGENT_RUN_NOT_FOUND","실행을 찾을 수 없습니다.",404)
        if row["user_id"] != user_id: raise RepositoryError("AGENT_RUN_FORBIDDEN","다른 사용자의 실행입니다.",403)
        return deepcopy(row)
    async def run_for_proposal(self,proposal_id,user_id):
        row=next((r for r in self.runs.values() if r["proposal_id"] == proposal_id),None)
        if not row: raise RepositoryError("AGENT_PROPOSAL_REQUIRED","에이전트 제안이 필요합니다.",409)
        return await self.run(row["id"],user_id)
    async def update_run(self,state):
        self.runs[state["run_id"]].update(status=state["status"],proposal_id=state.get("proposal_id"),group_id=state.get("group_id"))
    async def finish_session(self,state):
        row=self.sessions[state["session_id"]]
        row["messages"]=(row["messages"]+[{"role":"user","text":state["message"][:500]},{"role":"assistant","text":str((state.get("result") or {}).get("summary") or state["status"])[:500]}])[-6:]
        row["summary"]={"conditions":deepcopy(state["conditions"]),"lastIntent":state["intent"],"lastStatus":state["status"]}
        row["conditions"]=deepcopy(state["conditions"])
