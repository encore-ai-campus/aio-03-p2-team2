from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest

from app.core.repository import RepositoryError
from app.features.agents.schemas import Conditions, ResumeRun, RunStart
from app.features.agents.workflow import AlternativeSelect, RecruitmentCreate, ScheduleRequest, WorkflowService
from app.features.alerts.monitor import WeatherMonitor
from app.main import create_app
from tests.auth_helpers import install_test_identity, token_headers
from tests.ephemeral_storage import EphemeralAgentStorage
from tests.test_agent_workflow import USER, FirstWrongModel, make_service, seed, settings, running


@pytest.mark.asyncio
async def test_matching_asks_time_then_recruitment_reuses_conditions(running):
    agents, repo, group, day = running
    run = await agents.start(USER, RunStart(message="동행 추천", intent="matching",
        festival_id=group["festivalId"], conditions=Conditions(date=day)))
    assert run["status"] == "waiting_input"
    assert run["interrupt"]["missing"] == ["startTime"]
    assert run["interrupt"]["message"] == "몇 시에 참여하실 건가요?"
    run = await agents.resume(USER, run["runId"], ResumeRun(checkpoint_id=run["checkpointId"], message="오후 3시부터"))
    assert run["status"] == "completed"
    workflow = WorkflowService(agents)
    payload = RecruitmentCreate(title="함께 가요", post_body="오후 3시 동행")
    results = [await workflow.recruit(USER, run["runId"], payload) for _ in range(2)]
    assert results[0]["group"]["id"] == results[1]["group"]["id"]
    created = results[0]["group"]
    assert created["joinMode"] == "approval"
    assert created["schedule"]["current"]["time"] == "15:00"
    assert created["schedule"]["current"]["date"] == day
    scheduled = await workflow.schedule(USER, created["id"], ScheduleRequest())
    assert scheduled["status"] == "waiting_approval"
    assert scheduled["conditions"]["start_time"] == "15:00"


@pytest.mark.asyncio
async def test_workflow_cannot_use_other_account_or_unfinished_matching(running):
    agents, repo, group, day = running
    run = await agents.start(USER, RunStart(message="동행", intent="matching", festival_id=group["festivalId"]))
    workflow = WorkflowService(agents)
    for user, code in [(USER, "MATCHING_REQUIRED"), ("usr_demo_01", "AGENT_RUN_FORBIDDEN")]:
        with pytest.raises(RepositoryError) as exc:
            await workflow.recruit(user, run["runId"], RecruitmentCreate(title="동행", post_body="같이 가요"))
        assert exc.value.code == code
    with pytest.raises(RepositoryError) as exc:
        await workflow.schedule("usr_demo_01", group["id"], ScheduleRequest())
    assert exc.value.code == "LEADER_ONLY"


@pytest.mark.asyncio
@pytest.mark.parametrize("decision", ["approve", "reject", "cancel"])
async def test_alternative_festival_only_changes_on_approved_schedule(running, decision):
    agents, repo, group, day = running
    workflow = WorkflowService(agents)
    original = deepcopy(group["schedule"])
    risk = await workflow.risk(USER, group["id"])
    assert risk["status"] == "completed"
    target = risk["candidate"]["items"][0]["id"]
    run = await workflow.select(USER, risk["runId"], AlternativeSelect(festival_id=target))
    assert run["status"] == "waiting_approval"
    assert run["comparison"]["before"] == original
    assert (await repo.group(group["id"]))["festivalId"] == group["festivalId"]
    await agents.resume(USER, run["runId"], ResumeRun(checkpoint_id=run["checkpointId"], decision=decision))
    updated = await repo.group(group["id"])
    assert updated["festivalId"] == (target if decision == "approve" else group["festivalId"])
    assert updated["schedule"]["version"] == (2 if decision == "approve" else 1)


@pytest.mark.asyncio
async def test_unoffered_or_cancelled_alternative_rejected(running):
    agents, repo, group, _ = running
    workflow = WorkflowService(agents)
    risk = await workflow.risk(USER, group["id"])
    with pytest.raises(RepositoryError) as exc:
        await workflow.select(USER, risk["runId"], AlternativeSelect(festival_id="arbitrary"))
    assert exc.value.code == "ALTERNATIVE_NOT_OFFERED"
    target = risk["candidate"]["items"][0]["id"]
    repo.store.festivals[target]["riskStatus"] = "cancelled"
    with pytest.raises(RepositoryError) as exc:
        await workflow.select(USER, risk["runId"], AlternativeSelect(festival_id=target))
    assert exc.value.code == "FESTIVAL_UNAVAILABLE"


@pytest.mark.asyncio
async def test_repair_history_preserves_before_after_and_error(tmp_path):
    repo, day = seed()
    from tests.test_agent_workflow import group as create_group
    group = await create_group(repo)
    agents = await make_service(repo, settings(tmp_path), model=FirstWrongModel()).open()
    try:
        run = await WorkflowService(agents).schedule(USER, group["id"], ScheduleRequest())
        assert run["status"] == "waiting_approval"
        history = run["candidateHistory"]
        assert len(history) == 2
        assert history[0]["errors"]
        assert history[0]["candidate"]["items"][0]["time"] == "00:00"
        assert not history[1]["errors"]
        assert history[1]["repair"]["action"] == "regenerate"
        assert run["comparison"]["after"] == history[1]["candidate"]
    finally:
        await agents.close()


@pytest.mark.asyncio
async def test_workflow_http_auth_and_question_contract(tmp_path):
    repo, day = seed()
    app = create_app(settings(tmp_path), repository=repo, agent_storage=EphemeralAgentStorage())
    install_test_identity(app, repo)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            body = {"message":"동행 찾아줘", "intent":"matching", "festivalId":"fst_demo_music", "conditions":{"date":day}}
            assert (await client.post("/api/v1/agents/runs", json=body)).status_code == 401
            response = await client.post("/api/v1/agents/runs", json=body, headers=token_headers())
            run = response.json()["data"]
            assert run["interrupt"]["questions"] == [{"field":"startTime", "message":"몇 시에 참여하실 건가요?"}]
            response = await client.post(f"/api/v1/agents/runs/{run['runId']}/resume", headers=token_headers(),
                json={"checkpointId":run["checkpointId"], "answers":{"startTime":"15:00"}})
            assert response.json()["data"]["status"] == "completed"
            url = f"/api/v1/workflow/matching/{run['runId']}/group"
            body = {"title":"같이 가요", "postBody":"오후 3시"}
            assert (await client.post(url, json=body, headers=token_headers("usr_demo_01"))).status_code == 403
            response = await client.post(url, json=body, headers=token_headers())
            assert response.status_code == 201
            group_id = response.json()["data"]["group"]["id"]
            response = await client.post(f"/api/v1/workflow/groups/{group_id}/schedule", json={}, headers=token_headers())
            assert response.json()["data"]["status"] == "waiting_approval"


class ConnectionContext:
    def __init__(self, connection): self.connection = connection
    async def __aenter__(self): return self.connection
    async def __aexit__(self, *args): pass


class WeatherDatabase:
    def __init__(self):
        self.created = set()
        self.members = {"leader":True, "member":True, "opted-out":False}
        self.pool = self
        self.items = [{"date":"2030-01-01", "time":"15:00"}]
    def acquire(self): return ConnectionContext(self)
    def transaction(self): return ConnectionContext(self)
    async def fetchrow(self, query, *args):
        return {"festival_id":"festival", "items":deepcopy(self.items)}
    async def fetch(self, query, group_id, festival_id, key, evidence, title, is_test):
        assert "gm.left_at is null and n.risk_alert=true" in query
        assert "on conflict (user_id,event_key) do nothing" in query
        created = []
        for member, consent in self.members.items():
            if consent and (member,key) not in self.created:
                self.created.add((member,key)); created.append({"id":member})
        return created


@pytest.mark.asyncio
@pytest.mark.parametrize("mode,probability,expected", [("live",80,2), ("demo",80,0), ("live",20,0)])
async def test_weather_alerts_are_deduplicated_and_demo_never_notifies(mode, probability, expected):
    database = WeatherDatabase()
    async def invoke(name, state):
        if name == "get_festival": return {"data":{"id":"festival"}}
        return {"data":{"precipitationProbability":probability,"weatherCode":1}, "mode":mode}
    monitor = WeatherMonitor(database, SimpleNamespace(tools=SimpleNamespace(invoke=invoke)), None)
    first = await monitor.check("group")
    second = await monitor.check("group")
    assert first["createdAlertCount"] == expected
    assert second["createdAlertCount"] == 0
    assert all(member != "opted-out" for member,key in database.created)


@pytest.mark.asyncio
async def test_weather_monitor_closes_background_task():
    monitor = WeatherMonitor(SimpleNamespace(pool=object()), None,
        SimpleNamespace(agent_weather_provider="openmeteo", weather_monitor_interval_seconds=300))
    monitor.targets = AsyncMock(return_value=[])
    monitor.start()
    import asyncio
    await asyncio.sleep(0)
    await monitor.close()
    assert monitor.task.done()


@pytest.mark.asyncio
async def test_weather_simulation_is_labelled_and_blocked_in_production():
    database = WeatherDatabase()
    tools = SimpleNamespace(invoke=AsyncMock(return_value={"data":{"id":"festival"}}))
    monitor = WeatherMonitor(database, SimpleNamespace(tools=tools), SimpleNamespace(app_env="development"))
    result = await monitor.check("group", simulate=True)
    assert result["isTest"] is True
    assert result["weather"]["mode"] == "simulation"
    assert result["createdAlertCount"] == 2
    # Simulation never calls the live weather service.
    assert tools.invoke.await_count == 1
    monitor.settings.app_env = "production"
    with pytest.raises(RepositoryError) as exc:
        await monitor.check("group", simulate=True)
    assert exc.value.code == "SIMULATION_DEVELOPMENT_ONLY"


@pytest.mark.asyncio
async def test_selected_festival_is_revalidated_before_approval(running):
    agents, repo, group, _ = running
    workflow = WorkflowService(agents)
    risk = await workflow.risk(USER, group["id"])
    target = risk["candidate"]["items"][0]["id"]
    run = await workflow.select(USER, risk["runId"], AlternativeSelect(festival_id=target))
    repo.store.festivals[target]["riskStatus"] = "cancelled"
    result = await agents.resume(USER, run["runId"], ResumeRun(checkpoint_id=run["checkpointId"], decision="approve"))
    assert result["status"] == "failed"
    assert (await repo.group(group["id"]))["festivalId"] == group["festivalId"]


@pytest.mark.asyncio
async def test_new_matching_question_does_not_override_explicit_time(running):
    agents, repo, group, day = running
    run = await agents.start(USER, RunStart(message="동행 찾아줘", intent="matching",
        festival_id=group["festivalId"], conditions=Conditions(date=day, start_time="15:00")))
    assert run["status"] == "completed"
    assert run["interrupt"] is None
