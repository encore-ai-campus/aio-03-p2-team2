from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


def to_camel(value: str) -> str:
    head, *tail = value.split("_")
    return head + "".join(part.title() for part in tail)


class APIModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
    )


class ProfilePatch(APIModel):
    interests: list[str] | None = None
    budget_manwon: int | None = Field(default=None, ge=1, le=1000)
    travel_style: Literal["여유롭게", "활동적으로", "계획적으로"] | None = None
    mbti: list[str] | None = None
    preferred_party_size: int | None = Field(default=None, ge=2, le=100)
    available_from: str | None = None
    default_join_mode: Literal["approval", "instant"] | None = None

    @field_validator("available_from")
    @classmethod
    def valid_time(cls, value: str | None) -> str | None:
        if value is None:
            return value
        hour, separator, minute = value.partition(":")
        if separator != ":" or len(hour) != 2 or len(minute) != 2 or not (0 <= int(hour) <= 23 and 0 <= int(minute) <= 59):
            raise ValueError("availableFrom must use HH:mm")
        return value


class NotificationConsentPatch(APIModel):
    push: bool | None = None
    email: bool | None = None
    risk_alert: bool | None = None


class FestivalInput(APIModel):
    id: str | None = None
    name: str = Field(min_length=1, max_length=200)
    region: str = Field(min_length=1, max_length=100)
    city: str = Field(min_length=1, max_length=100)
    start_date: date
    end_date: date
    category: str = Field(min_length=1, max_length=80)
    description: str = ""
    tags: list[str] = []
    status: Literal["past", "live", "upcoming"] = "upcoming"
    source: str = "manual"
    venue: dict = {}
    operating_hours: list[dict] = []
    risk_status: Literal["normal", "weather_risk", "changed", "cancelled"] = "normal"


class FestivalImportRequest(APIModel):
    festivals: list[FestivalInput] = Field(min_length=1)


class MatchingParseRequest(APIModel):
    text: str = Field(min_length=1, max_length=2000)


class MatchingConditions(APIModel):
    start_time: str | None = None
    budget_manwon: int | None = Field(default=None, ge=1, le=1000)
    interests: list[str] = []
    travel_style: str | None = None
    preferred_mbti: list[str] = []
    party_size: int | None = Field(default=None, ge=2, le=100)
    join_mode: Literal["approval", "instant"] | None = None


class MatchingGroupInput(APIModel):
    title: str = Field(min_length=1, max_length=120)
    post_body: str = Field(min_length=1, max_length=5000)


class MatchingRunRequest(APIModel):
    festival_id: str
    conditions: MatchingConditions
    create_group: bool = False
    group: MatchingGroupInput | None = None
    top_k: int = Field(default=5, ge=1, le=20)


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


class MessageCreate(APIModel):
    text: str = Field(min_length=1, max_length=1000)
    client_message_id: str | None = Field(default=None, max_length=120)


class ScheduleValidateRequest(APIModel):
    trigger: str = "manual"
    version: int | None = None


class ProposalCreate(APIModel):
    strategy: str | None = Field(default=None, max_length=100)
    version: int


class ProposalAction(APIModel):
    reason: str | None = Field(default=None, max_length=1000)
    version: int


class AlertAnswer(APIModel):
    answer: Literal["continue", "find_alternative", "dismiss"]

