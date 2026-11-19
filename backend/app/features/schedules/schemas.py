from __future__ import annotations

from app.core.models import APIModel
from pydantic import Field


class ScheduleValidateRequest(APIModel):
    trigger: str = "manual"
    version: int | None = None


class ProposalCreate(APIModel):
    strategy: str | None = Field(default=None, max_length=100)
    version: int


class ProposalAction(APIModel):
    reason: str | None = Field(default=None, max_length=1000)
    version: int
