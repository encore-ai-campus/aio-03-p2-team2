import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from pydantic import ValidationError

from app.features.festivals.repository import FestivalRepositoryMixin
from app.features.festivals.schemas import FestivalSyncRequest
from app.features.sync.worker import ExternalSyncWorker
from tests.test_external_sync_worker import FakeSyncRepository, job, settings
from tests.auth_helpers import install_test_identity, token_headers
from tests.ephemeral_storage import EphemeralAgentStorage
from tests.test_agent_workflow import seed, settings as app_settings
from app.main import create_app


def db_row(params, rejections=None):
    return {"id":"job_1", "kind":"festival_sync", "status":"queued", "params":params,
        "accepted":None, "rejected":None, "rejections":rejections, "error":None,
        "created_at":None, "started_at":None, "finished_at":None,
        "attempts":0, "max_attempts":3, "next_attempt_at":None, "locked_at":None, "worker_id":None}


@pytest.mark.parametrize("encoded", [False, True])
@pytest.mark.asyncio
async def test_real_job_mapping_decodes_jsonb_before_worker_uses_params(encoded):
    params = {"startDate":"2026-11-17", "endDate":"2026-12-31", "pageSize":1, "maxPages":1}
    row = db_row(json.dumps(params) if encoded else params, "[]" if encoded else [])
    mapped = FestivalRepositoryMixin._job_view(row)
    assert mapped["params"] == params
    assert mapped["rejections"] == []
    repository = FakeSyncRepository({**job("festival_sync"), **mapped})
    def respond(request):
        assert request.url.params["eventEndDate"] == "20261231"
        return httpx.Response(200, json={"response":{"header":{"resultCode":"0000"},
            "body":{"totalCount":0,"items":""}}})
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as http:
        worker = ExternalSyncWorker(repository, settings(), http_client=http)
        assert await worker.run_once()
    assert repository.jobs["job_1"]["status"] == "succeeded"


@pytest.mark.asyncio
async def test_invalid_stored_params_fail_without_repeated_attribute_errors():
    repository = FakeSyncRepository(job("festival_sync", ["invalid"]))
    async with httpx.AsyncClient() as http:
        worker = ExternalSyncWorker(repository, settings(), http_client=http)
        assert await worker.run_once()
    assert repository.jobs["job_1"]["status"] == "failed"
    assert repository.jobs["job_1"]["error"].startswith("SYNC_JOB_INVALID:")


@pytest.mark.asyncio
async def test_targeted_once_only_claims_requested_job():
    repository = SimpleNamespace(claim_next_sync_job=AsyncMock(return_value=None),
        requeue_stale_sync_jobs=AsyncMock())
    async with httpx.AsyncClient() as http:
        worker = ExternalSyncWorker(repository, settings(), http_client=http)
        assert await worker.run_once(job_id="job_requested") is False
    assert repository.claim_next_sync_job.call_args.kwargs["job_id"] == "job_requested"
    repository.requeue_stale_sync_jobs.assert_not_awaited()


@pytest.mark.parametrize("field", ["areaCode", "sigunguCode"])
def test_sync_api_rejects_swagger_placeholder_region_values(field):
    with pytest.raises(ValidationError):
        FestivalSyncRequest.model_validate({field:"string"})
    assert FestivalSyncRequest.model_validate({field:"1"}).model_dump(by_alias=True)[field] == "1"


@pytest.mark.asyncio
@pytest.mark.parametrize("params", ["not-json", "[]", [], 0])
async def test_invalid_database_params_are_not_replaced_with_default_search(params):
    mapped = FestivalRepositoryMixin._job_view(db_row(params))
    repository = FakeSyncRepository({**job("festival_sync"), **mapped})
    async with httpx.AsyncClient() as http:
        worker = ExternalSyncWorker(repository, settings(), http_client=http)
        await worker.run_once()
    assert repository.jobs["job_1"]["status"] == "failed"
    assert repository.jobs["job_1"]["error"].startswith("SYNC_JOB_INVALID:")


@pytest.mark.asyncio
async def test_admin_job_status_and_legacy_route_keep_authentication_and_json_shape(tmp_path):
    repo, _ = seed()
    async def sync_job(job_id):
        return FestivalRepositoryMixin._job_view(db_row('{"pageSize":1}', "[]")) if job_id == "job_1" else None
    repo.sync_job = sync_job
    app = create_app(app_settings(tmp_path), repository=repo, agent_storage=EphemeralAgentStorage())
    install_test_identity(app, repo)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            path = "/api/v1/admin/jobs/job_1"
            assert (await client.get(path)).status_code == 401
            assert (await client.get(path, headers=token_headers())).status_code == 403
            response = await client.get(path, headers=token_headers(app_metadata={"role":"admin"}))
            assert response.status_code == 200
            assert response.json()["data"]["params"] == {"pageSize":1}
            assert response.json()["data"]["rejections"] == []
            assert (await client.get("/api/v1/alerts/jobs/job_1", headers=token_headers())).status_code == 200
            assert (await client.get("/api/v1/admin/jobs/missing", headers=token_headers(app_metadata={"role":"admin"}))).status_code == 404
