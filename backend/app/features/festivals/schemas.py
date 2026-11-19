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


class FestivalSyncRequest(APIModel):
    start_date: date | None = None
    end_date: date | None = None
    page_size: int = Field(default=100, ge=1, le=1000)
    max_pages: int = Field(default=100, ge=1, le=100)
    include_details: bool = False
    area_code: str | None = Field(default=None, pattern=r"^\d{1,10}$", examples=["1"])
    sigungu_code: str | None = Field(default=None, pattern=r"^\d{1,10}$", examples=["1"])
