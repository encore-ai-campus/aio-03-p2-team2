from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Header, Query, Request

from app.core.api import APIError, success
from app.core.config import get_settings
from app.core.repositories import SupabaseRepository, get_repository
from .schemas import FestivalImportRequest

router = APIRouter(prefix="/festivals", tags=["festivals"])
admin_router = APIRouter(prefix="/admin", tags=["admin"])


async def require_demo(value: str | None, repository: SupabaseRepository) -> str:
    if not value or not await repository.user(value):
        raise APIError(400, "DEMO_USER_INVALID", "유효한 X-Demo-User-Id가 필요합니다.")
    return value


def require_development() -> None:
    if get_settings().app_env not in {"development", "local", "test"}:
        raise APIError(403, "ADMIN_DEVELOPMENT_ONLY", "수집 API는 개발 환경에서만 사용할 수 있습니다.")


def available(festival: dict) -> bool:
    return festival["endDate"] >= date.today().isoformat() and festival["riskStatus"] != "cancelled"


@router.get("", operation_id="listFestivals")
async def list_festivals(
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
    repository = get_repository(request)
    items = await repository.festivals(year=year, month=month, start_date=start_date, end_date=end_date, region=region, category=category, keyword=keyword, status=status)
    offset = (page - 1) * page_size
    return success({"items": items[offset : offset + page_size], "page": page, "pageSize": page_size, "total": len(items)}, request)


@router.get("/calendar", operation_id="getFestivalCalendar")
async def festival_calendar(request: Request, year: int, month: int = Query(ge=1, le=12), region: str | None = None, category: str | None = None, keyword: str | None = None):
    repository = get_repository(request)
    festivals = await repository.festivals(year=year, month=month, region=region, category=category, keyword=keyword)
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
async def get_festival(festival_id: str, request: Request):
    festival = await get_repository(request).festival(festival_id)
    if not festival:
        raise APIError(404, "FESTIVAL_NOT_FOUND", "축제를 찾을 수 없습니다.")
    return success(festival, request)


@router.get("/{festival_id}/alternatives", operation_id="getFestivalAlternatives")
async def alternatives(festival_id: str, request: Request, group_id: str | None = Query(default=None, alias="groupId"), limit: int = Query(default=5, ge=1, le=20), x_demo_user_id: str | None = Header(default=None)):
    repository = get_repository(request)
    await require_demo(x_demo_user_id, repository)
    source = await repository.festival(festival_id)
    if not source:
        raise APIError(404, "FESTIVAL_NOT_FOUND", "축제를 찾을 수 없습니다.")
    items = [item for item in await repository.festivals() if item["id"] != festival_id and available(item) and (item["category"] == source["category"] or set(item.get("tags", [])) & set(source.get("tags", [])))]
    items.sort(key=lambda item: abs((date.fromisoformat(item["startDate"]) - date.fromisoformat(source["startDate"])).days))
    return success({"items": items[:limit]}, request)


@admin_router.post("/festivals/sync", operation_id="syncFestivals")
async def sync_festivals(payload: dict, request: Request):
    require_development()
    job = await get_repository(request).create_sync_job("festival_sync", payload)
    return success({"jobId": job["jobId"], "status": job["status"]}, request, status_code=202)


@admin_router.post("/festivals/import", operation_id="importFestivals")
async def import_festivals(payload: FestivalImportRequest, request: Request):
    require_development()
    repository = get_repository(request)
    job = await repository.create_sync_job("festival_import", {"count": len(payload.festivals)})
    accepted = 0
    rejected = 0
    rejections = []
    for index, item in enumerate(payload.festivals):
        if item.end_date < item.start_date:
            rejected += 1
            rejections.append({"index": index, "reason": "endDate must be on or after startDate"})
            continue
        await repository.upsert_festival(item.model_dump(by_alias=True, mode="json", exclude_none=True))
        accepted += 1
    await repository.update_sync_job(job["jobId"], status="succeeded", accepted=accepted, rejected=rejected, rejections=rejections, finished_at="now()")
    return success({"jobId": job["jobId"], "accepted": accepted, "rejected": rejected}, request, status_code=202)
