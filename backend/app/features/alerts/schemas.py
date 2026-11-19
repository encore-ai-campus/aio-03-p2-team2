from __future__ import annotations

from typing import Literal

from app.core.models import APIModel


class AlertAnswer(APIModel):
    answer: Literal["continue", "find_alternative", "dismiss"]
