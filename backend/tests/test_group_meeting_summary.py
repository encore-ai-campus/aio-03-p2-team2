import httpx
import pytest

from app.main import create_app
from tests.ephemeral_storage import EphemeralAgentStorage
from tests.test_agent_workflow import USER, seed, settings


@pytest.mark.asyncio
@pytest.mark.parametrize("empty", [False, True])
async def test_group_list_and_detail_expose_meeting_time_without_full_schedule(tmp_path, empty):
    repo, day = seed()
    group = await repo.create_group(USER, {"festivalId":"fst_demo_music", "title":"meeting summary",
        "postBody":"test", "joinMode":"approval", "capacity":4})
    saved = repo.store.groups[group["id"]]["schedule"]
    saved["items"] = [] if empty else [{"date":"2030-05-22", "time":"15:30", "endTime":"17:00", "label":"test"}]
    saved["current"] = None if empty else saved["items"][0]
    app = create_app(settings(tmp_path), repository=repo, agent_storage=EphemeralAgentStorage())
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            listing = await client.get("/api/v1/groups")
            detail = await client.get(f"/api/v1/groups/{group['id']}")
            assert listing.status_code == detail.status_code == 200
            for item in [listing.json()["data"]["items"][0], detail.json()["data"]]:
                assert item["date"] == (None if empty else "2030-05-22")
                assert item["startTime"] == (None if empty else "15:30")
                assert "schedule" not in item
