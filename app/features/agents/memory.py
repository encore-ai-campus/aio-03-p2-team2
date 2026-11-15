"""User-owned sessions and preferences in the shared Supabase PostgreSQL database."""
from psycopg.types.json import Jsonb

from app.core.repository import RepositoryError


class AgentMemory:
    def __init__(self, pool):
        self.pool = pool

    async def session(self, session_id, user_id):
        async with self.pool.connection() as connection:
            await connection.execute(
                "INSERT INTO agent_storage.sessions(id,user_id) VALUES (%s,%s) ON CONFLICT(id) DO NOTHING",
                (session_id, user_id),
            )
            row = await (await connection.execute(
                "SELECT user_id,summary,messages,conditions FROM agent_storage.sessions WHERE id=%s", (session_id,)
            )).fetchone()
        if row["user_id"] != user_id:
            raise RepositoryError("SESSION_FORBIDDEN", "다른 사용자의 세션에 접근할 수 없습니다.", 403)
        return {key: row[key] for key in ("summary", "messages", "conditions")}

    async def preferences(self, user_id):
        async with self.pool.connection() as connection:
            row = await (await connection.execute(
                "SELECT value FROM agent_storage.preferences WHERE user_id=%s", (user_id,)
            )).fetchone()
        return row["value"] if row else {}

    async def remember(self, user_id, confirmed):
        # Atomic JSON merge avoids overwriting another request's confirmed preferences.
        async with self.pool.connection() as connection:
            await connection.execute(
                """INSERT INTO agent_storage.preferences(user_id,value) VALUES (%s,%s)
                ON CONFLICT(user_id) DO UPDATE SET value=agent_storage.preferences.value || excluded.value,updated_at=now()""",
                (user_id, Jsonb(confirmed)),
            )

    async def add_run(self, run_id, user_id, session_id, group_id):
        async with self.pool.connection() as connection:
            await connection.execute(
                "INSERT INTO agent_storage.executions(id,user_id,session_id,group_id) VALUES (%s,%s,%s,%s)",
                (run_id, user_id, session_id, group_id),
            )

    async def run(self, run_id, user_id):
        async with self.pool.connection() as connection:
            row = await (await connection.execute(
                "SELECT * FROM agent_storage.executions WHERE id=%s", (run_id,)
            )).fetchone()
        if not row:
            raise RepositoryError("AGENT_RUN_NOT_FOUND", "실행을 찾을 수 없습니다.", 404)
        if row["user_id"] != user_id:
            raise RepositoryError("AGENT_RUN_FORBIDDEN", "다른 사용자의 실행에 접근할 수 없습니다.", 403)
        return row

    async def run_for_proposal(self, proposal_id, user_id):
        async with self.pool.connection() as connection:
            row = await (await connection.execute(
                "SELECT id FROM agent_storage.executions WHERE proposal_id=%s", (proposal_id,)
            )).fetchone()
        if not row:
            raise RepositoryError("AGENT_PROPOSAL_REQUIRED", "에이전트에서 생성한 제안만 이 경로로 승인할 수 있습니다.", 409)
        return await self.run(row["id"], user_id)

    async def update_run(self, state):
        async with self.pool.connection() as connection:
            await connection.execute(
                """UPDATE agent_storage.executions SET status=%s,proposal_id=%s,group_id=%s,updated_at=now()
                WHERE id=%s AND user_id=%s""",
                (state["status"], state.get("proposal_id"), state.get("group_id"), state["run_id"], state["user_id"]),
            )

    async def finish_session(self, state):
        async with self.pool.connection() as connection:
            async with connection.transaction():
                row = await (await connection.execute(
                    "SELECT messages FROM agent_storage.sessions WHERE id=%s AND user_id=%s FOR UPDATE",
                    (state["session_id"], state["user_id"]),
                )).fetchone()
                if not row:
                    raise RepositoryError("SESSION_FORBIDDEN", "세션 소유자를 확인할 수 없습니다.", 403)
                messages = row["messages"] + [
                    {"role": "user", "text": state["message"][:500]},
                    {"role": "assistant", "text": str((state.get("result") or {}).get("summary") or state["status"])[:500]},
                ]
                summary = {"conditions": state["conditions"], "lastIntent": state["intent"], "lastStatus": state["status"]}
                await connection.execute(
                    """UPDATE agent_storage.sessions SET summary=%s,messages=%s,conditions=%s,updated_at=now()
                    WHERE id=%s AND user_id=%s""",
                    (Jsonb(summary), Jsonb(messages[-6:]), Jsonb(state["conditions"]), state["session_id"], state["user_id"]),
                )
