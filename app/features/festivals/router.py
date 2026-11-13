from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Header, Query, Request

from app.core.api import APIError, success
from app.core.config import get_settings
from app.core.schemas import FestivalImportRequest
from app.core.store import new_id, now_iso, store

router = APIRouter(prefix="/festivals", tags=["festivals"])
admin_router = APIRouter(prefix="/admin", tags=["admin"])


def require_demo(x_demo_user_id: str | None) -> str:
    if not x_demo_user_id or not store.user(x_demo_user_id):
        raise APIError(400, "DEMO_USER_INVALID", "유효한 X-Demo-User-Id가 필요합니다.")
    return x_demo_user_id


def require_development() -> None:
    if get_settings().app_env not in {"development", "local", "test"}:
        raise APIError(403, "ADMIN_DEVELOPMENT_ONLY", "관리자 수집 API는 개발 환경에서만 사용할 수 있습니다.")


def available(festival: dict) -> bool:
    return festival["endDate"] >= date.today().isoformat() and festival["riskStatus"] != "cancelled"


def filtered_festivals(year, month, start_date, end_date, region, category, keyword, status):
    result = []
    for festival in store.festivals_view():
        start = date.fromisoformat(festival["startDate"])
        finish = date.fromisoformat(festival["endDate"])
        haystack = " ".join([festival["name"], festival["description"], *festival.get("tags", [])])
        if year is not None and start.year != year:
            continue
        if month is not None and start.month != month:
            continue
        if start_date and finish < start_date:
            continue
        if end_date and start > end_date:
            continue
        if region and region not in (festival["region"], festival["city"]):
            continue
        if category and category != festival["category"]:
            continue
        if keyword and keyword.lower() not in haystack.lower():
            continue
        if status == "available" and not available(festival):
            continue
        if status == "past" and finish >= date.today():
            continue
        result.append(festival)
    return sorted(result, key=lambda item: (item["startDate"], item["id"]))


@router.get("", operation_id="listFestivals")
def list_festivals(
    request: Request,
    year: int | None = None,
    month: int | None = Query(default=None, ge=1, le=12),
    start_date: date | None = Query(default=None, alias="startDate"),
    end_date: date | None = Query(default=None, alias="endDate"),
    region: str | None = None,
    category: str | None = None,
    keyword: str | None = None,
    status: str = Query(default="all", pattern="^(all|available|past)$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100, alias="pageSize"),
):
    items = filtered_festivals(year, month, start_date, end_date, region, category, keyword, status)
    offset = (page - 1) * page_size
    return success({"items": items[offset : offset + page_size], "page": page, "pageSize": page_size, "total": len(items)}, request)


@router.get("/calendar", operation_id="getFestivalCalendar")
def festival_calendar(request: Request, year: int, month: int = Query(ge=1, le=12), region: str | None = None, category: str | None = None, keyword: str | None = None):
    festivals = filtered_festivals(year, month, None, None, region, category, keyword, "all")
    events = []
    for festival in festivals:
        current = date.fromisoformat(festival["startDate"])
        finish = date.fromisoformat(festival["endDate"])
        while current <= finish:
            if current.year == year and current.month == month:
                events.append({"date": current.isoformat(), "festivalId": festival["id"], "name": festival["name"], "category": festival["category"], "status": festival["status"]})
            current += timedelta(days=1)
    return success({"year": year, "month": month, "events": events}, request)


@router.get("/{festival_id}", operation_id="getFestival")
def get_festival(festival_id: str, request: Request):
    festival = store.festival(festival_id)
    if not festival:
        raise APIError(404, "FESTIVAL_NOT_FOUND", "축제를 찾을 수 없습니다.")
    return success(festival, request)


@router.get("/{festival_id}/alternatives", operation_id="getFestivalAlternatives")
def alternatives(festival_id: str, request: Request, group_id: str | None = Query(default=None, alias="groupId"), limit: int = Query(default=5, ge=1, le=20), x_demo_user_id: str | None = Header(default=None)):
    require_demo(x_demo_user_id)
    source = store.festival(festival_id)
    if not source:
        raise APIError(404, "FESTIVAL_NOT_FOUND", "축제를 찾을 수 없습니다.")
    items = [item for item in store.festivals_view() if item["id"] != festival_id and available(item) and (item["category"] == source["category"] or set(item.get("tags", [])) & set(source.get("tags", [])))]
    items.sort(key=lambda item: abs((date.fromisoformat(item["startDate"]) - date.fromisoformat(source["startDate"])).days))
    return success({"items": items[:limit]}, request)


@admin_router.post("/festivals/sync", operation_id="syncFestivals")
def sync_festivals(payload: dict, request: Request):
    require_development()
    job_id = new_id("job")
    store.jobs[job_id] = {"jobId": job_id, "status": "queued", "kind": "festival_sync", "acceptedAt": now_iso(), "request": payload}
    return success({"jobId": job_id, "status": "queued"}, request, status_code=202)


@admin_router.post("/festivals/import", operation_id="importFestivals")
def import_festivals(payload: FestivalImportRequest, request: Request):
    require_development()
    accepted = 0
    rejected = 0
    with store.lock:
        for item in payload.festivals:
            if item.end_date < item.start_date:
                rejected += 1
                continue
            data = item.model_dump(by_alias=True, mode="json", exclude_none=True)
            data["id"] = data.get("id") or new_id("fst")
            data["sourceUpdatedAt"] = now_iso()
            store.add_festival(data)
            accepted += 1
    job_id = new_id("job")
    store.jobs[job_id] = {"jobId": job_id, "status": "queued", "kind": "festival_import", "acceptedAt": now_iso()}
    return success({"jobId": job_id, "accepted": accepted, "rejected": rejected}, request, status_code=202)
