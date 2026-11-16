from __future__ import annotations

from typing import Literal

from pydantic import Field

from app.core.models import APIModel


class MatchingParseRequest(APIModel):
    text: str = Field(min_length=1, max_length=2000)


class MatchingConditions(APIModel):
    start_time: str | None = None
    budget_manwon: int | None = Field(default=None, ge=1, le=1000)
    interests: list[str] = []
    travel_style: str | None = None
    preferred_mbti: list[str] = []
    party_size: int | None = Field(default=None, ge=2, le=8)  # DB groups.capacity 2~8
    join_mode: Literal["approval", "instant"] | None = None


class MatchingGroupInput(APIModel):
    title: str = Field(min_length=1, max_length=45)  # DB groups.title 1~45
    post_body: str = Field(min_length=1, max_length=2000)  # DB groups.post_body 1~2000


class MatchingRunRequest(APIModel):
    festival_id: str
    conditions: MatchingConditions
    create_group: bool = False
    group: MatchingGroupInput | None = None
    top_k: int = Field(default=5, ge=1, le=20)
