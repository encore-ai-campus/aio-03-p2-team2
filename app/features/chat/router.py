from __future__ import annotations

import asyncio
from collections import defaultdict

from fastapi import APIRouter, Header, Query, Request
from fastapi.responses import JSONResponse
from starlette.websockets import WebSocket, WebSocketDisconnect

from app.core.api import APIError, success
from app.core.schemas import MessageCreate
from app.core.store import store

router = APIRouter(tags=["chat"])
connections: dict[str, set[WebSocket]] = defaultdict(set)


def require_demo(value: str | None) -> str:
    if not value or not store.user(value):
        raise APIError(400, "DEMO_USER_INVALID", "유효한 X-Demo-User-Id가 필요합니다.")
    return value


def member_group(group_id: str, user_id: str) -> dict:
    group = store.group_ref(group_id)
    if not group:
        raise APIError(404, "GROUP_NOT_FOUND", "모임을 찾을 수 없습니다.")
    if not store.member(group, user_id):
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
def list_messages(group_id: str, request: Request, before: str | None = None, after: str | None = None, limit: int = Query(default=50, ge=1, le=100), x_demo_user_id: str | None = Header(default=None)):
    user_id = require_demo(x_demo_user_id)
    group = member_group(group_id, user_id)
    messages = group["messages"]
    if before:
        messages = [item for item in messages if item["id"] < before]
    if after:
        messages = [item for item in messages if item["id"] > after]
    items = messages[-limit:]
    return success({"items": items, "nextCursor": items[0]["id"] if len(messages) > len(items) else None}, request)


@router.post("/groups/{group_id}/messages", operation_id="createMessage", status_code=201)
async def create_message(group_id: str, payload: MessageCreate, request: Request, x_demo_user_id: str | None = Header(default=None)):
    user_id = require_demo(x_demo_user_id)
    group = member_group(group_id, user_id)
    with store.lock:
        message = store.add_message(group, user_id, payload.text)
    await broadcast(group_id, message)
    return success(message, request, status_code=201)


@router.get("/groups/{group_id}/events", operation_id="listGroupEvents")
def list_events(group_id: str, request: Request, x_demo_user_id: str | None = Header(default=None)):
    user_id = require_demo(x_demo_user_id)
    group = member_group(group_id, user_id)
    events = [{"event": "chat.message.created", "data": message} for message in group["messages"]]
    return success({"items": events, "nextCursor": None}, request)


@router.websocket("/ws/groups/{group_id}/chat")
async def chat_socket(websocket: WebSocket, group_id: str):
    user_id = websocket.query_params.get("demoUserId")
    if not user_id or not store.user(user_id):
        await websocket.close(code=1008, reason="DEMO_USER_INVALID")
        return
    group = store.group_ref(group_id)
    if not group:
        await websocket.close(code=1008, reason="GROUP_NOT_FOUND")
        return
    if not store.member(group, user_id):
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
            with store.lock:
                message = store.add_message(group, user_id, text.strip())
            await broadcast(group_id, message)
    except WebSocketDisconnect:
        pass
    finally:
        connections[group_id].discard(websocket)
