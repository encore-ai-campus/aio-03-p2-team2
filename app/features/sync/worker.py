from __future__ import annotations

import asyncio
import json
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

import httpx

from app.core.config import Settings
from .providers import OpenMeteoClient, SyncProviderError, TourAPIClient


logger = logging.getLogger(__name__)


class ExternalSyncWorker:
    """Consumes external_sync_runs and executes provider-backed jobs."""

    def __init__(
        self,
        repository,
        settings: Settings,
        *,
        http_client: httpx.AsyncClient | None = None,
        worker_id: str | None = None,
    ) -> None:
        self.repository = repository
        self.settings = settings
        self.worker_id = worker_id or f"sync_{uuid4().hex}"
        self.http = http_client or httpx.AsyncClient(timeout=settings.external_sync_http_timeout, follow_redirects=False)
        self.owns_http = http_client is None
        key = settings.tour_api_service_key.get_secret_value() if settings.tour_api_service_key else None
        self.tour_api = TourAPIClient(key, http_client=self.http, timeout=settings.external_sync_http_timeout)
        self.weather_api = OpenMeteoClient(http_client=self.http, timeout=settings.external_sync_http_timeout)

    async def close(self) -> None:
        if self.owns_http:
            await self.http.aclose()

    async def run_once(self) -> bool:
        await self.repository.requeue_stale_sync_jobs(self.settings.external_sync_lease_seconds)
        job = await self.repository.claim_next_sync_job(
            self.worker_id,
            lease_seconds=self.settings.external_sync_lease_seconds,
            max_attempts=self.settings.external_sync_max_attempts,
        )
        if not job:
            return False
        try:
            result = await self._run_job(job)
        except SyncProviderError as exc:
            await self._handle_failure(job, exc.code, exc.message, retryable=exc.retryable)
        except Exception as exc:  # pragma: no cover - defensive boundary for production worker
            logger.exception("External sync job failed: %s", job["jobId"])
            await self._handle_failure(job, "SYNC_WORKER_ERROR", str(exc), retryable=True)
        else:
            await self.repository.update_sync_job(
                job["jobId"],
                status="succeeded",
                accepted=result.get("accepted", 0),
                rejected=result.get("rejected", 0),
                rejections=result.get("rejections", []),
                error=None,
                next_attempt_at=None,
                locked_at=None,
                worker_id=None,
                finished_at="now()",
            )
        return True

    async def run_forever(self, stop_event: asyncio.Event | None = None) -> None:
        stop_event = stop_event or asyncio.Event()
        while not stop_event.is_set():
            processed = await self.run_once()
            if processed:
                continue
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=self.settings.external_sync_poll_interval)
            except asyncio.TimeoutError:
                pass

    async def _run_job(self, job: dict[str, Any]) -> dict[str, Any]:
        kind = job.get("kind")
        params = job.get("params") or {}
        if isinstance(params, (str, bytes, bytearray)):
            try:
                params = json.loads(params)
            except (TypeError, ValueError) as exc:
                raise SyncProviderError("SYNC_JOB_INVALID", "Sync job params must be a JSON object") from exc
        if not isinstance(params, dict):
            raise SyncProviderError("SYNC_JOB_INVALID", "Sync job params must be a JSON object")
        if kind == "festival_sync":
            return await self._sync_festivals(params)
        if kind == "weather_sync":
            return await self._sync_weather(params)
        raise SyncProviderError("SYNC_KIND_UNSUPPORTED", f"Unsupported sync job kind: {kind}")

    async def _sync_festivals(self, params: dict[str, Any]) -> dict[str, Any]:
        rows = await self.tour_api.fetch_festivals(params)
        accepted = 0
        rejected = 0
        rejections: list[dict[str, Any]] = []
        for index, row in enumerate(rows):
            try:
                await self.repository.upsert_festival(row)
                accepted += 1
            except (KeyError, TypeError, ValueError) as exc:
                rejected += 1
                rejections.append({"index": index, "reason": str(exc)})
        return {"accepted": accepted, "rejected": rejected, "rejections": rejections}

    async def _sync_weather(self, params: dict[str, Any]) -> dict[str, Any]:
        target_day = params.get("date") or date.today().isoformat()
        try:
            target_day = date.fromisoformat(target_day).isoformat()
        except (TypeError, ValueError) as exc:
            raise SyncProviderError("SYNC_PARAMETER_INVALID", "date must be YYYY-MM-DD") from exc
        festival_id = params.get("festivalId")
        if festival_id:
            festival = await self.repository.festival(str(festival_id))
            festivals = [festival] if festival else []
        else:
            start_date = params.get("startDate")
            end_date = params.get("endDate")
            try:
                start = date.fromisoformat(start_date) if start_date else None
                end = date.fromisoformat(end_date) if end_date else None
            except (TypeError, ValueError) as exc:
                raise SyncProviderError("SYNC_PARAMETER_INVALID", "startDate and endDate must be YYYY-MM-DD") from exc
            festivals = await self.repository.festivals(start_date=start, end_date=end, status="all")

        accepted = 0
        rejected = 0
        rejections: list[dict[str, Any]] = []
        for festival in festivals:
            if not festival:
                rejected += 1
                rejections.append({"festivalId": festival_id, "reason": "festival not found"})
                continue
            venue = festival.get("venue") or {}
            if venue.get("latitude") is None or venue.get("longitude") is None:
                rejected += 1
                rejections.append({"festivalId": festival.get("id"), "reason": "venue coordinates are missing"})
                continue
            try:
                forecast = await self.weather_api.fetch_daily(float(venue["latitude"]), float(venue["longitude"]), target_day)
                await self.repository.upsert_weather_forecast(festival["id"], forecast)
                accepted += 1
            except (KeyError, TypeError, ValueError, SyncProviderError) as exc:
                if isinstance(exc, SyncProviderError):
                    raise
                rejected += 1
                rejections.append({"festivalId": festival.get("id"), "reason": str(exc)})
        return {"accepted": accepted, "rejected": rejected, "rejections": rejections}

    async def _handle_failure(self, job: dict[str, Any], code: str, message: str, *, retryable: bool) -> None:
        attempts = int(job.get("attempts") or 1)
        max_attempts = int(job.get("maxAttempts") or self.settings.external_sync_max_attempts)
        should_retry = retryable and attempts < max_attempts
        if should_retry:
            delay = self.settings.external_sync_retry_base_seconds * (2 ** max(attempts - 1, 0))
            await self.repository.update_sync_job(
                job["jobId"],
                status="queued",
                error=f"{code}: {message} (attempt {attempts})",
                next_attempt_at=datetime.now(timezone.utc) + timedelta(seconds=delay),
                locked_at=None,
                worker_id=None,
                finished_at=None,
            )
        else:
            await self.repository.update_sync_job(
                job["jobId"],
                status="failed",
                error=f"{code}: {message} (attempt {attempts})",
                locked_at=None,
                worker_id=None,
                finished_at="now()",
            )

