"""PostgreSQL checkpoint pool, schema validation and cross-process resume locks."""
import hashlib
import asyncio
import sys
from contextlib import asynccontextmanager

from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from psycopg.rows import dict_row
from psycopg.conninfo import conninfo_to_dict
from psycopg_pool import AsyncConnectionPool

from app.core.repository import RepositoryError
from .memory import AgentMemory


class PostgresAgentStorage:
    def __init__(self, settings):
        self.settings = settings
        self.pool = None
        # A lock holder still needs another connection for checkpoints and execution metadata.
        self._run_lock_slots = asyncio.BoundedSemaphore(settings.agent_database_pool_max_size - 1)

    async def open(self):
        if not self.settings.database_url:
            raise RuntimeError("에이전트 PostgreSQL 저장소에는 DATABASE_URL이 필요합니다. docs/agent-postgres.md를 확인하세요.")
        if sys.platform == "win32" and isinstance(asyncio.get_running_loop(), asyncio.ProactorEventLoop):
            raise RuntimeError("Windows에서는 uv run python -m app --reload 명령으로 실행해 주세요. psycopg는 Selector 이벤트 루프가 필요합니다.")
        info = conninfo_to_dict(self.settings.database_url)
        if info.get("host", "").endswith("pooler.supabase.com") and info.get("port") == "6543":
            raise RuntimeError("에이전트는 Supabase Direct 또는 Session pooler(5432)를 사용해야 합니다. Transaction pooler(6543)는 사용할 수 없습니다.")

        async def configure(connection):
            # Configure an ordinary session so Supabase Session pooler needs no startup options.
            await connection.execute("SET search_path TO agent_storage,pg_catalog")

        self.pool = AsyncConnectionPool(
            conninfo=self.settings.database_url,
            min_size=1,
            max_size=self.settings.agent_database_pool_max_size,
            open=False,
            configure=configure,
            timeout=self.settings.agent_database_timeout,
            kwargs={
                "autocommit": True,
                "row_factory": dict_row,
                "prepare_threshold": None,
                "connect_timeout": int(self.settings.agent_database_timeout),
            },
        )
        try:
            await self.pool.open(wait=True, timeout=self.settings.agent_database_timeout)
            await self._check_schema()
        except BaseException:
            await self.close()
            raise
        self.memory = AgentMemory(self.pool)
        self.checkpointer = AsyncPostgresSaver(self.pool)
        return self

    async def _check_schema(self):
        tables = ("sessions", "preferences", "executions", "checkpoint_migrations", "checkpoints", "checkpoint_blobs", "checkpoint_writes")
        async with self.pool.connection() as connection:
            for table in tables:
                row = await (await connection.execute("SELECT to_regclass(%s) AS relation", (f"agent_storage.{table}",))).fetchone()
                if row["relation"] is None:
                    raise RuntimeError("에이전트 스키마가 없습니다. DB 담당자가 docs/sql/001_agent_postgres.sql을 먼저 실행해야 합니다.")
            row = await (await connection.execute("SELECT max(v) AS version FROM agent_storage.checkpoint_migrations")).fetchone()
            if row["version"] != len(AsyncPostgresSaver.MIGRATIONS) - 1:
                raise RuntimeError("LangGraph 체크포인터 스키마 버전이 현재 lock과 다릅니다. DB 마이그레이션을 확인하세요.")

    async def close(self):
        if self.pool is not None:
            await self.pool.close()
            self.pool = None

    @asynccontextmanager
    async def run_lock(self, run_id):
        key = int.from_bytes(hashlib.blake2b(run_id.encode(), digest_size=8).digest(), "big", signed=True)
        async with self._run_lock_slots, self.pool.connection() as connection:
            row = await (await connection.execute("SELECT pg_try_advisory_lock(%s) AS acquired", (key,))).fetchone()
            if not row["acquired"]:
                raise RepositoryError("AGENT_RUN_BUSY", "다른 요청이 실행을 재개하고 있습니다. 최신 상태를 조회해 주세요.", 409)
            try:
                yield
            finally:
                try:
                    await connection.execute("SELECT pg_advisory_unlock(%s)", (key,))
                except BaseException:
                    # A pooled connection must never retain an advisory lock.
                    await connection.close()
                    raise
