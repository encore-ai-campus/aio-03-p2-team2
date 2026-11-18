from __future__ import annotations

from collections import defaultdict

from fastapi import APIRouter, Depends, Query, Request
from starlette.websockets import WebSocket, WebSocketDisconnect

from app.core.api import APIError, success
from app.core.auth import authenticate_websocket, current_user_id, require_current_user
from app.core.repositories import SupabaseRepository, get_repository
from .schemas import MessageCreate

router = APIRouter(tags=["chat"])
connections: dict[str, set[WebSocket]] = defaultdict(set)


async def member_group(group_id: str, user_id: str, repository: SupabaseRepository) -> dict:
    group = await repository.group(group_id, include_comments=False)
    if not group:
        raise APIError(404, "GROUP_NOT_FOUND", "모임을 찾을 수 없습니다.")
    if not any(item["userId"] == user_id for item in group["members"]):
        raise APIError(403, "CHAT_MEMBER_ONLY", "모임 참여자만 채팅을 이용할 수 있습니다.")
    return group


async def broadcast(group_id: str, message: dict) -> None:
    sockets = connections[group_id]
    event = {"event": "chat.message.created", "data": message}
    # A socket can disconnect while send_json yields.
    for socket in tuple(sockets):
        try:
            await socket.send_json(event)
        except Exception:
            sockets.discard(socket)


@router.get("/groups/{group_id}/messages", operation_id="listMessages", dependencies=[Depends(require_current_user)])
async def list_messages(group_id: str, request: Request, before: str | None = None, after: str | None = None, limit: int = Query(default=50, ge=1, le=100)):
    repository = get_repository(request)
    user_id = current_user_id(request)
    await member_group(group_id, user_id, repository)
    items = await repository.messages(group_id, before=before, after=after, limit=limit)
    return success({"items": items, "nextCursor": items[0]["id"] if items else None}, request)


@router.post("/groups/{group_id}/messages", operation_id="createMessage", status_code=201, dependencies=[Depends(require_current_user)])
async def create_message(group_id: str, payload: MessageCreate, request: Request):
    repository = get_repository(request)
    user_id = current_user_id(request)
    await member_group(group_id, user_id, repository)
    message = await repository.add_message(group_id, user_id, payload.text, payload.client_message_id)
    await broadcast(group_id, message)
    return success(message, request, status_code=201)


@router.get("/groups/{group_id}/events", operation_id="listGroupEvents", dependencies=[Depends(require_current_user)])
async def list_events(group_id: str, request: Request):
    repository = get_repository(request)
    user_id = current_user_id(request)
    await member_group(group_id, user_id, repository)
    messages = await repository.messages(group_id, before=None, after=None, limit=100)
    return success({"items": [{"event": "chat.message.created", "data": message} for message in messages], "nextCursor": None}, request)


@router.websocket("/ws/groups/{group_id}/chat")
async def chat_socket(websocket: WebSocket, group_id: str):
    repository = get_repository(websocket)
    database = websocket.app.state.database
    context_token = None
    try:
        current_user, context_token = await authenticate_websocket(websocket)
    except APIError as error:
        await websocket.close(code=1008, reason=error.code)
        return
    user_id = current_user.id
    try:
        group = await repository.group(group_id, include_comments=False)
        if not group:
            await websocket.close(code=1008, reason="GROUP_NOT_FOUND")
            return
        if not any(item["userId"] == user_id for item in group["members"]):
            await websocket.close(code=1008, reason="CHAT_MEMBER_ONLY")
            return
        await websocket.accept()
        connections[group_id].add(websocket)
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
        if context_token is not None:
            database.reset_auth_claims(context_token)
