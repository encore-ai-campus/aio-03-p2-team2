import asyncio
import json
import os
from tests.ephemeral_storage import EphemeralAgentStorage
from tests.auth_helpers import install_test_identity, token_headers
from copy import deepcopy
from datetime import date,timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
import pytest_asyncio

from app.core.config import Settings
from app.core.demo_repository import DemoRepository
from app.core.repository import RepositoryError
from app.features.agents.providers import RuleBasedModel,OpenAIModel
from app.features.agents.service import AgentService
from app.features.agents.schemas import RunStart,ResumeRun,Conditions
from app.features.agents.tools import AgentTools,ToolFailure,observed
from app.features.agents.weather import meeting_window
from app.features.agents.workflow import WorkflowService
from app.main import create_app

USER = "usr_demo_02"

def seed(path=None):
    repo = DemoRepository(path)
    day = (date.today()+timedelta(days=1)).isoformat()
    for festival in repo.store.festivals.values():
        festival.update(startDate=day,endDate=day,operatingHours=[{"date":day,"open":"10:00","close":"21:00"}])
    return repo,day

async def group(repo):
    return await repo.create_group(USER,dict(festivalId="fst_demo_music",title="테스트 모임",postBody="일정 테스트",joinMode="approval",capacity=4))

def settings(tmp_path,**values):
    return Settings(_env_file=None,app_env="test",database_url=os.environ.get("TEST_AGENT_DATABASE_URL"),agent_data_dir=tmp_path,**values)

def make_service(repository,config,**kwargs):
    if "storage" not in kwargs and not config.database_url:
        kwargs["storage"] = EphemeralAgentStorage()
    return AgentService(repository,config,**kwargs)

@pytest_asyncio.fixture
async def running(tmp_path):
    repo,day = seed()
    g = await group(repo)
    service = await make_service(repo,settings(tmp_path)).open()
    try: yield service,repo,g,day
    finally: await service.close()

async def start(service,g,**kwargs):
    return await service.start(USER,RunStart(message="일정 생성",group_id=g["id"],**kwargs))

async def resume(service,run,decision="approve",**kwargs):
    return await service.resume(USER,run["runId"],ResumeRun(checkpoint_id=run["checkpointId"],decision=decision,**kwargs))

@pytest.mark.asyncio
async def test_proposal_approval_and_replay(running):
    service,repo,g,day = running
    before = deepcopy(g["schedule"]["items"])
    run = await start(service,g)
    assert run["status"] == "waiting_approval"
    assert (await repo.group(g["id"]))["schedule"]["items"] == before
    assert run["candidate"]["items"][0]["time"] == "13:00"
    assert run["sources"]["get_weather"]["mode"] == "demo"
    result = await resume(service,run)
    assert result["status"] == "completed"
    updated = await repo.group(g["id"])
    assert len(updated["schedule"]["items"]) == 2
    assert updated["schedule"]["version"] == 2
    assert len(updated["messages"]) == 1
    with pytest.raises(RepositoryError) as exc: await resume(service,run)
    assert exc.value.code == "CHECKPOINT_STALE"
    assert len((await repo.group(g["id"]))["messages"]) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("rain_on_draft, rain_on_approval", [(False, False), (True, False), (False, True)])
async def test_weather_window_overrun_uses_a_validated_basic_draft(running, monkeypatch, rain_on_draft, rain_on_approval):
    service, repo, group, day = running
    repo.store.festivals[group["festivalId"]].update(
        name="축제 이름 " * 22, operatingHours=[{"date": day, "open": "11:00", "close": "17:00"}],
    )
    original_schedule = deepcopy(group["schedule"]["items"])
    checked_windows = []

    async def weather(state):
        festival = state["tool_results"]["get_festival"]["data"]
        start, end = meeting_window(state, festival)
        checked_windows.append((start.strftime("%H:%M"), end.strftime("%H:%M")))
        rain_risk = rain_on_draft if len(checked_windows) == 1 else rain_on_approval
        result = {
            "date": day, "startTime": checked_windows[-1][0], "endTime": checked_windows[-1][1],
            "precipitationProbability": 90 if rain_risk else 0, "weatherCode": 61 if rain_risk else 0,
        }
        return observed("test weather", result, mode="live")

    overrun = {"summary": "long itinerary", "items": [
        {"date": day, "time": start, "endTime": end, "label": "축제 관람", "description": ""}
        for start, end in [("13:00", "14:00"), ("14:00", "15:00"), ("15:00", "16:00"), ("16:00", "16:30")]
    ]}
    generate = AsyncMock(return_value=overrun)
    monkeypatch.setattr(service.tools, "get_weather", weather)
    monkeypatch.setattr(service.model, "generate", generate)
    run = await start(service, group, conditions=Conditions(date=day, start_time="13:00", avoid_rain=rain_on_draft or rain_on_approval))

    generate.assert_awaited_once()
    assert checked_windows == [("13:00", "14:30")]
    assert [item["code"] for item in run["candidateHistory"][0]["errors"]].count("WEATHER_TIME_CONFLICT") == 3
    assert (await repo.group(group["id"]))["schedule"]["items"] == original_schedule
    if rain_on_draft:
        assert run["status"] == "waiting_input"
        assert "WEATHER_RISK" in {item["code"] for item in run["errors"]}
        assert not run["proposalId"]
    else:
        assert run["status"] == "waiting_approval"
        assert run["errors"] == []
        assert run["candidate"]["items"][0]["time"] == "13:00"
        assert run["candidate"]["items"][-1]["endTime"] == "14:30"
        assert len(run["candidateHistory"]) == 2
        result = await resume(service, run)
        if rain_on_approval:
            assert result["status"] == "waiting_input"
            assert "WEATHER_RISK" in {item["code"] for item in result["errors"]}
            assert (await repo.group(group["id"]))["schedule"]["items"] == original_schedule
        else:
            assert result["status"] == "completed"


@pytest.mark.asyncio
@pytest.mark.parametrize("hours, code", [([], "OPERATING_HOURS_MISSING"), (["11:00", "12:30"], "SCHEDULE_WINDOW_EMPTY")])
async def test_unavailable_schedule_window_does_not_call_generation(running, monkeypatch, hours, code):
    service, repo, group, day = running
    repo.store.festivals[group["festivalId"]]["operatingHours"] = [
        {"date": day, "open": hours[0], "close": hours[1]}
    ] if hours else []
    generate = AsyncMock(return_value={"summary": "fixture", "items": [
        {"date": day, "time": "13:00", "endTime": "14:30", "label": "관람", "description": ""},
    ]})
    monkeypatch.setattr(service.model, "generate", generate)
    run = await start(service, group, conditions=Conditions(date=day, start_time="13:00"))
    assert run["status"] == "waiting_input"
    assert [item["code"] for item in run["errors"]] == [code]
    assert not run["proposalId"]
    generate.assert_not_awaited()

@pytest.mark.asyncio
async def test_missing_input_then_explicit_answer(running):
    service,repo,g,day = running
    run = await service.start(USER,RunStart(message="일정 생성"))
    assert run["status"] == "waiting_input"
    assert "groupId" in run["interrupt"]["missing"]
    run = await service.resume(USER,run["runId"],ResumeRun(checkpoint_id=run["checkpointId"],group_id=g["id"],answers=Conditions(start_time="16:00")))
    assert run["status"] == "waiting_approval"
    assert run["candidate"]["items"][0]["time"] == "16:00"

@pytest.mark.asyncio
async def test_reject_and_cancel_do_not_apply(running):
    service,repo,g,_ = running
    for decision in ("reject","cancel"):
        run = await start(service,g)
        result = await resume(service,run,decision)
        assert result["status"] == ("rejected" if decision == "reject" else "cancelled")
        assert (await repo.group(g["id"]))["schedule"]["version"] == 1

@pytest.mark.asyncio
async def test_permission_and_session_ownership(running):
    service,repo,g,_ = running
    run = await start(service,g)
    for action in (lambda:service.get("usr_demo_01",run["runId"]),lambda:service.start("usr_demo_01",RunStart(message="일정",group_id=g["id"])),lambda:service.start("usr_demo_01",RunStart(message="일정",session_id=run["sessionId"]))):
        with pytest.raises(RepositoryError) as exc: await action()
        assert exc.value.status_code == 403

@pytest.mark.asyncio
async def test_member_change_requires_new_approval(running):
    service,repo,g,_ = running
    run = await start(service,g)
    ref = repo.store.groups[g["id"]]
    ref["members"].append({"userId":"usr_demo_01","role":"member"})
    ref["version"] += 1
    result = await resume(service,run)
    assert result["status"] == "waiting_approval"
    assert result["proposalId"] != run["proposalId"]
    assert result["candidate"]["items"][0]["time"] == "15:00"
    assert ref["schedule"]["version"] == 1
    assert ref["schedule"]["proposals"][0]["status"] == "rejected"
    assert (await resume(service,result))["status"] == "completed"

@pytest.mark.asyncio
async def test_profile_change_without_group_version_revalidated(running):
    service,repo,g,_ = running
    run = await start(service,g)
    await repo.update_profile(USER,{"availableFrom":"17:00"})
    result = await resume(service,run)
    assert result["status"] == "waiting_approval"
    assert result["candidate"]["items"][0]["time"] == "17:00"
    assert (await repo.group(g["id"]))["schedule"]["version"] == 1

@pytest.mark.asyncio
async def test_concurrent_resume_is_not_double_commit(running):
    service,repo,g,_=running
    run=await start(service,g)
    results=await asyncio.gather(resume(service,run),resume(service,run),return_exceptions=True)
    assert sum(isinstance(r,dict) and r["status"] == "completed" for r in results) == 1
    assert sum(isinstance(r,RepositoryError) and r.code == "CHECKPOINT_STALE" for r in results) == 1
    assert (await repo.group(g["id"]))["schedule"]["version"] == 2

@pytest.mark.asyncio
async def test_committed_write_before_checkpoint_is_recovered(running):
    service,repo,g,_=running
    run=await start(service,g)
    snapshot=await service.graph.aget_state(service.config(run["runId"]))
    state=snapshot.values
    # Simulate a process failure after business commit and before its graph checkpoint.
    await repo.commit_agent_proposal(g["id"],run["proposalId"],USER,1,1,state["tool_results"]["get_availability"]["data"])
    result=await resume(service,run)
    assert result["status"] == "completed"
    assert (await repo.group(g["id"]))["schedule"]["version"] == 2
    assert len((await repo.group(g["id"]))["messages"]) == 1

@pytest.mark.asyncio
async def test_group_cannot_schedule_different_festival(running):
    service,repo,g,_=running
    with pytest.raises(RepositoryError) as exc:
        await start(service,g,festival_id="fst_demo_food")
    assert exc.value.code == "FESTIVAL_GROUP_MISMATCH"

@pytest.mark.asyncio
async def test_user_does_not_override_member_time(running):
    service,repo,g,_=running
    repo.store.groups[g["id"]]["members"].append({"userId":"usr_demo_01","role":"member"})
    run=await start(service,g,conditions=Conditions(start_time="10:00",end_time="14:00"))
    assert run["status"] == "waiting_input"
    assert [item["code"] for item in run["errors"]] == ["SCHEDULE_WINDOW_EMPTY"]
    assert not (await repo.group(g["id"]))["schedule"]["proposals"]

@pytest.mark.asyncio
async def test_sql_jsonb_schedule_view():
    import json
    from app.features.groups.repository import GroupRepositoryMixin
    items=[dict(date="2030-01-01",time="13:00",endTime="14:00",label="축제",description="")]
    view=GroupRepositoryMixin._schedule_view({"items":json.dumps(items),"version":1,"validation_status":None},[])
    assert view["current"]["label"] == "축제"
    assert view["items"] == items

@pytest.mark.asyncio
async def test_restart_can_resume_checkpoint(tmp_path):
    repo,day = seed(tmp_path/"demo-state.json")
    g = await group(repo)
    service = await make_service(repo,settings(tmp_path)).open()
    run = await start(service,g)
    await service.close()
    restored = await make_service(DemoRepository(tmp_path/"demo-state.json"),settings(tmp_path),storage=service.storage).open()
    try:
        assert (await restored.get(USER,run["runId"]))["status"] == "waiting_approval"
        assert (await resume(restored,run))["status"] == "completed"
    finally: await restored.close()

class BrokenModel(RuleBasedModel):
    async def generate(self,state):
        candidate = await super().generate(state)
        candidate["items"][0]["endTime"] = candidate["items"][0]["time"]
        return candidate

class FirstWrongModel(RuleBasedModel):
    async def generate(self,state):
        result = await super().generate(state)
        if state["iteration"] == 0: result["items"][0]["time"] = "00:00"
        return result

@pytest.mark.asyncio
@pytest.mark.parametrize("model,expected",[(BrokenModel(),"failed"),(FirstWrongModel(),"waiting_approval")])
async def test_reasoning_repair_is_bounded(tmp_path,model,expected):
    repo,_ = seed(); g = await group(repo)
    service = await make_service(repo,settings(tmp_path,agent_max_iterations=2),model=model).open()
    try:
        run = await start(service,g)
        assert run["status"] == expected
        assert run["iteration"] <= 2
        if expected == "failed":
            assert "reflect_and_repair" in [event["node"] for event in run["trace"]]
            assert (await repo.group(g["id"]))["schedule"]["proposals"] == []
        else:
            assert run["candidate"]["items"][0]["time"] == "13:00"
    finally: await service.close()

class FailingWeather(AgentTools):
    def __init__(self,*args,failures=1,**kwargs):
        super().__init__(*args,**kwargs); self.calls=0; self.failures=failures
    async def get_weather(self,state):
        self.calls += 1
        if self.calls <= self.failures: raise ToolFailure("TOOL_NETWORK_ERROR","주입한 네트워크 실패",True)
        return await super().get_weather(state)

@pytest.mark.asyncio
async def test_transient_retry_and_exhaustion(tmp_path):
    for failures,expected in ((1,"waiting_approval"),(100,"failed")):
        repo,_ = seed(); g = await group(repo); config=settings(tmp_path/str(failures),agent_max_iterations=2,agent_tool_retries=1)
        tools=FailingWeather(repo,config,failures=failures)
        service=await make_service(repo,config,tools=tools).open()
        try:
            run=await start(service,g)
            assert run["status"] == expected
            assert tools.calls == (2 if failures == 1 else 6)
        finally: await service.close()

@pytest.mark.asyncio
async def test_weather_change_at_approval_asks_instead_of_applying(running):
    service,repo,g,_ = running
    run = await start(service,g,conditions=Conditions(avoid_rain=True))
    original = service.tools.get_weather
    async def rainy(state):
        result = await original(state); result["data"]["precipitationProbability"] = 90; return result
    service.tools.get_weather = rainy
    result = await resume(service,run)
    assert result["status"] == "waiting_input"
    assert result["errors"][0]["code"] == "WEATHER_RISK"
    assert (await repo.group(g["id"]))["schedule"]["version"] == 1

@pytest.mark.asyncio
async def test_explicit_preferences_and_bounded_session(running):
    service,repo,g,day = running
    from app.features.agents.schemas import Preferences
    run = await start(service,g,remember=Preferences(avoid_rain=True),conditions=Conditions(avoid_rain=False,start_time="15:00"))
    assert run["conditions"]["avoid_rain"] is False
    await resume(service,run,"reject")
    assert (await service.memory.preferences(USER))["avoid_rain"] is True
    for index in range(4):
        run = await service.start(USER,RunStart(message="매칭",intent="matching",festival_id=g["festivalId"],session_id=run["sessionId"],conditions=Conditions(date=day)))
        assert run["status"] == "completed"
    session=await service.memory.session(run["sessionId"],USER)
    assert len(session["messages"]) == 6
    assert "get_weather" not in session["summary"]

@pytest.mark.asyncio
async def test_risk_response_does_not_apply_unverified_alternative(running):
    service,repo,g,day=running
    repo.store.festivals[g["festivalId"]]["riskStatus"]="cancelled"
    run=await service.start(USER,RunStart(message="축제 취소 대체",intent="risk_response",festival_id=g["festivalId"],conditions=Conditions(date=day)))
    assert run["status"] == "completed"
    assert run["candidate"]["items"][0]["id"] == "fst_demo_food"
    assert "다시 확인" in run["candidate"]["message"]

@pytest.mark.asyncio
@pytest.mark.parametrize("forecast, explicit_end, expected_end", [
    ({"startTime": "13:00", "endTime": "14:30"}, None, "14:30"),
    ({}, None, "14:45"),
    ({"startTime": "13:00", "endTime": "16:30"}, "16:30", "16:00"),
])
async def test_openai_structured_adapter_no_paid_call(forecast, explicit_end, expected_end):
    from app.features.agents.schemas import SchedulePlan
    model=OpenAIModel("test-key","test-model")
    captured={}
    async def fake_parse(**kwargs):
        captured.update(kwargs)
        return SimpleNamespace(output_parsed=SchedulePlan(summary="검증",items=[dict(date="2030-01-01",time="13:00",endTime="14:00",label="축제",description="테스트")]))
    model.client.responses.parse=fake_parse
    try:
        constraints = {"date": "2030-01-01", "start_time": "13:00", "end_time": explicit_end}
        results = {
            "get_festival": {"data": {"operatingHours": [{"date": constraints["date"], "open": "11:00", "close": "17:00"}]}},
            "get_availability": {"data": [{"availableFrom": "13:15", "availableUntil": "16:00"}]},
            "get_weather": {"data": forecast},
        }
        result=await model.generate(dict(intent="scheduling",conditions=constraints,tool_results=results,errors=[]))
        assert result["items"][0]["endTime"] == "14:00"
        assert captured["store"] is False
        assert captured["text_format"] is SchedulePlan
        assert json.loads(captured["input"][1]["content"])["scheduleWindow"] == {"startTime": "13:15", "endTime": expected_end}
        assert "scheduleWindow" in captured["input"][0]["content"]
    finally: await model.close()

@pytest.mark.asyncio
async def test_openai_refusal_is_not_accepted():
    model=OpenAIModel("test-key","test-model")
    async def refused(**kwargs): return SimpleNamespace(output_parsed=None)
    model.client.responses.parse=refused
    try:
        with pytest.raises(ValueError): await model.parse("일정",{})
    finally: await model.close()

@pytest.mark.asyncio
@pytest.mark.parametrize("tour_api_key", [None, "unused-test-key"], ids=["no-key", "key-configured"])
async def test_risk_recommendations_use_only_available_db_festivals_on_meeting_day(tmp_path, tour_api_key):
    repo, meeting_day = seed()
    meeting = await group(repo)
    day = date.fromisoformat(meeting_day)
    previous_day = (day - timedelta(days=1)).isoformat()
    next_day = (day + timedelta(days=1)).isoformat()
    template = repo.store.festivals[meeting["festivalId"]]
    for festival_id, start, end, risk_status in [
        ("starts_on_day", meeting_day, next_day, "normal"),
        ("ends_on_day", previous_day, meeting_day, "normal"),
        ("overlaps_day", previous_day, next_day, "normal"),
        ("not_yet_open", next_day, next_day, "normal"),
        ("already_ended", previous_day, previous_day, "normal"),
        ("cancelled_on_day", meeting_day, meeting_day, "cancelled"),
    ]:
        repo.store.festivals[festival_id] = {
            **template, "id": festival_id, "startDate": start, "endDate": end, "riskStatus": risk_status,
        }
    repo.festivals = AsyncMock(wraps=repo.festivals)
    config = settings(tmp_path, tour_api_service_key=tour_api_key)

    def unexpected_request(request):
        pytest.fail(f"Alternative search attempted an HTTP request to {request.url.host}")

    async with httpx.AsyncClient(transport=httpx.MockTransport(unexpected_request)) as http:
        tools = AgentTools(repo, config, http_client=http)
        service = await make_service(repo, config, tools=tools).open()
        try:
            run = await WorkflowService(service).risk(USER, meeting["id"])
        finally:
            await service.close()

    assert run["status"] == "completed"
    assert run["sources"]["search_festivals"]["source"] == "festival_repository"
    assert {item["id"] for item in run["candidate"]["items"]} == {
        "fst_demo_food", "starts_on_day", "ends_on_day", "overlaps_day",
    }
    repo.festivals.assert_awaited_once_with(start_date=day, end_date=day, status="available")

@pytest.mark.asyncio
async def test_weather_http_adapter(tmp_path):
    repo,day=seed(); config=settings(tmp_path,agent_weather_provider="openmeteo")
    async def response(request):
        assert request.url.params["start_hour"] == f"{day}T16:00"
        return httpx.Response(200,json={"hourly":{"time":[f"{day}T16:00",f"{day}T17:00"],"precipitation_probability":[65,20],"weather_code":[61,1],"wind_speed_10m":[3,2]}})
    async with httpx.AsyncClient(transport=httpx.MockTransport(response)) as http:
        tools=AgentTools(repo,config,http_client=http)
        result=await tools.get_weather({"conditions":{"date":day,"start_time":"15:00","end_time":"17:00"},"tool_results":{"get_festival":{"data":await repo.festival("fst_demo_music")}}})
        assert result["mode"] == "live" and result["data"]["precipitationProbability"] == 65

@pytest.mark.asyncio
async def test_http_contract_and_old_approval_route(tmp_path):
    repo,day=seed(); g=await group(repo)
    config=settings(tmp_path)
    app=create_app(config,repository=repo,agent_storage=None if config.database_url else EphemeralAgentStorage())
    install_test_identity(app,repo)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url="http://test") as client:
            assert (await client.get("/health")).status_code == 200
            assert (await client.get("/docs")).status_code == 200
            assert (await client.get("/openapi.json")).status_code == 200
            assert (await client.get("/api/v1/festivals")).json()["data"]["total"] == 2
            public=(await client.get(f"/api/v1/groups/{g['id']}")).json()["data"]
            assert "schedule" not in public and "messages" not in public and "joinRequests" not in public
            headers=token_headers()
            created=await client.post(f"/api/v1/groups/{g['id']}/schedule/proposals",headers=headers,json={"version":1})
            assert created.status_code == 201,created.text
            run=created.json()["data"]
            assert run["status"] == "waiting_approval"
            invalid=await client.post(f"/api/v1/agents/runs/{run['runId']}/resume",headers=headers,json={"checkpointId":run["checkpointId"],"decision":"approve","answers":{"startTime":"18:00"}})
            assert invalid.status_code == 400
            result=await client.post(f"/api/v1/groups/{g['id']}/schedule/proposals/{run['proposalId']}/approve",headers=headers,json={"version":1})
            assert result.status_code == 200,result.text
            assert result.json()["data"]["status"] == "completed"
