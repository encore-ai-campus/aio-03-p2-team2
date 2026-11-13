from __future__ import annotations

from typing import Literal

from pydantic import Field

from app.core.models import APIModel


class GroupCreate(APIModel):
    festival_id: str
    title: str = Field(min_length=1, max_length=45)
    post_body: str = Field(min_length=1, max_length=2000)
    capacity: int = Field(ge=2, le=8)
    join_mode: Literal["approval", "instant"] = "approval"


class GroupUpdate(APIModel):
    title: str | None = Field(default=None, min_length=1, max_length=45)
    post_body: str | None = Field(default=None, min_length=1, max_length=2000)
    capacity: int | None = Field(default=None, ge=2, le=8)
    version: int


class CommentCreate(APIModel):
    text: str = Field(min_length=1, max_length=500)


class JoinRequestCreate(APIModel):
    message: str | None = Field(default=None, max_length=300)


class VersionRequest(APIModel):
    version: int


class RejectRequest(APIModel):
    reason: str | None = Field(default=None, max_length=1000)
    version: int
