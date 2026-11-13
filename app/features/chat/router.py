from __future__ import annotations

from collections import defaultdict

from fastapi import APIRouter, Header, Query, Request
from starlette.websockets import WebSocket, WebSocketDisconnect

from app.core.api import APIError, success
from app.core.repositories import SupabaseRepository, get_repository
from app.core.schemas import MessageCreate

router = APIRouter(tags=["chat"])
connections: dict[str, set[WebSocket]] = defaultdict(set)


async def require_demo(value: str | None, repository: SupabaseRepository) -> str:
    if not value or not await repository.user(value):
        raise APIError(400, "DEMO_USER_INVALID", "유효한 X-Demo-User-Id가 필요합니다.")
    return value


async def member_group(group_id: str, user_id: str, repository: SupabaseRepository) -> dict:
    group = await repository.group(group_id, include_comments=False)
    if not group:
        raise APIError(404, "GROUP_NOT_FOUND", "모임을 찾을 수 없습니다.")
    if not any(item["userId"] == user_id for item in group["members"]):
        raise APIError(403, "CHAT_MEMBER_ONLY", "모임 참여자만 채팅을 이용할 수 있습니다.")
    return group


async def broadcast(group_id: str, message: dict) -> None:
    stale = []
    for socket in connections[group_id]:
        try:
            await socket.send_json({"event": "chat.message.created", "data": message})
        except Exception:
            stale.append(socket)
    for socket in stale:
        connections[group_id].discard(socket)


@router.get("/groups/{group_id}/messages", operation_id="listMessages")
async def list_messages(group_id: str, request: Request, before: str | None = None, after: str | None = None, limit: int = Query(default=50, ge=1, le=100), x_demo_user_id: str | None = Header(default=None)):
    repository = get_repository(request)
    user_id = await require_demo(x_demo_user_id, repository)
    await member_group(group_id, user_id, repository)
    items = await repository.messages(group_id, before=before, after=after, limit=limit)
    return success({"items": items, "nextCursor": items[0]["id"] if items else None}, request)


@router.post("/groups/{group_id}/messages", operation_id="createMessage", status_code=201)
async def create_message(group_id: str, payload: MessageCreate, request: Request, x_demo_user_id: str | None = Header(default=None)):
    repository = get_repository(request)
    user_id = await require_demo(x_demo_user_id, repository)
    await member_group(group_id, user_id, repository)
    message = await repository.add_message(group_id, user_id, payload.text, payload.client_message_id)
    await broadcast(group_id, message)
    return success(message, request, status_code=201)


@router.get("/groups/{group_id}/events", operation_id="listGroupEvents")
async def list_events(group_id: str, request: Request, x_demo_user_id: str | None = Header(default=None)):
    repository = get_repository(request)
    user_id = await require_demo(x_demo_user_id, repository)
    await member_group(group_id, user_id, repository)
    messages = await repository.messages(group_id, before=None, after=None, limit=100)
    return success({"items": [{"event": "chat.message.created", "data": message} for message in messages], "nextCursor": None}, request)


@router.websocket("/ws/groups/{group_id}/chat")
async def chat_socket(websocket: WebSocket, group_id: str):
    repository = get_repository(websocket)
    user_id = websocket.query_params.get("demoUserId")
    if not user_id or not await repository.user(user_id):
        await websocket.close(code=1008, reason="DEMO_USER_INVALID")
        return
    group = await repository.group(group_id, include_comments=False)
    if not group:
        await websocket.close(code=1008, reason="GROUP_NOT_FOUND")
        return
    if not any(item["userId"] == user_id for item in group["members"]):
        await websocket.close(code=1008, reason="CHAT_MEMBER_ONLY")
        return
    await websocket.accept()
    connections[group_id].add(websocket)
    try:
        await websocket.send_json({"event": "chat.connected", "data": {"groupId": group_id, "userId": user_id}})
        while True:
            payload = await websocket.receive_json()
            text = payload.get("text") if isinstance(payload, dict) else None
            if not isinstance(text, str) or not text.strip():
                await websocket.send_json({"event": "chat.error", "data": {"code": "MESSAGE_INVALID", "message": "text가 필요합니다."}})
                continue
            message = await repository.add_message(group_id, user_id, text.strip(), payload.get("clientMessageId"))
            await broadcast(group_id, message)
    except WebSocketDisconnect:
        pass
    finally:
        connections[group_id].discard(websocket)
