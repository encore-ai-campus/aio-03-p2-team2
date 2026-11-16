from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query, Request

from app.core.api import APIError, success
from app.core.auth import current_user_id, require_admin, require_current_user
from app.core.config import get_settings
from app.core.repositories import get_repository
from app.core.service import ServiceError
from .schemas import FestivalImportRequest
from .service import FestivalService, available

router = APIRouter(prefix="/festivals", tags=["festivals"])
admin_router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


def require_development() -> None:
    if get_settings().app_env not in {"development", "local", "test"}:
        raise APIError(403, "ADMIN_DEVELOPMENT_ONLY", "수집 API는 개발 환경에서만 사용할 수 있습니다.")


def service_error(error: ServiceError) -> APIError:
    return APIError(error.status_code, error.code, error.message, error.details)


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
    calendar = await FestivalService(repository).calendar(year, month, region=region, category=category, keyword=keyword)
    return success(calendar, request)


@router.get("/{festival_id}", operation_id="getFestival")
async def get_festival(festival_id: str, request: Request):
    festival = await get_repository(request).festival(festival_id)
    if not festival:
        raise APIError(404, "FESTIVAL_NOT_FOUND", "축제를 찾을 수 없습니다.")
    return success(festival, request)


@router.get("/{festival_id}/alternatives", operation_id="getFestivalAlternatives")
async def alternatives(festival_id: str, request: Request, group_id: str | None = Query(default=None, alias="groupId"), limit: int = Query(default=5, ge=1, le=20), _auth: object = Depends(require_current_user)):
    repository = get_repository(request)
    current_user_id(request)
    try:
        items = await FestivalService(repository).alternatives(festival_id, limit)
    except ServiceError as error:
        raise service_error(error) from error
    return success({"items": items}, request)


@admin_router.post("/festivals/sync", operation_id="syncFestivals")
async def sync_festivals(payload: dict, request: Request):
    require_development()
    job = await get_repository(request).create_sync_job("festival_sync", payload)
    return success({"jobId": job["jobId"], "status": job["status"]}, request, status_code=202)


@admin_router.post("/festivals/import", operation_id="importFestivals")
async def import_festivals(payload: FestivalImportRequest, request: Request):
    require_development()
    repository = get_repository(request)
    result = await FestivalService(repository).import_festivals(payload)
    return success(result, request, status_code=202)
