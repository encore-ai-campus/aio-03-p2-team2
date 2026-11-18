from __future__ import annotations

import logging
from collections import defaultdict

import asyncpg
from fastapi import APIRouter, Depends, Query, Request
from pydantic import ValidationError
from starlette.websockets import WebSocket, WebSocketDisconnect

from app.core.api import APIError, success
from app.core.auth import authenticate_websocket, current_user_id, require_current_user
from app.core.repositories import SupabaseRepository, get_repository
from app.core.repository import RepositoryError
from .schemas import MessageCreate

router = APIRouter(tags=["chat"])
logger = logging.getLogger(__name__)
connections: dict[str, dict[WebSocket, str]] = defaultdict(dict)


async def require_chat_membership(group_id: str, user_id: str, repository: SupabaseRepository) -> None:
    if user_id in await repository.active_chat_member_ids(group_id):
        return
    if not await repository.group(group_id, include_comments=False):
        raise APIError(404, "GROUP_NOT_FOUND", "모임을 찾을 수 없습니다.")
    raise APIError(403, "CHAT_MEMBER_ONLY", "모임 참여자만 채팅을 이용할 수 있습니다.")


async def broadcast(group_id: str, message: dict, repository: SupabaseRepository) -> None:
    sockets = connections.get(group_id)
    if not sockets:
        return
    try:
        active_members = await repository.active_chat_member_ids(group_id)
    except (RepositoryError, asyncpg.PostgresError, OSError, TimeoutError):
        logger.warning("Could not verify chat broadcast recipients", exc_info=True)
        return
    event = {"event": "chat.message.created", "data": message}
    for socket, user_id in tuple(sockets.items()):
        if socket not in sockets:
            continue
        try:
            if user_id in active_members:
                await socket.send_json(event)
            else:
                sockets.pop(socket, None)
                await socket.close(code=1008, reason="CHAT_MEMBER_ONLY")
        except Exception:
            sockets.pop(socket, None)


@router.get("/groups/{group_id}/messages", operation_id="listMessages", dependencies=[Depends(require_current_user)])
async def list_messages(group_id: str, request: Request, before: str | None = None, after: str | None = None, limit: int = Query(default=50, ge=1, le=100)):
    repository = get_repository(request)
    user_id = current_user_id(request)
    await require_chat_membership(group_id, user_id, repository)
    items = await repository.messages(group_id, before=before, after=after, limit=limit + 1)
    has_more = len(items) > limit
    forward = after is not None
    items = items[:limit] if forward else items[-limit:]
    next_cursor = items[-1 if forward else 0]["id"] if has_more else None
    return success({"items": items, "nextCursor": next_cursor}, request)


@router.post("/groups/{group_id}/messages", operation_id="createMessage", status_code=201, dependencies=[Depends(require_current_user)])
async def create_message(group_id: str, payload: MessageCreate, request: Request):
    repository = get_repository(request)
    user_id = current_user_id(request)
    await require_chat_membership(group_id, user_id, repository)
    message = await repository.add_message(group_id, user_id, payload.text, payload.client_message_id)
    await broadcast(group_id, message, repository)
    return success(message, request, status_code=201)


@router.get("/groups/{group_id}/events", operation_id="listGroupEvents", dependencies=[Depends(require_current_user)])
async def list_events(group_id: str, request: Request):
    repository = get_repository(request)
    user_id = current_user_id(request)
    await require_chat_membership(group_id, user_id, repository)
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
        try:
            await require_chat_membership(group_id, user_id, repository)
        except APIError as error:
            await websocket.close(code=1008, reason=error.code)
            return
        await websocket.accept()
        connections[group_id][websocket] = user_id
        await websocket.send_json({"event": "chat.connected", "data": {"groupId": group_id, "userId": user_id}})
        while True:
            payload = await websocket.receive_json()
            if user_id not in await repository.active_chat_member_ids(group_id):
                await websocket.close(code=1008, reason="CHAT_MEMBER_ONLY")
                return
            try:
                incoming = MessageCreate.model_validate(payload)
                text = incoming.text.strip()
                if not text:
                    raise ValueError("Empty chat message")
            except (ValidationError, ValueError):
                await websocket.send_json({"event": "chat.error", "data": {"code": "MESSAGE_INVALID", "message": "text가 필요합니다."}})
                continue
            message = await repository.add_message(group_id, user_id, text, incoming.client_message_id)
            await broadcast(group_id, message, repository)
    except WebSocketDisconnect:
        pass
    finally:
        sockets = connections.get(group_id)
        if sockets is not None:
            sockets.pop(websocket, None)
            if not sockets:
                connections.pop(group_id, None)
        if context_token is not None:
            database.reset_auth_claims(context_token)
