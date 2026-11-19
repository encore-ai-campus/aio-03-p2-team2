from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest

from app.core.repository import RepositoryError
from app.features.agents.schemas import ResumeRun
from app.features.agents.tools import observed
from app.features.agents.workflow import WorkflowService
from scripts.workflow_sandbox import make_sandbox
from tests.test_agent_workflow import USER, running


def monitor(probability=80, code=61):
    return SimpleNamespace(check=AsyncMock(return_value={"risk": probability >= 60,
        "weather": observed("weather_test", {"date": "2030-01-01", "precipitationProbability": probability,
            "weatherCode": code}, mode="live"), "createdAlertCount": 0, "isTest": False}))


@pytest.mark.asyncio
@pytest.mark.parametrize("message,expected", [("네", "keep"), ("y", "keep"), ("괜찮아요", "keep"),
    ("아니요", "alternatives"), ("n", "alternatives"), ("싫어요", "alternatives")])
async def test_rain_answer_branches_inside_graph_and_does_not_write_schedule(running, message, expected):
    agents, repo, group, _ = running
    original = deepcopy(await repo.group(group["id"]))
    # Low probability still prompts when weather code predicts light rain.
    review = await WorkflowService(agents).review_weather(USER, group["id"], monitor(20, 61))
    run = review["run"]
    assert run["status"] == "waiting_input"
    assert run["interrupt"]["type"] == "weather_confirmation"
    result = await agents.resume(USER, run["runId"], ResumeRun(checkpoint_id=run["checkpointId"], message=message))
    assert result["status"] == "completed"
    assert result["weatherDecision"] == expected
    if expected == "keep":
        assert result["candidate"] is None
        assert result["result"]["action"] == "keep"
        assert not result["toolCalls"]
    else:
        assert result["candidate"]["items"]
        assert "search_festivals" in [call["tool"] for call in result["toolCalls"]]
    assert await repo.group(group["id"]) == original


@pytest.mark.asyncio
async def test_clear_weather_keeps_festival_without_question(running):
    agents, repo, group, _ = running
    run = (await WorkflowService(agents).review_weather(USER, group["id"], monitor(10, 1)))["run"]
    assert run["status"] == "completed"
    assert run["interrupt"] is None
    assert run["weatherDecision"] == "keep"
    assert not run["toolCalls"]


@pytest.mark.asyncio
async def test_ambiguous_response_reprompts_and_explicit_decision_works(running):
    agents, _, group, _ = running
    run = (await WorkflowService(agents).review_weather(USER, group["id"], monitor()))["run"]
    run = await agents.resume(USER, run["runId"], ResumeRun(checkpoint_id=run["checkpointId"], message="생각해볼게요"))
    assert run["status"] == "waiting_input"
    assert not run["toolCalls"]
    run = await agents.resume(USER, run["runId"], ResumeRun(checkpoint_id=run["checkpointId"], weather_decision="alternatives"))
    assert run["status"] == "completed"
    assert run["candidate"]["items"]


@pytest.mark.asyncio
async def test_changed_schedule_cannot_consume_old_weather_confirmation(running):
    agents, repo, group, _ = running
    run = (await WorkflowService(agents).review_weather(USER, group["id"], monitor()))["run"]
    repo.store.groups[group["id"]]["schedule"]["items"][0]["endTime"] = "20:00"
    with pytest.raises(RepositoryError) as exc:
        await agents.resume(USER, run["runId"], ResumeRun(checkpoint_id=run["checkpointId"], weather_decision="alternatives"))
    assert exc.value.code == "RESOURCE_VERSION_CONFLICT"


@pytest.mark.asyncio
async def test_cancel_does_not_search_alternatives(running):
    agents, _, group, _ = running
    run = (await WorkflowService(agents).review_weather(USER, group["id"], monitor()))["run"]
    run = await agents.resume(USER, run["runId"], ResumeRun(checkpoint_id=run["checkpointId"], decision="cancel"))
    assert run["status"] == "cancelled"
    assert not run["toolCalls"]


@pytest.mark.asyncio
async def test_weather_review_http_auth_simulation_and_resume():
    app, accounts, _, weather = make_sandbox("rules")
    async with app.router.lifespan_context(app):
        app.state.weather_monitor = weather
        weather.tools = app.state.agents.tools
        group = await app.state.repository.create_group(USER, {"festivalId": "fst_demo_music", "title": "test",
            "postBody": "test", "capacity": 4, "joinMode": "approval"})
        path = f"/api/v1/workflow/groups/{group['id']}/weather-review"
        a = {"Authorization": f"Bearer {accounts['A']['token']}"}
        b = {"Authorization": f"Bearer {accounts['B']['token']}"}
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            assert (await client.post(path)).status_code == 401
            assert (await client.post(path, headers=b)).status_code == 403
            response = await client.post(path, headers=a, json={"simulateRisk": True})
            assert response.status_code == 201
            run = response.json()["data"]["run"]
            assert run["interrupt"]["weather"]["mode"] == "simulation"
            resume = f"/api/v1/agents/runs/{run['runId']}/resume"
            assert (await client.post(resume, headers=b, json={"checkpointId":run["checkpointId"], "weatherDecision":"keep"})).status_code == 403
            assert (await client.post(resume, headers=a, json={"checkpointId":run["checkpointId"], "decision":"approve"})).status_code == 400
            response = await client.post(resume, headers=a, json={"checkpointId":run["checkpointId"], "weatherDecision":"alternatives"})
            assert response.status_code == 200
            assert response.json()["data"]["candidate"]["items"]
