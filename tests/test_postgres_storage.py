"""Run against a prepared disposable PostgreSQL DB; never auto-create/drop shared schemas."""
import asyncio
import os
from pathlib import Path

import pytest
import psycopg

from app.core.config import Settings
from app.core.repository import RepositoryError
from app.features.agents.service import AgentService
from app.features.agents.storage import PostgresAgentStorage
from app.features.agents.schemas import RunStart, ResumeRun
from tests.test_agent_workflow import seed, group, USER
from tests.auth_helpers import SECRET, ISSUER, token_headers

DSN=os.environ.get("TEST_AGENT_DATABASE_URL")


@pytest.mark.asyncio
async def test_missing_database_does_not_create_sqlite(tmp_path):
    repo,_=seed()
    config=Settings(_env_file=None,database_url=None,agent_data_dir=tmp_path)
    service=AgentService(repo,config)
    with pytest.raises(RuntimeError,match="DATABASE_URL"):
        await service.open()
    assert not list(tmp_path.glob("*.sqlite*"))


@pytest.mark.asyncio
@pytest.mark.skipif(not DSN,reason="TEST_AGENT_DATABASE_URL is not set")
async def test_postgres_private_schema_and_checkpoint_version():
    from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
    async with await psycopg.AsyncConnection.connect(DSN,autocommit=True) as connection:
        rows=await (await connection.execute("SELECT tablename,rowsecurity FROM pg_tables WHERE schemaname='agent_storage'")).fetchall()
        assert len(rows) == 7 and all(row[1] for row in rows)
        for role in ("anon","authenticated"):
            row=await (await connection.execute("SELECT has_schema_privilege(%s,'agent_storage','USAGE')",(role,))).fetchone()
            assert row[0] is False
        row=await (await connection.execute("SELECT max(v) FROM agent_storage.checkpoint_migrations")).fetchone()
        assert row[0] == len(AsyncPostgresSaver.MIGRATIONS)-1


@pytest.mark.asyncio
@pytest.mark.skipif(not DSN,reason="TEST_AGENT_DATABASE_URL is not set")
async def test_separate_service_instances_share_memory_and_resume_lock():
    repo,_=seed(); g=await group(repo)
    config=Settings(_env_file=None,database_url=DSN)
    first=await AgentService(repo,config).open()
    second=await AgentService(repo,config).open()
    try:
        run=await first.start(USER,RunStart(message="일정 생성",group_id=g["id"]))
        assert (await second.get(USER,run["runId"]))["status"] == "waiting_approval"
        async with first.storage.run_lock(run["runId"]):
            with pytest.raises(RepositoryError) as exc:
                await second.resume(USER,run["runId"],ResumeRun(checkpoint_id=run["checkpointId"],decision="approve"))
            assert exc.value.code == "AGENT_RUN_BUSY"
        result=await second.resume(USER,run["runId"],ResumeRun(checkpoint_id=run["checkpointId"],decision="approve"))
        assert result["status"] == "completed"
        assert (await first.get(USER,run["runId"]))["status"] == "completed"
    finally:
        await first.close(); await second.close()


@pytest.mark.asyncio
@pytest.mark.skipif(not DSN,reason="TEST_AGENT_DATABASE_URL is not set")
async def test_atomic_preference_merges_across_connections():
    storage=await PostgresAgentStorage(Settings(_env_file=None,database_url=DSN)).open()
    try:
        await asyncio.gather(storage.memory.remember(USER,{"avoid_rain":True}),storage.memory.remember(USER,{"travel_style":"여유롭게"}))
        result=await storage.memory.preferences(USER)
        assert result["avoid_rain"] is True and result["travel_style"] == "여유롭게"
    finally: await storage.close()


@pytest.mark.asyncio
@pytest.mark.skipif(not DSN,reason="TEST_AGENT_DATABASE_URL is not set")
async def test_real_repository_http_approval_and_pending_draft():
    from uuid import uuid4
    from datetime import date,timedelta
    import httpx
    from app.main import create_app

    config=Settings(_env_file=None,database_url=DSN,database_required=True,app_env="test",supabase_jwt_secret=SECRET,supabase_jwt_issuer=ISSUER)
    app=create_app(config)
    async with app.router.lifespan_context(app):
        repo=app.state.repository
        subject=await app.state.database.pool.fetchval("select auth_user_id from public.users where id=$1",USER)
        if not subject:
            pytest.skip("HTTP RLS integration requires usr_demo_02 linked to a disposable auth.users account")
        day=(date.today()+timedelta(days=1)).isoformat()
        festival_id="fst_test_"+uuid4().hex[:12]
        claims={"sub":str(subject),"role":"authenticated","app_metadata":{"role":"admin"}}
        context=app.state.database.bind_auth_claims(claims)
        await repo.upsert_festival(dict(id=festival_id,name="격리된 에이전트 통합 시험",region="부산",category="음악",startDate=day,endDate=day,operatingHours=[dict(date=day,open="10:00",close="21:00")]))
        g=await repo.create_group(USER,dict(festivalId=festival_id,title="PostgreSQL 통합 시험",postBody="자동 시험",joinMode="approval",capacity=4))
        app.state.database.reset_auth_claims(context)
        headers=token_headers(sub=str(subject))
        try:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url="http://test") as client:
                response=await client.post("/api/v1/agents/runs",headers=headers,json={"message":"일정 생성","groupId":g["id"]})
                assert response.status_code == 201,response.text
                run=response.json()["data"]
                assert run["status"] == "waiting_approval"
                response=await client.post("/api/v1/agents/runs",headers=headers,json={"message":"다른 일정 생성","groupId":g["id"]})
                assert response.status_code == 409,response.text
                assert response.json()["error"]["code"] == "PROPOSAL_ALREADY_PENDING"
                response=await client.post(f"/api/v1/agents/runs/{run['runId']}/resume",headers=headers,json={"checkpointId":run["checkpointId"],"decision":"approve"})
                assert response.status_code == 200,response.text
                assert response.json()["data"]["status"] == "completed"
                context=app.state.database.bind_auth_claims(claims)
                schedule=await repo.schedule(g["id"])
                assert schedule["version"] == 2 and len(schedule["items"]) == 2
                assert len(await repo.messages(g["id"],before=None,after=None,limit=10)) == 1
                app.state.database.reset_auth_claims(context)
        finally:
            await app.state.database.pool.execute("DELETE FROM groups WHERE id=$1",g["id"])
            await app.state.database.pool.execute("DELETE FROM festivals WHERE id=$1",festival_id)
