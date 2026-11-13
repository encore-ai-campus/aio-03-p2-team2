from __future__ import annotations

from datetime import date, datetime, time, timezone
from typing import Any

import asyncpg

from app.core.database import Database


class RepositoryError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 409, details: Any | None = None) -> None:
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details
        super().__init__(message)


def _time(value: str | time | None) -> time | None:
    if value is None or isinstance(value, time):
        return value
    return time.fromisoformat(value)


def _hhmm(value: Any) -> str | None:
    if value is None:
        return None
    return value.strftime("%H:%M") if hasattr(value, "strftime") else str(value)[:5]


def _iso(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    if isinstance(value, date):
        return value.isoformat()
    return str(value)


class RepositoryBase:
    """Shared database access primitives for domain repositories."""

    def __init__(self, database: Database) -> None:
        self.database = database

    def _pool(self) -> asyncpg.Pool:
        if self.database.pool is None:
            raise RepositoryError("DATABASE_UNAVAILABLE", "데이터베이스에 연결할 수 없습니다.", 503)
        return self.database.pool
