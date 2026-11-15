from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query, Request

from app.core.api import APIError, success
from app.core.auth import current_user_id, require_admin, require_current_user
from app.core.config import get_settings
from app.core.repositories import SupabaseRepository, get_repository
from .schemas import AlertAnswer

router = APIRouter(prefix="/alerts", tags=["alerts"], dependencies=[Depends(require_current_user)])
admin_router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


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
async def list_alerts(request: Request, status: str | None = None, type: str | None = None, page: int = Query(default=1, ge=1), page_size: int = Query(default=20, ge=1, le=100, alias="pageSize")):
    repository = get_repository(request)
    user_id = current_user_id(request)
    items = await repository.alerts(user_id, status, type)
    start = (page - 1) * page_size
    return success({"items": items[start : start + page_size], "page": page, "pageSize": page_size, "total": len(items)}, request)


@router.patch("/{alert_id}/read", operation_id="markAlertRead")
async def mark_read(alert_id: str, request: Request):
    repository = get_repository(request)
    user_id = current_user_id(request)
    await own_alert(alert_id, user_id, repository)
    alert = await repository.update_alert(alert_id, user_id, status="read")
    return success(alert, request)


@router.post("/{alert_id}/answer", operation_id="answerAlert")
async def answer_alert(alert_id: str, payload: AlertAnswer, request: Request):
    repository = get_repository(request)
    user_id = current_user_id(request)
    await own_alert(alert_id, user_id, repository)
    alert = await repository.update_alert(alert_id, user_id, choice=payload.answer)
    return success(alert, request)


@router.get("/{alert_id}/alternatives", operation_id="getAlertAlternatives")
async def alert_alternatives(alert_id: str, request: Request, limit: int = Query(default=5, ge=1, le=20)):
    repository = get_repository(request)
    user_id = current_user_id(request)
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
