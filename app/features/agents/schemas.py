from __future__ import annotations

from datetime import date as Date, time
from typing import Literal, Annotated

from pydantic import Field, field_validator, model_validator

from app.core.models import APIModel


class Conditions(APIModel):
    date: Date | None = None
    start_time: str | None = None
    end_time: str | None = None
    budget_manwon: int | None = Field(default=None, ge=1, le=1000)
    interests: list[Annotated[str,Field(max_length=80)]] | None = Field(default=None, max_length=20)
    travel_style: str | None = Field(default=None, max_length=40)
    party_size: int | None = Field(default=None, ge=2, le=8)
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
