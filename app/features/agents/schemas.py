from __future__ import annotations

from datetime import date as Date, datetime, time, timedelta, timezone
from typing import Literal, Annotated

from pydantic import Field, field_validator, model_validator

from app.core.models import APIModel


# 프로필 여행 스타일 값(온보딩 선택지)과 맞춘다. AI가 "계획적"처럼 줄여 말해도 점수 계산에서 같은 값으로 본다.
_TRAVEL_STYLES = {"계획": "계획적으로", "여유": "여유롭게", "활동": "활동적으로"}


def _seoul_today() -> Date:
    return datetime.now(timezone(timedelta(hours=9))).date()


class Conditions(APIModel):
    date: Date | None = None
    start_time: str | None = None
    end_time: str | None = None
    budget_manwon: int | None = Field(default=None, ge=1, le=1000)
    interests: list[Annotated[str,Field(max_length=80)]] | None = Field(default=None, max_length=20)
    travel_style: str | None = Field(default=None, max_length=40)
    party_size: int | None = Field(default=None, ge=2, le=8)
    age_band: Literal["10대", "20대", "30대", "40대", "50대"] | None = None
    gender_preference: Literal["any", "same", "only_same"] | None = None
    preferred_mbti: list[Annotated[str, Field(max_length=4)]] | None = Field(default=None, max_length=16)
    indoor_only: bool | None = None
    avoid_rain: bool | None = None
    region: str | None = Field(default=None, max_length=80)

    @field_validator("start_time", "end_time")
    @classmethod
    def hhmm(cls, value: str | None) -> str | None:
        if value is not None:
            try:
                if len(value) != 5 or time.fromisoformat(value).strftime("%H:%M") != value:
                    raise ValueError()
            except ValueError:
                raise ValueError("time must use HH:mm") from None
        return value

    @field_validator("travel_style")
    @classmethod
    def canonical_style(cls, value: str | None) -> str | None:
        if value:
            for prefix, canonical in _TRAVEL_STYLES.items():
                if value.strip().startswith(prefix):
                    return canonical
        return value

    @field_validator("date")
    @classmethod
    def plausible_year(cls, value: Date | None) -> Date | None:
        # "11월 21일"처럼 연도 없이 말하면 AI가 1111년 등 엉뚱한 연도를 채울 수 있다.
        # 명백히 잘못된 연도(작년보다 이전)만 다가오는 같은 월·일로 바로잡는다.
        today = _seoul_today()
        if value is not None and value.year < today.year - 1:
            try:
                fixed = value.replace(year=today.year)
                if fixed < today:
                    fixed = fixed.replace(year=today.year + 1)
            except ValueError:  # 2월 29일
                return value
            return fixed
        return value

    @model_validator(mode="after")
    def ordered(self):
        if self.start_time and self.end_time and self.start_time >= self.end_time:
            raise ValueError("endTime must be after startTime")
        return self


class Preferences(APIModel):
    interests: list[Annotated[str,Field(max_length=80)]] | None = Field(default=None, max_length=20)
    travel_style: str | None = Field(default=None, max_length=40)
    indoor_only: bool | None = None
    avoid_rain: bool | None = None


class RunStart(APIModel):
    message: str = Field(min_length=1, max_length=4000)
    intent: Literal["auto", "scheduling", "matching", "risk_response"] = "auto"
    session_id: str | None = Field(default=None, max_length=100)
    group_id: str | None = Field(default=None, max_length=100)
    festival_id: str | None = Field(default=None, max_length=100)
    conditions: Conditions = Field(default_factory=Conditions)
    remember: Preferences | None = None


class ResumeRun(APIModel):
    checkpoint_id: str
    message: str | None = Field(default=None, max_length=4000)
    group_id: str | None = Field(default=None, max_length=100)
    festival_id: str | None = Field(default=None, max_length=100)
    answers: Conditions | None = None
    decision: Literal["approve", "reject", "cancel"] | None = None
    weather_decision: Literal["keep", "alternatives"] | None = None


class PlanItem(APIModel):
    date: Date
    time: str
    end_time: str
    label: str = Field(min_length=1, max_length=120)
    description: str = Field(max_length=500)

    @field_validator("time", "end_time")
    @classmethod
    def valid_time(cls, value):
        return Conditions.hhmm(value)


class SchedulePlan(APIModel):
    summary: str = Field(max_length=1000)
    items: list[PlanItem] = Field(min_length=1, max_length=8)


class ParsedRequest(APIModel):
    intent: Literal["scheduling", "matching", "risk_response"]
    conditions: Conditions


class RepairDecision(APIModel):
    action: Literal["regenerate", "refresh_tools", "ask_user", "stop"]
    reason: str
