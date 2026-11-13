from __future__ import annotations

from typing import Literal

from pydantic import Field, field_validator

from app.core.models import APIModel


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
