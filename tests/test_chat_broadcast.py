import sqlite3
from unittest.mock import AsyncMock, Mock

import httpx
import pytest
from fastapi import FastAPI, Request

from app.core.auth import CurrentUser, require_current_user
from app.features.chat.repository import ChatRepositoryMixin
from app.features.chat.router import connections, router


@pytest.mark.asyncio
async def test_post_message_succeeds_when_a_socket_disconnects_during_broadcast(monkeypatch):
    group_id = "grp_chat"
    user_id = "usr_sender"
    message = {"id": "msg_saved", "groupId": group_id, "text": "hello"}
    repository = Mock(
        group=AsyncMock(return_value={"members": [{"userId": user_id}]}),
        active_chat_member_ids=AsyncMock(return_value={user_id}),
        add_message=AsyncMock(return_value=message),
    )
    app = FastAPI()
    app.include_router(router)
    app.state.repository = repository

    async def authenticate(request: Request):
        request.state.current_user = CurrentUser(id=user_id, auth_user_id="test-subject", claims={})

    app.dependency_overrides[require_current_user] = authenticate
    disconnected = Mock()
    connected = Mock(send_json=AsyncMock())
    sockets = {disconnected: user_id, connected: user_id}
    monkeypatch.setitem(connections, group_id, sockets)

    async def disconnect_while_sending(_event):
        sockets.pop(disconnected, None)
        raise OSError("socket disconnected")

    disconnected.send_json = AsyncMock(side_effect=disconnect_while_sending)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        response = await client.post(
            f"/groups/{group_id}/messages",
            json={"text": "hello", "clientMessageId": "client-message-1"},
        )

    assert response.status_code == 201
    assert response.json()["data"] == message
    repository.add_message.assert_awaited_once_with(group_id, user_id, "hello", "client-message-1")
    connected.send_json.assert_awaited_once_with({"event": "chat.message.created", "data": message})
    assert sockets == {connected: user_id}


@pytest.mark.asyncio
async def test_broadcast_closes_connections_without_active_membership(monkeypatch):
    group_id = "grp_membership"
    user_id = "usr_active"
    repository = Mock(
        group=AsyncMock(return_value={"members": [{"userId": user_id}]}),
        active_chat_member_ids=AsyncMock(return_value={user_id}),
        add_message=AsyncMock(return_value={"id": "msg_active", "groupId": group_id}),
    )
    app = FastAPI()
    app.include_router(router)
    app.state.repository = repository

    async def authenticate(request: Request):
        request.state.current_user = CurrentUser(id=user_id, auth_user_id="test-subject", claims={})

    app.dependency_overrides[require_current_user] = authenticate
    active = Mock(send_json=AsyncMock())
    former = Mock(send_json=AsyncMock(), close=AsyncMock())
    sockets = {active: user_id, former: "usr_former"}
    monkeypatch.setitem(connections, group_id, sockets)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        response = await client.post(f"/groups/{group_id}/messages", json={"text": "hello"})

    assert response.status_code == 201
    active.send_json.assert_awaited_once()
    former.send_json.assert_not_awaited()
    former.close.assert_awaited_once_with(code=1008, reason="CHAT_MEMBER_ONLY")
    assert sockets == {active: user_id}


@pytest.mark.asyncio
async def test_message_cursors_follow_creation_time_then_break_ties_by_id():
    with sqlite3.connect(":memory:") as database:
        database.row_factory = sqlite3.Row
        database.executescript("""
            create table users (id text, display_name text, avatar_url text);
            create table group_messages (
                id text, group_id text, sender_id text, type text, text text,
                system_event text, client_message_id text, created_at text
            );
            insert into group_messages (id, group_id, created_at) values
                ('z', 'room', '2026-11-18T12:00:01Z'),
                ('a', 'room', '2026-11-18T12:00:02Z'),
                ('m', 'room', '2026-11-18T12:00:03Z'),
                ('x', 'room', '2026-11-18T12:00:03Z'),
                ('b', 'room', '2026-11-18T12:00:04Z'),
                ('outside', 'other-room', '2026-11-18T12:00:02Z');
        """)

        async def fetch(query, *args):
            return database.execute(query, {str(i): arg for i, arg in enumerate(args, 1)}).fetchall()

        repository = ChatRepositoryMixin(Mock(fetch=fetch))
        before = await repository.messages("room", before="x", after=None, limit=2)
        after = await repository.messages("room", before=None, after="z", limit=2)
        outside = await repository.messages("room", before="outside", after=None, limit=2)

    assert [item["id"] for item in before] == ["a", "m"]
    assert [item["id"] for item in after] == ["a", "m"]
    assert outside == []
