from __future__ import annotations

from typing import Literal

from pydantic import Field, field_validator

from app.core.models import APIModel


class AuthCredentials(APIModel):
    """Credentials accepted by the public Supabase Auth endpoints."""

    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=6, max_length=128)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        email = value.strip().lower()
        if "@" not in email or email.startswith("@") or email.endswith("@"):
            raise ValueError("email must be a valid email address")
        return email


class SignupRequest(AuthCredentials):
    display_name: str | None = Field(default=None, min_length=1, max_length=20)


class LoginRequest(AuthCredentials):
    pass


MBTI_TYPES = frozenset(
    a + b + c + d for a in "EI" for b in "NS" for c in "TF" for d in "JP"
)


class ProfilePatch(APIModel):
    interests: list[str] | None = None
    budget_manwon: int | None = Field(default=None, ge=1, le=1000)
    travel_style: Literal["여유롭게", "활동적으로", "계획적으로"] | None = None
    mbti: list[str] | None = None
    preferred_party_size: int | None = Field(default=None, ge=2, le=8)
    available_from: str | None = None
    default_join_mode: Literal["approval", "instant"] | None = None
    # DB user_profiles CHECK 와 같은 한글 값
    gender: Literal["남성", "여성"] | None = None
    age_band: Literal["10대", "20대", "30대", "40대", "50대"] | None = None

    @field_validator("mbti")
    @classmethod
    def valid_mbti(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return value
        normalized = [item.strip().upper() for item in value]
        invalid = [item for item in normalized if item not in MBTI_TYPES]
        if invalid:
            raise ValueError(f"mbti must be one of the 16 MBTI types: {invalid}")
        return list(dict.fromkeys(normalized))

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
