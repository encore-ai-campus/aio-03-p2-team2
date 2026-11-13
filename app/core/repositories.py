"""Compatibility boundary that composes the domain repositories.

The HTTP layer receives one repository object, while each business domain owns
its SQL and response shaping in its own package.
"""

from __future__ import annotations

from typing import Any

from app.core.repository import RepositoryBase, RepositoryError
from app.features.alerts.repository import AlertRepositoryMixin
from app.features.auth.repository import AuthRepositoryMixin
from app.features.chat.repository import ChatRepositoryMixin
from app.features.festivals.repository import FestivalRepositoryMixin
from app.features.groups.repository import GroupRepositoryMixin
from app.features.matching.repository import MatchingRepositoryMixin
from app.features.schedules.repository import ScheduleRepositoryMixin


class SupabaseRepository(
    AuthRepositoryMixin,
    FestivalRepositoryMixin,
    GroupRepositoryMixin,
    ChatRepositoryMixin,
    ScheduleRepositoryMixin,
    AlertRepositoryMixin,
    MatchingRepositoryMixin,
):
    """Facade preserving the existing request-scoped repository API."""

    pass


def get_repository(request: Any) -> SupabaseRepository:
    return SupabaseRepository(request.app.state.database)


__all__ = ["RepositoryBase", "RepositoryError", "SupabaseRepository", "get_repository"]
