from __future__ import annotations

import logging
from typing import Any

import asyncpg

from app.core.config import Settings

logger = logging.getLogger(__name__)
REQUIRED_TABLES = (
    "users",
    "user_profiles",
    "notification_consents",
    "festivals",
    "festival_operating_hours",
    "groups",
    "group_members",
    "group_join_requests",
    "group_comments",
    "group_messages",
    "group_schedules",
    "schedule_proposals",
    "matching_runs",
    "matching_candidates",
    "alerts",
    "alert_answers",
    "external_sync_runs",
)


class Database:
    """Supabase PostgreSQL connection pool used by the API process.

    The pool is opened during FastAPI startup. Repositories fail explicitly
    with a 503 when it is not configured instead of silently switching to the
    legacy in-memory demo fixture.
    """

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.pool: asyncpg.Pool | None = None
        self.status = "disabled"
        self.error: str | None = None

    @property
    def enabled(self) -> bool:
        return bool(self.settings.database_url)

    async def connect(self) -> None:
        if not self.enabled:
            self.status = "disabled"
            return
        try:
            self.pool = await asyncpg.create_pool(
                dsn=self.settings.database_url,
                min_size=self.settings.database_pool_min_size,
                max_size=self.settings.database_pool_max_size,
                command_timeout=10,
            )
            check_result = await self.check()
            self.status = check_result["status"]
            self.error = None if self.status == "connected" else "required schema tables are missing"
            logger.info("PostgreSQL connection pool is ready")
            if self.settings.database_required and self.status != "connected":
                raise RuntimeError(self.error)
        except Exception as exc:
            self.status = "error"
            self.error = str(exc)
            self.pool = None
            logger.exception("PostgreSQL connection failed")
            if self.settings.database_required:
                raise

    async def close(self) -> None:
        if self.pool is not None:
            await self.pool.close()
            self.pool = None
        if self.enabled and self.status != "error":
            self.status = "closed"

    async def check(self) -> dict[str, Any]:
        if self.pool is None:
            return {"status": self.status, "configured": self.enabled, "error": self.error}
        async with self.pool.acquire() as connection:
            value = await connection.fetchval("select 1")
            rows = await connection.fetch(
                "select table_name from information_schema.tables where table_schema = 'public' and table_name = any($1::text[])",
                list(REQUIRED_TABLES),
            )
        present = {row["table_name"] for row in rows}
        missing = [table for table in REQUIRED_TABLES if table not in present]
        status = "connected" if value == 1 and not missing else "schema_missing"
        return {"status": status, "configured": True, "missingTables": missing}

    async def fetch(self, query: str, *args: Any) -> list[asyncpg.Record]:
        if self.pool is None:
            raise RuntimeError("DATABASE_URL is not configured or the database is unavailable")
        return await self.pool.fetch(query, *args)

    async def execute(self, query: str, *args: Any) -> str:
        if self.pool is None:
            raise RuntimeError("DATABASE_URL is not configured or the database is unavailable")
        return await self.pool.execute(query, *args)


def database_status(database: Database) -> dict[str, Any]:
    return {"status": database.status, "configured": database.enabled, "error": database.error}
