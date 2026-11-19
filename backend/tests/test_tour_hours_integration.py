import httpx
import pytest

from app.features.agents.schemas import Conditions, ResumeRun, RunStart
from app.features.festivals.repository import FestivalRepositoryMixin
from app.features.sync.providers import tour_item_to_festival
from app.features.sync.worker import ExternalSyncWorker
from tests.test_agent_workflow import USER, running
from tests.test_connected_workflow import ConnectionContext
from tests.test_external_sync_worker import settings as sync_settings
from tests.test_tour_api import item, payload


@pytest.mark.asyncio
async def test_detailed_sync_connects_to_real_schedule_graph_and_approval(running):
    agents, repo, _, day = running
    def respond(request):
        if request.url.path.endswith("searchFestival2"):
            return httpx.Response(200, json=payload({**item(), "eventstartdate":day.replace("-", ""),
                "eventenddate":day.replace("-", "")}))
        if request.url.path.endswith("detailCommon2"):
            return httpx.Response(200, json=payload({"contentid":"123", "overview":"details"}))
        return httpx.Response(200, json=payload({"contentid":"123", "playtime":"10:00~18:00"}))
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        worker = ExternalSyncWorker(repo, sync_settings(), http_client=client)
        result = await worker._sync_festivals({"startDate":day, "endDate":day, "includeDetails":True})
    assert result["accepted"] == 1
    festival = await repo.festival("fst_tour_123")
    assert festival["operatingHours"] == [{"date":day, "open":"10:00", "close":"18:00"}]
    group = await repo.create_group(USER, {"festivalId":festival["id"], "title":"test", "postBody":"test",
        "capacity":4, "joinMode":"approval", "conditions":{"date":day, "start_time":"15:00"}})
    run = await agents.start(USER, RunStart(message="일정 생성", intent="scheduling", group_id=group["id"],
        conditions=Conditions(date=day, start_time="15:00")))
    assert run["status"] == "waiting_approval"
    assert not run["errors"]
    run = await agents.resume(USER, run["runId"], ResumeRun(checkpoint_id=run["checkpointId"], decision="approve"))
    assert run["status"] == "completed"


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["known", "unknown", "legacy"])
async def test_database_upsert_preserves_confirmed_hours_when_tour_hours_unknown(mode):
    calls = []
    class Pool:
        def acquire(self): return ConnectionContext(self)
        def transaction(self): return ConnectionContext(self)
        async def execute(self, sql, *args): calls.append((sql, args))
    class Repository(FestivalRepositoryMixin):
        def _pool(self): return pool
        async def festival(self, festival_id): return {"id":festival_id}
    pool = Pool()
    row = tour_item_to_festival({**item(), "playtime":"10:00~18:00" if mode == "known" else "일별 상이"})
    if mode == "legacy":
        row.pop("operatingHoursKnown")
    await Repository(None).upsert_festival(row)
    deleted = any("delete from festival_operating_hours" in sql for sql, _ in calls)
    inserts = [(sql, args) for sql, args in calls if "insert into festival_operating_hours" in sql]
    assert deleted is (mode != "unknown")
    assert len(inserts) == (2 if mode == "known" else 0)
