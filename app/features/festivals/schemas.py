from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import Field

from app.core.models import APIModel


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
