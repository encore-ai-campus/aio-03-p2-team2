from fastapi import APIRouter, Request, Depends
from app.core.api import success
from app.core.auth import current_user_id, require_current_user
from .schemas import RunStart, ResumeRun

router = APIRouter(prefix="/agents",tags=["agents"], dependencies=[Depends(require_current_user)])

@router.get("/workflow")
async def workflow(request: Request):
    return success({"mermaid":request.app.state.agents.graph.get_graph().draw_mermaid()},request)

@router.post("/runs",status_code=201)
async def start_run(payload: RunStart,request: Request):
    return success(await request.app.state.agents.start(current_user_id(request),payload),request,status_code=201)

@router.get("/runs/{run_id}")
async def get_run(run_id: str,request: Request):
    return success(await request.app.state.agents.get(current_user_id(request),run_id),request)

@router.post("/runs/{run_id}/resume")
async def resume_run(run_id: str,payload: ResumeRun,request: Request):
    return success(await request.app.state.agents.resume(current_user_id(request),run_id,payload),request)

@router.get("/preferences")
async def preferences(request: Request):
    service = request.app.state.agents
    await service.user(current_user_id(request))
    return success(await service.memory.preferences(current_user_id(request)),request)
