from __future__ import annotations

import contextvars
import json
import logging
import re
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
    "festival_weather_forecasts",
)

_auth_claims: contextvars.ContextVar[dict[str, Any] | None] = contextvars.ContextVar(
    "request_auth_claims", default=None
)


def _encode_json(value: Any) -> str:
    # 기존 코드는 json.dumps(...) 한 문자열을 넘기므로 문자열은 그대로 통과시켜 이중 인코딩을 막는다.
    return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)


async def _init_connection(connection: asyncpg.Connection) -> None:
    """jsonb/json 을 Python dict·list 로 주고받도록 등록 (기본값은 문자열이라 .get() 등에서 실패)."""
    for type_name in ("jsonb", "json"):
        await connection.set_type_codec(
            type_name,
            schema="pg_catalog",
            encoder=_encode_json,
            decoder=json.loads,
            format="text",
        )


class _RlsConnection(asyncpg.Connection):
    """풀에 돌려줄 때 RLS 역할·JWT 클레임 초기화를 기본 리셋 쿼리와 한 번에 보낸다 (왕복 1회).

    RESET ALL 은 SET ROLE 을 되돌리지 않으므로 reset role 을 명시한다.
    """

    def get_reset_query(self) -> str:
        return "select set_config('request.jwt.claims', '{}', false);\nreset role;\n" + super().get_reset_query()


class _ScopedAcquire:
    def __init__(self, database: "Database") -> None:
        self.database = database
        self.connection: asyncpg.Connection | None = None

    async def __aenter__(self) -> asyncpg.Connection:
        if self.database.pool is None:
            raise RuntimeError("DATABASE_URL is not configured or the database is unavailable")
        self.connection = await self.database.pool.acquire()
        try:
            await self.database._set_connection_claims(self.connection)
        except BaseException:
            await self.database.pool.release(self.connection)
            self.connection = None
            raise
        return self.connection

    async def __aexit__(self, exc_type: Any, exc: Any, traceback: Any) -> None:
        if self.connection is not None and self.database.pool is not None:
            # 역할·클레임 초기화는 release 시 _RlsConnection 리셋 쿼리에서 함께 처리
            await self.database.pool.release(self.connection)


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

    def bind_auth_claims(self, claims: dict[str, Any]) -> contextvars.Token:
        """Bind JWT claims to this request so PostgreSQL auth.uid() can see them."""

        return _auth_claims.set(claims)

    @staticmethod
    def reset_auth_claims(token: contextvars.Token) -> None:
        _auth_claims.reset(token)

    async def _set_connection_claims(self, connection: asyncpg.Connection) -> None:
        claims = _auth_claims.get()
        role = self.settings.database_authenticated_role if claims else self.settings.database_anon_role
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", role):
            raise RuntimeError("Invalid PostgreSQL RLS role configuration")
        # 역할과 클레임을 한 번의 왕복으로 설정 (set_config('role', …) 은 SET ROLE 과 같다)
        await connection.execute(
            "select set_config('role', $1, false), set_config('request.jwt.claims', $2, false)",
            role,
            json.dumps(claims or {}, separators=(",", ":")),
        )

    def acquire(self) -> _ScopedAcquire:
        return _ScopedAcquire(self)

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
                init=_init_connection,
                connection_class=_RlsConnection,
            )
            check_result = await self.check()
            self.status = check_result["status"]
            self.error = None if self.status == "connected" else "required schema tables are missing"
            logger.info("PostgreSQL connection pool is ready")
            if self.settings.database_required and self.status != "connected":
                raise RuntimeError(self.error)
        except Exception as exc:
            self.status = "error"
            self.error = "Database connection failed; check server configuration"
            if self.pool is not None:
                await self.pool.close()
            self.pool = None
            logger.error("PostgreSQL connection failed (%s)",type(exc).__name__)
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
        async with self.acquire() as connection:
            return await connection.fetch(query, *args)

    async def fetchrow(self, query: str, *args: Any) -> asyncpg.Record | None:
        if self.pool is None:
            raise RuntimeError("DATABASE_URL is not configured or the database is unavailable")
        async with self.acquire() as connection:
            return await connection.fetchrow(query, *args)

    async def fetchval(self, query: str, *args: Any) -> Any:
        if self.pool is None:
            raise RuntimeError("DATABASE_URL is not configured or the database is unavailable")
        async with self.acquire() as connection:
            return await connection.fetchval(query, *args)

    async def execute(self, query: str, *args: Any) -> str:
        if self.pool is None:
            raise RuntimeError("DATABASE_URL is not configured or the database is unavailable")
        async with self.acquire() as connection:
            return await connection.execute(query, *args)


def database_status(database: Database) -> dict[str, Any]:
    return {"status": database.status, "configured": database.enabled, "error": database.error}
