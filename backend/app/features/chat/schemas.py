from __future__ import annotations

from pydantic import Field

from app.core.models import APIModel


class MessageCreate(APIModel):
    text: str = Field(min_length=1, max_length=1000)
    client_message_id: str | None = Field(default=None, max_length=120)
