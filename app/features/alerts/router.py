from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Header, Query, Request

from app.core.api import APIError, success
from app.core.config import get_settings
from app.core.repositories import SupabaseRepository, get_repository
from .schemas import AlertAnswer

router = APIRouter(prefix="/alerts", tags=["alerts"])
admin_router = APIRouter(prefix="/admin", tags=["admin"])


async def require_demo(value: str | None, repository: SupabaseRepository) -> str:
    if not value or not await repository.user(value):
        raise APIError(400, "DEMO_USER_INVALID", "유효한 X-Demo-User-Id가 필요합니다.")
    return value


def require_development() -> None:
    if get_settings().app_env not in {"development", "local", "test"}:
        raise APIError(403, "ADMIN_DEVELOPMENT_ONLY", "수집 API는 개발 환경에서만 사용할 수 있습니다.")


async def own_alert(alert_id: str, user_id: str, repository: SupabaseRepository) -> dict:
    alert = await repository.alert(alert_id, user_id)
    if not alert:
        raise APIError(404, "ALERT_NOT_FOUND", "알림을 찾을 수 없습니다.")
    return alert


@router.get("/jobs/{job_id}", operation_id="getSyncJob")
async def get_sync_job(job_id: str, request: Request):
    job = await get_repository(request).sync_job(job_id)
    if not job:
        raise APIError(404, "SYNC_JOB_NOT_FOUND", "수집 작업을 찾을 수 없습니다.")
    return success(job, request)


@router.get("", operation_id="listAlerts")
async def list_alerts(request: Request, status: str | None = None, type: str | None = None, page: int = Query(default=1, ge=1), page_size: int = Query(default=20, ge=1, le=100, alias="pageSize"), x_demo_user_id: str | None = Header(default=None)):
    repository = get_repository(request)
    user_id = await require_demo(x_demo_user_id, repository)
    items = await repository.alerts(user_id, status, type)
    start = (page - 1) * page_size
    return success({"items": items[start : start + page_size], "page": page, "pageSize": page_size, "total": len(items)}, request)


@router.patch("/{alert_id}/read", operation_id="markAlertRead")
async def mark_read(alert_id: str, request: Request, x_demo_user_id: str | None = Header(default=None)):
    repository = get_repository(request)
    user_id = await require_demo(x_demo_user_id, repository)
    await own_alert(alert_id, user_id, repository)
    alert = await repository.update_alert(alert_id, user_id, status="read")
    return success(alert, request)


@router.post("/{alert_id}/answer", operation_id="answerAlert")
async def answer_alert(alert_id: str, payload: AlertAnswer, request: Request, x_demo_user_id: str | None = Header(default=None)):
    repository = get_repository(request)
    user_id = await require_demo(x_demo_user_id, repository)
    await own_alert(alert_id, user_id, repository)
    alert = await repository.update_alert(alert_id, user_id, choice=payload.answer)
    return success(alert, request)


@router.get("/{alert_id}/alternatives", operation_id="getAlertAlternatives")
async def alert_alternatives(alert_id: str, request: Request, limit: int = Query(default=5, ge=1, le=20), x_demo_user_id: str | None = Header(default=None)):
    repository = get_repository(request)
    user_id = await require_demo(x_demo_user_id, repository)
    alert = await own_alert(alert_id, user_id, repository)
    source = await repository.festival(alert["festivalId"])
    if not source:
        return success({"items": []}, request)
    items = [item for item in await repository.festivals() if item["id"] != source["id"] and item["riskStatus"] != "cancelled" and (item["category"] == source["category"] or set(item.get("tags", [])) & set(source.get("tags", [])))]
    items.sort(key=lambda item: abs((date.fromisoformat(item["startDate"]) - date.fromisoformat(source["startDate"])).days))
    return success({"items": items[:limit]}, request)


@admin_router.post("/weather/sync", operation_id="syncWeatherAlerts")
async def sync_weather(payload: dict, request: Request):
    require_development()
    job = await get_repository(request).create_sync_job("weather_sync", payload)
    return success({"jobId": job["jobId"], "status": job["status"]}, request, status_code=202)


@admin_router.post("/festival-notices/sync", operation_id="syncFestivalNotices")
async def sync_festival_notices(payload: dict, request: Request):
    require_development()
    job = await get_repository(request).create_sync_job("notice_sync", payload)
    return success({"jobId": job["jobId"], "status": job["status"]}, request, status_code=202)
