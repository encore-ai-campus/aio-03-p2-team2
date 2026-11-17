from datetime import date, timedelta

import httpx
import pytest

from app.main import create_app
from tests.auth_helpers import install_test_identity, token_headers
from tests.ephemeral_storage import EphemeralAgentStorage
from tests.test_agent_workflow import USER, settings
from tests.test_agent_matching_parity import repository


@pytest.mark.asyncio
@pytest.mark.parametrize("invalid", [False, True])
async def test_direct_matching_and_recruitment_keep_selected_date_and_time(tmp_path, invalid):
    repo, first = repository()
    second = (date.fromisoformat(first) + timedelta(days=1)).isoformat()
    repo.store.festivals["fst_demo_music"]["endDate"] = second
    day = (date.fromisoformat(second) + timedelta(days=1)).isoformat() if invalid else second
    app = create_app(settings(tmp_path), repository=repo, agent_storage=EphemeralAgentStorage())
    install_test_identity(app, repo)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            headers = token_headers(USER)
            response = await client.post("/api/v1/matching/runs", headers=headers, json={
                "festivalId": "fst_demo_music", "conditions": {"date":day,"startTime":"15:30","partySize":4}})
            assert response.status_code == (422 if invalid else 201)
            response = await client.post("/api/v1/groups", headers=headers, json={
                "festivalId":"fst_demo_music","title":"date contract","postBody":"test","capacity":4,
                "joinMode":"instant","date":day,"startTime":"15:30"})
            assert response.status_code == (422 if invalid else 201)
            if not invalid:
                group = response.json()["data"]
                assert group["schedule"]["current"]["date"] == second
                assert group["schedule"]["current"]["time"] == "15:30"
                assert group["joinMode"] == "instant"
            else:
                assert not repo.store.groups
