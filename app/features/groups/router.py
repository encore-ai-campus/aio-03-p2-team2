from __future__ import annotations

from fastapi import APIRouter, Depends, Header, Query, Request, Response

from app.core.api import APIError, success
from app.core.auth import current_user_id, require_current_user
from app.core.repositories import RepositoryError, SupabaseRepository, get_repository
from app.core.service import ServiceError
from .schemas import CommentCreate, GroupCreate, GroupUpdate, JoinRequestCreate, RejectRequest, VersionRequest
from .service import GroupService

router = APIRouter(prefix="/groups", tags=["groups"])


async def get_group(group_id: str, repository: SupabaseRepository) -> dict:
    try:
        return await GroupService(repository).get(group_id)
    except ServiceError as error:
        raise APIError(error.status_code, error.code, error.message, error.details) from error


def require_leader(group: dict, user_id: str) -> None:
    try:
        GroupService.require_leader(group, user_id)
    except ServiceError as error:
        raise APIError(error.status_code, error.code, error.message, error.details) from error


def require_member(group: dict, user_id: str) -> None:
    try:
        GroupService.require_member(group, user_id)
    except ServiceError as error:
        raise APIError(error.status_code, error.code, error.message, error.details) from error


def repository_error(error: RepositoryError) -> APIError:
    return APIError(error.status_code, error.code, error.message, error.details)


@router.get("", operation_id="listGroups")
async def list_groups(request: Request, festival_id: str | None = Query(default=None, alias="festivalId"), status: str | None = None, keyword: str | None = None, page: int = Query(default=1, ge=1), page_size: int = Query(default=20, ge=1, le=100, alias="pageSize")):
    groups = await get_repository(request).list_groups(festival_id=festival_id, status=status, keyword=keyword)
    items = []
    for group in groups:
        item = dict(group)
        item.pop("members", None)
        item.pop("joinRequests", None)
        item.pop("comments", None)
        item.pop("schedule", None)
        item.pop("messages", None)
        items.append(item)
    start = (page - 1) * page_size
    return success({"items": items[start : start + page_size], "page": page, "pageSize": page_size, "total": len(items)}, request)


@router.post("", operation_id="createGroup", status_code=201, dependencies=[Depends(require_current_user)])
async def create_group(payload: GroupCreate, request: Request):
    repository = get_repository(request)
    user_id = current_user_id(request)
    try:
        group = await GroupService(repository).create(user_id, payload.model_dump(by_alias=True))
    except ServiceError as error:
        raise APIError(error.status_code, error.code, error.message, error.details) from error
    except RepositoryError as error:
        raise repository_error(error) from error
    return success(group, request, status_code=201)


@router.get("/{group_id}", operation_id="getGroup")
async def get_group_detail(group_id: str, request: Request):
    group = dict(await get_group(group_id, get_repository(request)))
    for key in ("joinRequests","schedule","messages"):
        group.pop(key,None)
    return success(group, request)


@router.patch("/{group_id}", operation_id="updateGroup", dependencies=[Depends(require_current_user)])
async def update_group(group_id: str, payload: GroupUpdate, request: Request, if_match: str | None = Header(default=None)):
    repository = get_repository(request)
    user_id = current_user_id(request)
    version = int(if_match.strip('"')) if if_match and if_match.strip('"').isdigit() else payload.version
    values = payload.model_dump(by_alias=True, exclude_none=True)
    try:
        updated = await GroupService(repository).update(group_id, user_id, values, version)
    except ServiceError as error:
        raise APIError(error.status_code, error.code, error.message, error.details) from error
    return success(updated, request)


@router.get("/{group_id}/comments", operation_id="listComments")
async def list_comments(group_id: str, request: Request, cursor: str | None = None, limit: int = Query(default=20, ge=1, le=100)):
    repository = get_repository(request)
    if not await repository.group(group_id, include_comments=False):
        raise APIError(404, "GROUP_NOT_FOUND", "모임을 찾을 수 없습니다.")
    start = int(cursor) if cursor and cursor.isdigit() else 0
    items, total = await repository.comments(group_id, offset=start, limit=limit)
    next_cursor = str(start + limit) if start + limit < total else None
    return success({"items": items, "nextCursor": next_cursor}, request)


@router.post("/{group_id}/comments", operation_id="createComment", status_code=201, dependencies=[Depends(require_current_user)])
async def create_comment(group_id: str, payload: CommentCreate, request: Request):
    repository = get_repository(request)
    user_id = current_user_id(request)
    await get_group(group_id, repository)
    try:
        comment = await repository.add_comment(group_id, user_id, payload.text)
    except RepositoryError as error:
        raise repository_error(error) from error
    return success(comment, request, status_code=201)


@router.delete("/{group_id}/comments/{comment_id}", operation_id="deleteComment", status_code=204, dependencies=[Depends(require_current_user)])
async def delete_comment(group_id: str, comment_id: str, request: Request):
    repository = get_repository(request)
    user_id = current_user_id(request)
    if not await repository.delete_comment(group_id, comment_id, user_id):
        raise APIError(404, "COMMENT_NOT_FOUND", "댓글을 찾을 수 없습니다.")
    return Response(status_code=204)


@router.get("/{group_id}/join-requests", operation_id="listJoinRequests", dependencies=[Depends(require_current_user)])
async def list_join_requests(group_id: str, request: Request, status: str | None = None, page: int = Query(default=1, ge=1), page_size: int = Query(default=20, ge=1, le=100, alias="pageSize")):
    repository = get_repository(request)
    user_id = current_user_id(request)
    group = await get_group(group_id, repository)
    require_leader(group, user_id)
    start = (page - 1) * page_size
    items, total = await repository.join_requests(group_id, status=status, offset=start, limit=page_size)
    return success({"items": items, "page": page, "pageSize": page_size, "total": total}, request)


@router.post("/{group_id}/join-requests", operation_id="createJoinRequest", status_code=201, dependencies=[Depends(require_current_user)])
async def create_join_request(group_id: str, payload: JoinRequestCreate, request: Request):
    repository = get_repository(request)
    user_id = current_user_id(request)
    try:
        result = await GroupService(repository).create_join_request(group_id, user_id, payload.message, payload.version)
    except RepositoryError as error:
        raise repository_error(error) from error
    if result["request"]:
        return success(result["request"], request, status_code=201)
    return success({"membership": result["membership"], "group": result["group"]}, request, status_code=201)


@router.post("/{group_id}/join-requests/{request_id}/approve", operation_id="approveJoinRequest", dependencies=[Depends(require_current_user)])
async def approve_join_request(group_id: str, request_id: str, payload: VersionRequest, request: Request, if_match: str | None = Header(default=None)):
    repository = get_repository(request)
    user_id = current_user_id(request)
    version = int(if_match.strip('"')) if if_match and if_match.strip('"').isdigit() else payload.version
    try:
        result = await GroupService(repository).approve_join_request(group_id, request_id, user_id, version)
    except RepositoryError as error:
        raise repository_error(error) from error
    return success({**result, "nextActions": [{"method": "POST", "path": f"{request.app.state.settings.api_prefix}/workflow/groups/{group_id}/schedule", "label": "참여자 조건으로 일정 생성"}]}, request)


@router.post("/{group_id}/join-requests/{request_id}/reject", operation_id="rejectJoinRequest", dependencies=[Depends(require_current_user)])
async def reject_join_request(group_id: str, request_id: str, payload: RejectRequest, request: Request):
    repository = get_repository(request)
    user_id = current_user_id(request)
    try:
        result = await GroupService(repository).reject_join_request(group_id, request_id, user_id, payload.version, payload.reason)
    except RepositoryError as error:
        raise repository_error(error) from error
    if not result:
        raise APIError(409, "JOIN_REQUEST_NOT_PENDING", "대기 중인 참여 신청이 아닙니다.")
    return success(result, request)


@router.delete("/{group_id}/membership", operation_id="leaveGroup", status_code=204, dependencies=[Depends(require_current_user)])
async def leave_group(group_id: str, request: Request):
    repository = get_repository(request)
    user_id = current_user_id(request)
    try:
        await GroupService(repository).leave(group_id, user_id)
    except RepositoryError as error:
        raise repository_error(error) from error
    return Response(status_code=204)
