"""Opt-in PostgreSQL checks using temporary tables and rollback only."""
from contextlib import asynccontextmanager
import json
import os
from types import SimpleNamespace

import asyncpg
import pytest

from app.core.repository import RepositoryError
from app.features.alerts.monitor import WeatherMonitor
from app.features.schedules.repository import ScheduleRepositoryMixin

pytestmark = [pytest.mark.asyncio, pytest.mark.skipif(not os.environ.get("TEST_AGENT_DATABASE_URL"), reason="isolated PostgreSQL test URL not configured")]


class SingleConnection:
    def __init__(self, connection): self.connection = connection
    @asynccontextmanager
    async def acquire(self): yield self.connection


class ScheduleRepository(ScheduleRepositoryMixin):
    def __init__(self, connection): self.pool = SingleConnection(connection)
    def _pool(self): return self.pool
    @staticmethod
    def _schedule_view(row, proposals): return dict(row)
    async def schedule(self, group_id):
        row = await self.pool.connection.fetchrow("select * from group_schedules where group_id=$1", group_id)
        return dict(row)


@asynccontextmanager
async def isolated_database():
    connection = await asyncpg.connect(os.environ["TEST_AGENT_DATABASE_URL"], timeout=10)
    transaction = connection.transaction()
    await transaction.start()
    try:
        # All unqualified domain tables resolve to pg_temp, never public data.
        await connection.execute("""
            create temporary table groups (id text primary key,leader_id text,festival_id text,version int,status text,updated_at timestamptz) on commit drop;
            create temporary table group_schedules (group_id text primary key,items jsonb,version int,validation_status text,conflict text,updated_by text,updated_at timestamptz) on commit drop;
            create temporary table schedule_proposals (id text primary key,group_id text,base_version int,items jsonb,strategy text,status text,created_by text,validation jsonb,decided_by text,decided_at timestamptz) on commit drop;
            create temporary table group_members (group_id text,user_id text,left_at timestamptz) on commit drop;
            create temporary table user_profiles (user_id text,available_from time) on commit drop;
            create temporary table festivals (id text,risk_status text,start_date date,end_date date) on commit drop;
            create temporary table group_messages (group_id text,type text,text text,system_event text) on commit drop;
            create temporary table notification_consents (user_id text,risk_alert bool) on commit drop;
            create temporary table alerts (id text default md5(random()::text),user_id text,type text,festival_id text,group_id text,severity text,title text,message text,event_key text,evidence jsonb,is_test bool,unique(user_id,event_key)) on commit drop;
            insert into groups values ('group','leader','old',1,'open',now());
            insert into group_schedules values ('group','[{"date":"2030-01-01","time":"15:00"}]',1,'valid',null,'leader',now());
            insert into group_members values ('group','leader',null),('group','member',null),('group','left',now()),('group','opt-out',null);
            insert into user_profiles values ('leader','15:00'),('member','15:00'),('left','15:00'),('opt-out','15:00');
            insert into notification_consents values ('leader',true),('member',true),('left',true),('opt-out',false);
            insert into festivals values ('target','normal','2030-01-01','2030-01-02');
        """)
        yield connection
    finally:
        await transaction.rollback()
        await connection.close()


@pytest.mark.parametrize("cancel_target", [False, True])
async def test_alternative_commit_uses_one_transaction(cancel_target):
    async with isolated_database() as connection:
        repository = ScheduleRepository(connection)
        plan = {"items":[{"date":"2030-01-01","time":"15:00","endTime":"16:00","label":"축제","description":""}], "targetFestivalId":"target"}
        await repository.save_agent_proposal("group","leader","proposal",plan,1,1)
        assert await connection.fetchval("select festival_id from groups") == "old"
        if cancel_target:
            await connection.execute("update festivals set risk_status='cancelled'")
            with pytest.raises(RepositoryError):
                await repository.commit_agent_proposal("group","proposal","leader",1,1, [
                    {"userId":user,"availableFrom":"15:00","availableUntil":None} for user in ("leader","member","opt-out")])
            assert await connection.fetchval("select festival_id from groups") == "old"
            assert await connection.fetchval("select status from schedule_proposals") == "draft"
        else:
            await repository.commit_agent_proposal("group","proposal","leader",1,1, [
                {"userId":user,"availableFrom":"15:00","availableUntil":None} for user in ("leader","member","opt-out")])
            assert await connection.fetchval("select festival_id from groups") == "target"
            assert await connection.fetchval("select version from group_schedules") == 2
            assert await connection.fetchval("select count(*) from group_messages") == 1
            await repository.commit_agent_proposal("group","proposal","leader",1,1,[])
            assert await connection.fetchval("select count(*) from group_messages") == 1


async def test_weather_sql_only_notifies_consented_active_members_once():
    async with isolated_database() as connection:
        async def invoke(name, state):
            if name == "get_festival": return {"data":{"id":"old"}}
            return {"data":{"precipitationProbability":90,"weatherCode":95},"mode":"live"}
        monitor = WeatherMonitor(SimpleNamespace(pool=SingleConnection(connection)), SimpleNamespace(tools=SimpleNamespace(invoke=invoke)), None)
        assert (await monitor.check("group"))["createdAlertCount"] == 2
        assert (await monitor.check("group"))["createdAlertCount"] == 0
        assert [row["user_id"] for row in await connection.fetch("select user_id from alerts order by user_id")] == ["leader","member"]
        assert all(json.loads(row["evidence"])["mode"] == "live" for row in await connection.fetch("select evidence from alerts"))
