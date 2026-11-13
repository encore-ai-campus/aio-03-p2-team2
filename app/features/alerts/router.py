from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Header, Query, Request

from app.core.api import APIError, success
from app.core.config import get_settings
from app.core.schemas import AlertAnswer
from app.core.store import new_id, now_iso, store

router = APIRouter(prefix="/alerts", tags=["alerts"])
admin_router = APIRouter(prefix="/admin", tags=["admin"])


def require_demo(value: str | None) -> str:
    if not value or not store.user(value):
        raise APIError(400, "DEMO_USER_INVALID", "유효한 X-Demo-User-Id가 필요합니다.")
    return value


def require_development() -> None:
    if get_settings().app_env not in {"development", "local", "test"}:
        raise APIError(403, "ADMIN_DEVELOPMENT_ONLY", "관리자 수집 API는 개발 환경에서만 사용할 수 있습니다.")


def own_alert(alert_id: str, user_id: str) -> dict:
    alert = store.alerts.get(alert_id)
    if not alert:
        raise APIError(404, "ALERT_NOT_FOUND", "알림을 찾을 수 없습니다.")
    if alert["userId"] != user_id:
        raise APIError(403, "ALERT_FORBIDDEN", "본인에게 전달된 알림만 조회할 수 있습니다.")
    return alert


def public_alert(alert: dict) -> dict:
    item = dict(alert)
    item.pop("userId", None)
    return item


@router.get("/jobs/{job_id}", operation_id="getSyncJob")
def get_sync_job(job_id: str, request: Request):
    job = store.jobs.get(job_id)
    if not job:
        raise APIError(404, "SYNC_JOB_NOT_FOUND", "수집 작업을 찾을 수 없습니다.")
    return success(job, request)


@router.get("", operation_id="listAlerts")
def list_alerts(request: Request, status: str | None = None, type: str | None = None, page: int = Query(default=1, ge=1), page_size: int = Query(default=20, ge=1, le=100, alias="pageSize"), x_demo_user_id: str | None = Header(default=None)):
    user_id = require_demo(x_demo_user_id)
    items = [public_alert(item) for item in store.alerts.values() if item["userId"] == user_id and (not status or item["status"] == status) and (not type or item["type"] == type)]
    items.sort(key=lambda item: item["createdAt"], reverse=True)
    start = (page - 1) * page_size
    return success({"items": items[start : start + page_size], "page": page, "pageSize": page_size, "total": len(items)}, request)


@router.patch("/{alert_id}/read", operation_id="markAlertRead")
def mark_read(alert_id: str, request: Request, x_demo_user_id: str | None = Header(default=None)):
    user_id = require_demo(x_demo_user_id)
    alert = own_alert(alert_id, user_id)
    alert["status"] = "read"
    return success(public_alert(alert), request)


@router.post("/{alert_id}/answer", operation_id="answerAlert")
def answer_alert(alert_id: str, payload: AlertAnswer, request: Request, x_demo_user_id: str | None = Header(default=None)):
    user_id = require_demo(x_demo_user_id)
    alert = own_alert(alert_id, user_id)
    alert["status"] = "answered"
    alert["choice"] = payload.answer
    alert["answeredAt"] = now_iso()
    return success(public_alert(alert), request)


@router.get("/{alert_id}/alternatives", operation_id="getAlertAlternatives")
def alert_alternatives(alert_id: str, request: Request, limit: int = Query(default=5, ge=1, le=20), x_demo_user_id: str | None = Header(default=None)):
    user_id = require_demo(x_demo_user_id)
    alert = own_alert(alert_id, user_id)
    source = store.festivals.get(alert["festivalId"])
    if not source:
        return success({"items": []}, request)
    items = [item for item in store.festivals_view() if item["id"] != source["id"] and item["riskStatus"] != "cancelled" and (item["category"] == source["category"] or set(item.get("tags", [])) & set(source.get("tags", [])))]
    items.sort(key=lambda item: abs((date.fromisoformat(item["startDate"]) - date.fromisoformat(source["startDate"])).days))
    return success({"items": items[:limit]}, request)


@admin_router.post("/weather/sync", operation_id="syncWeatherAlerts")
def sync_weather(payload: dict, request: Request):
    require_development()
    job_id = new_id("job")
    store.jobs[job_id] = {"jobId": job_id, "status": "queued", "kind": "weather_sync", "acceptedAt": now_iso(), "request": payload}
    return success({"jobId": job_id}, request, status_code=202)


@admin_router.post("/festival-notices/sync", operation_id="syncFestivalNotices")
def sync_festival_notices(payload: dict, request: Request):
    require_development()
    job_id = new_id("job")
    store.jobs[job_id] = {"jobId": job_id, "status": "queued", "kind": "notice_sync", "acceptedAt": now_iso(), "request": payload}
    return success({"jobId": job_id}, request, status_code=202)
