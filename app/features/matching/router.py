from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request

from app.core.api import APIError, success
from app.core.auth import current_user_id, require_current_user
from app.core.service import ServiceError
from app.core.repositories import get_repository
from .schemas import MatchingParseRequest, MatchingRunRequest
from .service import MatchingService, candidate, parse_slots

router = APIRouter(prefix="/matching", tags=["matching"], dependencies=[Depends(require_current_user)])


def service_error(error: ServiceError) -> APIError:
    return APIError(error.status_code, error.code, error.message, error.details)


@router.post("/parse", operation_id="parseMatchingText")
async def parse_matching(payload: MatchingParseRequest, request: Request):
    repository = get_repository(request)
    current_user_id(request)
    return success(await MatchingService(repository).parse(payload.text), request)


@router.post("/runs", operation_id="createMatchingRun", status_code=201)
async def create_run(payload: MatchingRunRequest, request: Request):
    repository = get_repository(request)
    user_id = current_user_id(request)
    try:
        result = await MatchingService(repository).create_run(user_id, payload)
    except ServiceError as error:
        raise service_error(error) from error
    return success(result, request, status_code=201)


@router.get("/runs/{run_id}", operation_id="getMatchingRun")
async def get_run(run_id: str, request: Request):
    repository = get_repository(request)
    user_id = current_user_id(request)
    run = await repository.matching_run(run_id, user_id)
    if not run:
        raise APIError(404, "MATCHING_RUN_NOT_FOUND", "매칭 실행을 찾을 수 없습니다.")
    return success(run, request)


@router.get("/runs/{run_id}/candidates", operation_id="listMatchingCandidates")
async def list_candidates(run_id: str, request: Request, page: int = Query(default=1, ge=1), page_size: int = Query(default=20, ge=1, le=100, alias="pageSize")):
    repository = get_repository(request)
    user_id = current_user_id(request)
    if not await repository.matching_run_exists(run_id, user_id):
        raise APIError(404, "MATCHING_RUN_NOT_FOUND", "매칭 실행을 찾을 수 없습니다.")
    start = (page - 1) * page_size
    items, total = await repository.matching_candidates(run_id, user_id, offset=start, limit=page_size)
    return success({"items": items, "page": page, "pageSize": page_size, "total": total}, request)
