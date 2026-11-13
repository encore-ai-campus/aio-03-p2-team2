from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Header, Query, Request, Response

from app.core.api import APIError, success
from app.core.schemas import CommentCreate, GroupCreate, GroupUpdate, JoinRequestCreate, RejectRequest, VersionRequest
from app.core.store import new_id, now_iso, store

router = APIRouter(prefix="/groups", tags=["groups"])


def require_demo(value: str | None) -> str:
    if not value or not store.user(value):
        raise APIError(400, "DEMO_USER_INVALID", "유효한 X-Demo-User-Id가 필요합니다.")
    return value


def get_group(group_id: str) -> dict:
    group = store.group_ref(group_id)
    if not group:
        raise APIError(404, "GROUP_NOT_FOUND", "모임을 찾을 수 없습니다.")
    return group


def require_leader(group: dict, user_id: str) -> None:
    if group["leaderId"] != user_id:
        raise APIError(403, "LEADER_ONLY", "모임장만 수행할 수 있습니다.")


def require_member(group: dict, user_id: str) -> None:
    if not store.member(group, user_id):
        raise APIError(403, "GROUP_MEMBER_ONLY", "모임 참여자만 수행할 수 있습니다.")


def check_version(group: dict, version: int | None) -> None:
    if version is not None and group["version"] != version:
        raise APIError(409, "RESOURCE_VERSION_CONFLICT", "리소스 버전이 변경되었습니다.", {"latest": store.serialize_group(group)})


def public_comment(comment: dict) -> dict:
    return {key: value for key, value in comment.items() if key != "authorUserId"}


@router.get("", operation_id="listGroups")
def list_groups(request: Request, festival_id: str | None = Query(default=None, alias="festivalId"), status: str | None = None, keyword: str | None = None, page: int = Query(default=1, ge=1), page_size: int = Query(default=20, ge=1, le=100, alias="pageSize")):
    items = []
    for group in store.groups.values():
        if festival_id and group["festivalId"] != festival_id:
            continue
        if status and group["status"] != status:
            continue
        if keyword and keyword.lower() not in f"{group['title']} {group['postBody']}".lower():
            continue
        item = store.serialize_group(group, include_comments=False)
        item.pop("members", None)
        items.append(item)
    items.sort(key=lambda item: item["createdAt"], reverse=True)
    start = (page - 1) * page_size
    return success({"items": items[start : start + page_size], "page": page, "pageSize": page_size, "total": len(items)}, request)


@router.post("", operation_id="createGroup", status_code=201)
def create_group(payload: GroupCreate, request: Request, x_demo_user_id: str | None = Header(default=None)):
    user_id = require_demo(x_demo_user_id)
    festival = store.festival(payload.festival_id)
    if not festival or festival["riskStatus"] == "cancelled" or festival["endDate"] < date.today().isoformat():
        raise APIError(422, "FESTIVAL_NOT_AVAILABLE", "종료되었거나 이용할 수 없는 축제입니다.")
    with store.lock:
        return success(store.create_group(user_id, payload.model_dump(by_alias=True)), request, status_code=201)


@router.get("/{group_id}", operation_id="getGroup")
def get_group_detail(group_id: str, request: Request):
    return success(store.serialize_group(get_group(group_id)), request)


@router.patch("/{group_id}", operation_id="updateGroup")
def update_group(group_id: str, payload: GroupUpdate, request: Request, x_demo_user_id: str | None = Header(default=None), if_match: str | None = Header(default=None)):
    user_id = require_demo(x_demo_user_id)
    group = get_group(group_id)
    require_leader(group, user_id)
    version = payload.version
    if if_match and if_match.strip('"').isdigit():
        version = int(if_match.strip('"'))
    check_version(group, version)
    with store.lock:
        values = payload.model_dump(by_alias=True, exclude_none=True)
        values.pop("version", None)
        if "capacity" in values and values["capacity"] < len(group["members"]):
            raise APIError(409, "GROUP_CAPACITY_EXCEEDED", "현재 멤버 수보다 작은 정원은 설정할 수 없습니다.")
        group.update(values)
        group["version"] += 1
        group["updatedAt"] = now_iso()
        store.update_status(group)
        return success(store.serialize_group(group), request)


@router.get("/{group_id}/comments", operation_id="listComments")
def list_comments(group_id: str, request: Request, cursor: str | None = None, limit: int = Query(default=20, ge=1, le=100)):
    group = get_group(group_id)
    start = int(cursor) if cursor and cursor.isdigit() else 0
    items = group["comments"][start : start + limit]
    next_cursor = str(start + limit) if start + limit < len(group["comments"]) else None
    return success({"items": [public_comment(item) for item in items], "nextCursor": next_cursor}, request)


@router.post("/{group_id}/comments", operation_id="createComment", status_code=201)
def create_comment(group_id: str, payload: CommentCreate, request: Request, x_demo_user_id: str | None = Header(default=None)):
    user_id = require_demo(x_demo_user_id)
    group = get_group(group_id)
    comment = {"id": new_id("cmt"), "groupId": group_id, "authorUserId": user_id, "author": {"id": user_id, "displayName": store.users[user_id]["displayName"]}, "text": payload.text, "createdAt": now_iso()}
    with store.lock:
        group["comments"].append(comment)
    return success(public_comment(comment), request, status_code=201)


@router.delete("/{group_id}/comments/{comment_id}", operation_id="deleteComment", status_code=204)
def delete_comment(group_id: str, comment_id: str, request: Request, x_demo_user_id: str | None = Header(default=None)):
    user_id = require_demo(x_demo_user_id)
    group = get_group(group_id)
    comment = next((item for item in group["comments"] if item["id"] == comment_id), None)
    if not comment:
        raise APIError(404, "COMMENT_NOT_FOUND", "댓글을 찾을 수 없습니다.")
    if comment["authorUserId"] != user_id and group["leaderId"] != user_id:
        raise APIError(403, "COMMENT_DELETE_FORBIDDEN", "댓글 작성자 또는 모임장만 삭제할 수 있습니다.")
    group["comments"].remove(comment)
    return Response(status_code=204)


@router.get("/{group_id}/join-requests", operation_id="listJoinRequests")
def list_join_requests(group_id: str, request: Request, status: str | None = None, page: int = Query(default=1, ge=1), page_size: int = Query(default=20, ge=1, le=100, alias="pageSize"), x_demo_user_id: str | None = Header(default=None)):
    user_id = require_demo(x_demo_user_id)
    group = get_group(group_id)
    require_leader(group, user_id)
    items = [item for item in group["joinRequests"] if not status or item["status"] == status]
    start = (page - 1) * page_size
    return success({"items": items[start : start + page_size], "page": page, "pageSize": page_size, "total": len(items)}, request)


@router.post("/{group_id}/join-requests", operation_id="createJoinRequest", status_code=201)
def create_join_request(group_id: str, payload: JoinRequestCreate, request: Request, x_demo_user_id: str | None = Header(default=None)):
    user_id = require_demo(x_demo_user_id)
    group = get_group(group_id)
    if store.member(group, user_id):
        raise APIError(409, "ALREADY_MEMBER", "이미 참여 중인 모임입니다.")
    if group["status"] in {"full", "closed", "cancelled"}:
        raise APIError(409, "GROUP_CLOSED", "참여할 수 없는 모임입니다.")
    if any(item["userId"] == user_id and item["status"] == "pending" for item in group["joinRequests"]):
        raise APIError(409, "JOIN_REQUEST_ALREADY_EXISTS", "이미 대기 중인 참여 신청이 있습니다.")
    with store.lock:
        if group["joinMode"] == "instant":
            if len(group["members"]) >= group["capacity"]:
                store.update_status(group)
                raise APIError(409, "GROUP_CAPACITY_EXCEEDED", "모임 정원이 가득 찼습니다.")
            member = {"userId": user_id, "role": "member", "joinedAt": now_iso()}
            group["members"].append(member)
            group["version"] += 1
            group["updatedAt"] = now_iso()
            store.update_status(group)
            store.add_message(group, None, f"{store.users[user_id]['displayName']}님이 모임에 참여했습니다.", "system")
            return success({"membership": member, "group": store.serialize_group(group)}, request, status_code=201)
        join_request = {"id": new_id("join"), "groupId": group_id, "userId": user_id, "message": payload.message, "status": "pending", "createdAt": now_iso(), "updatedAt": now_iso()}
        group["joinRequests"].append(join_request)
        return success(join_request, request, status_code=201)


@router.post("/{group_id}/join-requests/{request_id}/approve", operation_id="approveJoinRequest")
def approve_join_request(group_id: str, request_id: str, payload: VersionRequest, request: Request, x_demo_user_id: str | None = Header(default=None), if_match: str | None = Header(default=None)):
    user_id = require_demo(x_demo_user_id)
    group = get_group(group_id)
    require_leader(group, user_id)
    check_version(group, int(if_match.strip('"')) if if_match and if_match.strip('"').isdigit() else payload.version)
    item = next((item for item in group["joinRequests"] if item["id"] == request_id), None)
    if not item:
        raise APIError(404, "JOIN_REQUEST_NOT_FOUND", "참여 신청을 찾을 수 없습니다.")
    if item["status"] != "pending":
        raise APIError(409, "JOIN_REQUEST_NOT_PENDING", "대기 중인 참여 신청이 아닙니다.")
    with store.lock:
        if len(group["members"]) >= group["capacity"]:
            raise APIError(409, "GROUP_CAPACITY_EXCEEDED", "모임 정원이 가득 찼습니다.")
        item["status"] = "approved"
        item["updatedAt"] = now_iso()
        member = {"userId": item["userId"], "role": "member", "joinedAt": now_iso()}
        group["members"].append(member)
        group["version"] += 1
        group["updatedAt"] = now_iso()
        store.update_status(group)
        store.add_message(group, None, f"{store.users[item['userId']]['displayName']}님이 모임에 합류했습니다.", "system")
        store.create_alert(item["userId"], {"type": "festival_changed", "festivalId": group["festivalId"], "groupId": group_id, "severity": "info", "title": "참여 신청이 승인되었습니다", "message": "모임 채팅에 참여할 수 있습니다."})
        return success({"membership": member, "group": store.serialize_group(group)}, request)


@router.post("/{group_id}/join-requests/{request_id}/reject", operation_id="rejectJoinRequest")
def reject_join_request(group_id: str, request_id: str, payload: RejectRequest, request: Request, x_demo_user_id: str | None = Header(default=None)):
    user_id = require_demo(x_demo_user_id)
    group = get_group(group_id)
    require_leader(group, user_id)
    check_version(group, payload.version)
    item = next((item for item in group["joinRequests"] if item["id"] == request_id), None)
    if not item:
        raise APIError(404, "JOIN_REQUEST_NOT_FOUND", "참여 신청을 찾을 수 없습니다.")
    with store.lock:
        item["status"] = "rejected"
        item["reason"] = payload.reason
        item["updatedAt"] = now_iso()
        group["version"] += 1
        return success(item, request)


@router.delete("/{group_id}/membership", operation_id="leaveGroup", status_code=204)
def leave_group(group_id: str, request: Request, x_demo_user_id: str | None = Header(default=None)):
    user_id = require_demo(x_demo_user_id)
    group = get_group(group_id)
    member = store.member(group, user_id)
    if not member:
        raise APIError(403, "GROUP_MEMBER_ONLY", "참여 멤버만 탈퇴할 수 있습니다.")
    if member["role"] == "leader":
        raise APIError(422, "LEADER_CANNOT_LEAVE", "모임장은 모임을 먼저 종료하거나 양도해야 합니다.")
    with store.lock:
        group["members"].remove(member)
        group["version"] += 1
        group["updatedAt"] = now_iso()
        store.update_status(group)
    return Response(status_code=204)
