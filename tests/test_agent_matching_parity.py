"""Compare the actual HTTP entry points with the same identity and candidate pool."""
from copy import deepcopy
from types import SimpleNamespace

import httpx
import pytest
from pydantic import ValidationError

from app.features.agents.policy import parse_text
from app.features.agents.providers import OpenAIModel
from app.features.agents.schemas import Conditions, ParsedRequest
from app.main import create_app
from tests.auth_helpers import install_test_identity, token_headers
from tests.ephemeral_storage import EphemeralAgentStorage
from tests.test_agent_workflow import USER, seed, settings
from tests.test_tool_calling import ScriptedOpenAI, call, response


def profile(**changes):
    return {"availableFrom":"13:00", "ageBand":"20대", "gender":"여성", "interests":["음악","사진"],
        "budgetManwon":8, "travelStyle":"여유롭게", "preferredPartySize":4, "mbti":["ENFP"], **changes}


def candidate(uid, **changes):
    return {"id":uid, "displayName":uid, "avatarUrl":None, "profile":profile(**changes)}


def repository():
    repo, day = seed()
    me = repo.store.users[USER]
    me["profile"].update(ageBand="20대", gender="여성")
    users = [candidate("same"), candidate("adjacent", ageBand="30대"), candidate("far", ageBand="50대"),
        candidate("male", gender="남성"), candidate("unknown", gender=None, ageBand=None),
        candidate("late", availableFrom="16:00"), candidate("no-time", availableFrom=None),
        candidate("weak", budgetManwon=80, interests=["전통"], travelStyle="활동적으로")]
    repo.store.users = {USER:me, **{user["id"]:user for user in users}}

    async def save(user_id, festival_id, conditions, candidates, top_k, create_group, group_id):
        # Storage is a fixture; routers, input validation and both business paths are real.
        return {"runId":"matching_test", "candidates":deepcopy(candidates), "group":None}

    repo.create_matching_run = save
    return repo, day


def scripted_model():
    return ScriptedOpenAI([
        response(call("get_festival", {"festival_id":"fst_demo_music"})),
        response(call("get_candidates", {"festival_id":"fst_demo_music"})), response()])


CASES = [
    {},
    {"ageBand":"30대"},
    {"genderPreference":"any"},
    {"genderPreference":"same"},
    {"genderPreference":"only_same"},
    {"ageBand":"30대","genderPreference":"only_same"},
    {"budgetManwon":8,"interests":["음악","사진"],"travelStyle":"여유롭게","partySize":4},
    {"preferredMbti":["ISTJ"],"genderPreference":"same"},
    {"ageBand":"50대","genderPreference":"only_same","interests":["전통"],"budgetManwon":100},
]


@pytest.mark.asyncio
@pytest.mark.parametrize("provider", ["rules","openai"])
@pytest.mark.parametrize("conditions", CASES)
async def test_http_matching_api_and_agent_return_identical_candidates(tmp_path, provider, conditions):
    repo, day = repository()
    model = scripted_model() if provider == "openai" else None
    app = create_app(settings(tmp_path), repository=repo, model=model, agent_storage=EphemeralAgentStorage())
    install_test_identity(app, repo)
    shared = {"startTime":"15:00", **conditions}
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url="http://test",headers=token_headers()) as client:
            direct = await client.post("/api/v1/matching/runs",json={"festivalId":"fst_demo_music","conditions":shared})
            agent = await client.post("/api/v1/agents/runs",json={"message":"동행 추천","intent":"matching",
                "festivalId":"fst_demo_music","conditions":{"date":day,**shared}})
            assert direct.status_code == agent.status_code == 201
            run = agent.json()["data"]
            assert run["status"] == "completed"
            assert run["candidate"]["items"] == direct.json()["data"]["candidates"]
            ids = {item["user"]["id"] for item in run["candidate"]["items"]}
            assert not ids & {USER,"late","no-time"}
            if shared.get("genderPreference") == "only_same":
                assert not ids & {"male","unknown"}
            if not conditions:
                assert "same" in ids and "far" not in ids
            if conditions.get("budgetManwon") == 100:
                assert not ids
            assert all(item["score"] >= 80 for item in run["candidate"]["items"])


@pytest.mark.asyncio
async def test_agent_keeps_best_candidate_after_first_fifty_rows(tmp_path):
    repo, day = repository()
    me = repo.store.users[USER]
    users = [candidate(f"weak_{index}",interests=[],budgetManwon=100,travelStyle=None) for index in range(60)]
    users.append(candidate("best_after_50"))
    repo.store.users = {USER:me, **{user["id"]:user for user in users}}
    app = create_app(settings(tmp_path),repository=repo,agent_storage=EphemeralAgentStorage())
    install_test_identity(app,repo)
    conditions = {"startTime":"15:00","interests":["음악"],"budgetManwon":8,"travelStyle":"여유롭게"}
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url="http://test",headers=token_headers()) as client:
            direct = (await client.post("/api/v1/matching/runs",json={"festivalId":"fst_demo_music","conditions":conditions})).json()["data"]
            run = (await client.post("/api/v1/agents/runs",json={"message":"동행 추천","intent":"matching","festivalId":"fst_demo_music","conditions":{"date":day,**conditions}})).json()["data"]
            assert run["status"] == "completed"
            assert run["candidate"]["items"] == direct["candidates"]
            assert run["candidate"]["items"][0]["user"]["id"] == "best_after_50"
            snapshot = await app.state.agents.graph.aget_state(app.state.agents.config(run["runId"]))
            assert len(snapshot.values["tool_results"]["get_candidates"]["data"]) <= 50


@pytest.mark.asyncio
async def test_natural_language_resume_uses_actual_profile_and_new_conditions(tmp_path):
    repo, day = repository()
    app = create_app(settings(tmp_path),repository=repo,agent_storage=EphemeralAgentStorage())
    install_test_identity(app,repo)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url="http://test",headers=token_headers()) as client:
            run = (await client.post("/api/v1/agents/runs",json={"message":"동행 추천","intent":"matching","festivalId":"fst_demo_music","conditions":{"date":day}})).json()["data"]
            assert run["status"] == "waiting_input"
            assert run["interrupt"]["missing"] == ["startTime"]
            run = (await client.post(f"/api/v1/agents/runs/{run['runId']}/resume",json={"checkpointId":run["checkpointId"],
                "message":"나는 남성이야. 오후 3시부터 30대 동성만 추천해줘"})).json()["data"]
            assert run["status"] == "completed"
            assert run["conditions"]["age_band"] == "30대"
            assert run["conditions"]["gender_preference"] == "only_same"
            direct = (await client.post("/api/v1/matching/runs",json={"festivalId":"fst_demo_music",
                "conditions":{"startTime":"15:00","ageBand":"30대","genderPreference":"only_same"}})).json()["data"]
            assert run["candidate"]["items"] == direct["candidates"]
            assert "male" not in {item["user"]["id"] for item in run["candidate"]["items"]}
            snapshot = await app.state.agents.graph.aget_state(app.state.agents.config(run["runId"]))
            assert snapshot.values["requester"]["profile"]["gender"] == "여성"


@pytest.mark.asyncio
async def test_only_same_without_own_gender_does_not_invent_or_ignore_it(tmp_path):
    repo, day = repository()
    repo.store.users[USER]["profile"]["gender"] = None
    app = create_app(settings(tmp_path),repository=repo,agent_storage=EphemeralAgentStorage())
    install_test_identity(app,repo)
    conditions = {"startTime":"15:00","genderPreference":"only_same"}
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url="http://test",headers=token_headers()) as client:
            direct = await client.post("/api/v1/matching/runs",json={"festivalId":"fst_demo_music","conditions":conditions})
            assert direct.status_code == 400
            assert direct.json()["error"]["code"] == "MATCHING_GENDER_REQUIRED"
            run = (await client.post("/api/v1/agents/runs",json={"message":"나는 여성이야. 동성만 추천","intent":"matching",
                "festivalId":"fst_demo_music","conditions":{"date":day,**conditions}})).json()["data"]
            assert run["status"] == "failed"
            assert run["errors"][0]["code"] == "MATCHING_GENDER_REQUIRED"
            assert not run["candidate"]


@pytest.mark.asyncio
async def test_real_openai_parse_schema_preserves_age_and_gender_filters(tmp_path):
    repo, day = repository()
    model = scripted_model()
    async def parse(message, context): return await OpenAIModel.parse(model,message,context)
    model.parse = parse
    captured = {}
    async def structured(**kwargs):
        captured.update(kwargs)
        return SimpleNamespace(output_parsed=ParsedRequest(intent="matching",conditions=Conditions(
            start_time="15:00",age_band="30대",gender_preference="only_same")))
    model.client.responses.parse = structured
    app = create_app(settings(tmp_path),repository=repo,model=model,agent_storage=EphemeralAgentStorage())
    install_test_identity(app,repo)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url="http://test",headers=token_headers()) as client:
            run = (await client.post("/api/v1/agents/runs",json={"message":"오후 3시 30대 동성만 추천","intent":"matching",
                "festivalId":"fst_demo_music","conditions":{"date":day}})).json()["data"]
            direct = (await client.post("/api/v1/matching/runs",json={"festivalId":"fst_demo_music",
                "conditions":{"startTime":"15:00","ageBand":"30대","genderPreference":"only_same"}})).json()["data"]
            assert run["status"] == "completed"
            assert run["candidate"]["items"] == direct["candidates"]
            assert captured["text_format"] is ParsedRequest


@pytest.mark.parametrize("payload", [{"ageBand":"60대"},{"genderPreference":"female"},{"gender":"남성"}])
def test_agent_rejects_invalid_filters_and_requester_gender_override(payload):
    with pytest.raises(ValidationError): Conditions.model_validate(payload)


@pytest.mark.parametrize("message,preference", [("동성 선호","same"),("동성만","only_same"),("성별 상관없어","any")])
def test_offline_parser_reads_gender_preference(message, preference):
    assert parse_text(message)["gender_preference"] == preference
