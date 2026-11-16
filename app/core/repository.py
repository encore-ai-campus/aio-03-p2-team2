from __future__ import annotations

import json
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


def assert_rpc_success(result: Any) -> dict[str, Any]:
    """Convert a concurrency RPC result into the repository error contract."""
    # asyncpg 는 jsonb 코덱을 따로 등록하지 않으면 jsonb 를 문자열로 돌려준다 → dict 로 변환
    if isinstance(result, (str, bytes)):
        try:
            result = json.loads(result)
        except ValueError:
            result = None
    if not isinstance(result, dict):
        raise RepositoryError("DATABASE_RPC_INVALID", "DB 동시성 처리 결과가 올바르지 않습니다.", 503)
    if not result.get("ok"):
        raise RepositoryError(
            str(result.get("code") or "DATABASE_RPC_FAILED"),
            str(result.get("message") or "DB 동시성 처리가 실패했습니다."),
            int(result.get("status") or 409),
            result.get("details"),
        )
    return result


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

    def _pool(self) -> Database:
        if self.database.pool is None:
            raise RepositoryError("DATABASE_UNAVAILABLE", "데이터베이스에 연결할 수 없습니다.", 503)
        return self.database
