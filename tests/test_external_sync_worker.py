from __future__ import annotations

import json

import httpx
import pytest

from app.core.config import Settings
from app.features.sync.worker import ExternalSyncWorker


class FakeSyncRepository:
    def __init__(self, job: dict):
        self.jobs = {job["jobId"]: job}
        self.festivals_by_id: dict[str, dict] = {}
        self.upserted: list[dict] = []
        self.weather: list[tuple[str, dict]] = []

    async def requeue_stale_sync_jobs(self, lease_seconds: int) -> int:
        return 0

    async def claim_next_sync_job(self, worker_id: str, *, lease_seconds: int, max_attempts: int):
        for job in self.jobs.values():
            if job["status"] == "queued":
                job["status"] = "running"
                job["attempts"] += 1
                job["maxAttempts"] = min(job["maxAttempts"], max_attempts)
                job["workerId"] = worker_id
                return dict(job)
        return None

    async def update_sync_job(self, job_id: str, **values):
        self.jobs[job_id].update(values)
        return dict(self.jobs[job_id])

    async def upsert_festival(self, data: dict):
        self.upserted.append(data)
        self.festivals_by_id[data["id"]] = data

    async def festival(self, festival_id: str):
        return self.festivals_by_id.get(festival_id)

    async def festivals(self, **kwargs):
        return list(self.festivals_by_id.values())

    async def upsert_weather_forecast(self, festival_id: str, forecast: dict):
        self.weather.append((festival_id, forecast))


def settings(**overrides) -> Settings:
    return Settings(
        _env_file=None,
        app_env="test",
        tour_api_service_key="test-service-key",
        external_sync_poll_interval=0.1,
        external_sync_retry_base_seconds=0.1,
        **overrides,
    )


def job(kind: str, params: dict | None = None, *, max_attempts: int = 3) -> dict:
    return {
        "jobId": "job_1",
        "kind": kind,
        "params": params or {},
        "status": "queued",
        "attempts": 0,
        "maxAttempts": max_attempts,
    }


@pytest.mark.asyncio
async def test_festival_worker_calls_tour_api_maps_and_upserts():
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            200,
            json={
                "response": {
                    "header": {"resultCode": "0000"},
                    "body": {
                        "totalCount": 1,
                        "items": {
                            "item": [
                                {
                                    "contentid": "123",
                                    "title": "Test Festival",
                                    "eventstartdate": "20261120",
                                    "eventenddate": "20261121",
                                    "addr1": "Seoul",
                                    "addr2": "Jongno",
                                    "mapx": "126.98",
                                    "mapy": "37.57",
                                }
                            ]
                        },
                    },
                }
            },
        )

    repository = FakeSyncRepository(job("festival_sync", {"startDate": "2026-11-01", "endDate": "2026-11-30"}))
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        worker = ExternalSyncWorker(repository, settings(), http_client=client, worker_id="worker_test")
        assert await worker.run_once() is True

    assert repository.jobs["job_1"]["status"] == "succeeded"
    assert repository.jobs["job_1"]["accepted"] == 1
    assert repository.upserted[0]["id"] == "fst_tour_123"
    assert repository.upserted[0]["venue"]["latitude"] == 37.57
    assert requests[0].url.params["eventStartDate"] == "20261101"
    assert requests[0].url.params["eventEndDate"] == "20261130"


@pytest.mark.asyncio
async def test_worker_accepts_json_encoded_job_params():
    repository = FakeSyncRepository(job("festival_sync", {"startDate": "2026-11-01", "endDate": "2026-11-30"}))
    repository.jobs["job_1"]["params"] = json.dumps(repository.jobs["job_1"]["params"])

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "response": {
                    "header": {"resultCode": "0000"},
                    "body": {"totalCount": 0, "items": {"item": []}},
                }
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        worker = ExternalSyncWorker(repository, settings(), http_client=client)
        assert await worker.run_once() is True

    assert repository.jobs["job_1"]["status"] == "succeeded"


@pytest.mark.asyncio
async def test_transient_tour_api_failure_is_requeued():
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(503, text="temporarily unavailable")

    repository = FakeSyncRepository(job("festival_sync", max_attempts=2))
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        worker = ExternalSyncWorker(repository, settings(), http_client=client)
        assert await worker.run_once() is True

    failed_job = repository.jobs["job_1"]
    assert calls == 1
    assert failed_job["status"] == "queued"
    assert failed_job["error"].startswith("TOUR_API_UNAVAILABLE:")


@pytest.mark.asyncio
async def test_weather_worker_calls_open_meteo_and_persists_forecast():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "daily": {
                    "time": ["2026-11-20"],
                    "precipitation_probability_max": [80],
                    "weather_code": [63],
                }
            },
        )

    repository = FakeSyncRepository(job("weather_sync", {"date": "2026-11-20"}))
    repository.festivals_by_id["fst_tour_123"] = {
        "id": "fst_tour_123",
        "venue": {"latitude": 37.57, "longitude": 126.98},
    }
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        worker = ExternalSyncWorker(repository, settings(), http_client=client)
        assert await worker.run_once() is True

    assert repository.jobs["job_1"]["status"] == "succeeded"
    assert repository.weather == [("fst_tour_123", {"date": "2026-11-20", "precipitationProbability": 80, "weatherCode": 63})]

