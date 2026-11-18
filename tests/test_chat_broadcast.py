from unittest.mock import AsyncMock, Mock

import httpx
import pytest
from fastapi import FastAPI, Request

from app.core.auth import CurrentUser, require_current_user
from app.features.chat.router import connections, router


@pytest.mark.asyncio
async def test_post_message_succeeds_when_a_socket_disconnects_during_broadcast(monkeypatch):
    group_id = "grp_chat"
    user_id = "usr_sender"
    message = {"id": "msg_saved", "groupId": group_id, "text": "hello"}
    repository = Mock(
        group=AsyncMock(return_value={"members": [{"userId": user_id}]}),
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
    sockets = {disconnected, connected}
    monkeypatch.setitem(connections, group_id, sockets)

    async def disconnect_while_sending(_event):
        sockets.discard(disconnected)
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
    assert sockets == {connected}
