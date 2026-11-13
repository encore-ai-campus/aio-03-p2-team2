from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Header, Query, Request, Response

from app.core.api import APIError, success
from app.core.repositories import RepositoryError, SupabaseRepository, get_repository
from .schemas import CommentCreate, GroupCreate, GroupUpdate, JoinRequestCreate, RejectRequest, VersionRequest

router = APIRouter(prefix="/groups", tags=["groups"])


async def require_demo(value: str | None, repository: SupabaseRepository) -> str:
    if not value or not await repository.user(value):
        raise APIError(400, "DEMO_USER_INVALID", "유효한 X-Demo-User-Id가 필요합니다.")
    return value


async def get_group(group_id: str, repository: SupabaseRepository) -> dict:
    group = await repository.group(group_id)
    if not group:
        raise APIError(404, "GROUP_NOT_FOUND", "모임을 찾을 수 없습니다.")
    return group


def require_leader(group: dict, user_id: str) -> None:
    if group["leaderId"] != user_id:
        raise APIError(403, "LEADER_ONLY", "모임장만 수행할 수 있습니다.")


def require_member(group: dict, user_id: str) -> None:
    if not any(item["userId"] == user_id for item in group["members"]):
        raise APIError(403, "GROUP_MEMBER_ONLY", "모임 참여자만 수행할 수 있습니다.")


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
        items.append(item)
    start = (page - 1) * page_size
    return success({"items": items[start : start + page_size], "page": page, "pageSize": page_size, "total": len(items)}, request)


@router.post("", operation_id="createGroup", status_code=201)
async def create_group(payload: GroupCreate, request: Request, x_demo_user_id: str | None = Header(default=None)):
    repository = get_repository(request)
    user_id = await require_demo(x_demo_user_id, repository)
    festival = await repository.festival(payload.festival_id)
    if not festival or festival["riskStatus"] == "cancelled" or festival["endDate"] < date.today().isoformat():
        raise APIError(422, "FESTIVAL_NOT_AVAILABLE", "종료되었거나 이용할 수 없는 축제입니다.")
    try:
        group = await repository.create_group(user_id, payload.model_dump(by_alias=True))
    except RepositoryError as error:
        raise repository_error(error) from error
    return success(group, request, status_code=201)


@router.get("/{group_id}", operation_id="getGroup")
async def get_group_detail(group_id: str, request: Request):
    return success(await get_group(group_id, get_repository(request)), request)


@router.patch("/{group_id}", operation_id="updateGroup")
async def update_group(group_id: str, payload: GroupUpdate, request: Request, x_demo_user_id: str | None = Header(default=None), if_match: str | None = Header(default=None)):
    repository = get_repository(request)
    user_id = await require_demo(x_demo_user_id, repository)
    group = await get_group(group_id, repository)
    require_leader(group, user_id)
    version = int(if_match.strip('"')) if if_match and if_match.strip('"').isdigit() else payload.version
    values = payload.model_dump(by_alias=True, exclude_none=True)
    if values.get("capacity", group["capacity"]) < group["memberCount"]:
        raise APIError(409, "GROUP_CAPACITY_EXCEEDED", "현재 멤버 수보다 작은 정원은 설정할 수 없습니다.")
    updated = await repository.update_group(group_id, values, version)
    if not updated:
        raise APIError(409, "RESOURCE_VERSION_CONFLICT", "리소스 버전이 변경되었습니다.", {"latest": await repository.group(group_id)})
    return success(updated, request)


@router.get("/{group_id}/comments", operation_id="listComments")
async def list_comments(group_id: str, request: Request, cursor: str | None = None, limit: int = Query(default=20, ge=1, le=100)):
    group = await get_group(group_id, get_repository(request))
    start = int(cursor) if cursor and cursor.isdigit() else 0
    items = group["comments"][start : start + limit]
    next_cursor = str(start + limit) if start + limit < len(group["comments"]) else None
    return success({"items": items, "nextCursor": next_cursor}, request)


@router.post("/{group_id}/comments", operation_id="createComment", status_code=201)
async def create_comment(group_id: str, payload: CommentCreate, request: Request, x_demo_user_id: str | None = Header(default=None)):
    repository = get_repository(request)
    user_id = await require_demo(x_demo_user_id, repository)
    await get_group(group_id, repository)
    try:
        comment = await repository.add_comment(group_id, user_id, payload.text)
    except RepositoryError as error:
        raise repository_error(error) from error
    return success(comment, request, status_code=201)


@router.delete("/{group_id}/comments/{comment_id}", operation_id="deleteComment", status_code=204)
async def delete_comment(group_id: str, comment_id: str, request: Request, x_demo_user_id: str | None = Header(default=None)):
    repository = get_repository(request)
    user_id = await require_demo(x_demo_user_id, repository)
    if not await repository.delete_comment(group_id, comment_id, user_id):
        raise APIError(404, "COMMENT_NOT_FOUND", "댓글을 찾을 수 없습니다.")
    return Response(status_code=204)


@router.get("/{group_id}/join-requests", operation_id="listJoinRequests")
async def list_join_requests(group_id: str, request: Request, status: str | None = None, page: int = Query(default=1, ge=1), page_size: int = Query(default=20, ge=1, le=100, alias="pageSize"), x_demo_user_id: str | None = Header(default=None)):
    repository = get_repository(request)
    user_id = await require_demo(x_demo_user_id, repository)
    group = await get_group(group_id, repository)
    require_leader(group, user_id)
    items = [item for item in group["joinRequests"] if not status or item["status"] == status]
    start = (page - 1) * page_size
    return success({"items": items[start : start + page_size], "page": page, "pageSize": page_size, "total": len(items)}, request)


@router.post("/{group_id}/join-requests", operation_id="createJoinRequest", status_code=201)
async def create_join_request(group_id: str, payload: JoinRequestCreate, request: Request, x_demo_user_id: str | None = Header(default=None)):
    repository = get_repository(request)
    user_id = await require_demo(x_demo_user_id, repository)
    try:
        result = await repository.create_join_request(group_id, user_id, payload.message)
    except RepositoryError as error:
        raise repository_error(error) from error
    if result["request"]:
        return success(result["request"], request, status_code=201)
    return success({"membership": result["membership"], "group": result["group"]}, request, status_code=201)


@router.post("/{group_id}/join-requests/{request_id}/approve", operation_id="approveJoinRequest")
async def approve_join_request(group_id: str, request_id: str, payload: VersionRequest, request: Request, x_demo_user_id: str | None = Header(default=None), if_match: str | None = Header(default=None)):
    repository = get_repository(request)
    user_id = await require_demo(x_demo_user_id, repository)
    version = int(if_match.strip('"')) if if_match and if_match.strip('"').isdigit() else payload.version
    try:
        result = await repository.approve_join_request(group_id, request_id, user_id, version)
    except RepositoryError as error:
        raise repository_error(error) from error
    return success(result, request)


@router.post("/{group_id}/join-requests/{request_id}/reject", operation_id="rejectJoinRequest")
async def reject_join_request(group_id: str, request_id: str, payload: RejectRequest, request: Request, x_demo_user_id: str | None = Header(default=None)):
    repository = get_repository(request)
    user_id = await require_demo(x_demo_user_id, repository)
    try:
        result = await repository.reject_join_request(group_id, request_id, user_id, payload.version, payload.reason)
    except RepositoryError as error:
        raise repository_error(error) from error
    if not result:
        raise APIError(409, "JOIN_REQUEST_NOT_PENDING", "대기 중인 참여 신청이 아닙니다.")
    return success(result, request)


@router.delete("/{group_id}/membership", operation_id="leaveGroup", status_code=204)
async def leave_group(group_id: str, request: Request, x_demo_user_id: str | None = Header(default=None)):
    repository = get_repository(request)
    user_id = await require_demo(x_demo_user_id, repository)
    try:
        await repository.leave_group(group_id, user_id)
    except RepositoryError as error:
        raise repository_error(error) from error
    return Response(status_code=204)
