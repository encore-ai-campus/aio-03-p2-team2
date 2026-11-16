"""Server-owned polling; models and clients cannot choose alert recipients."""
import asyncio
from contextlib import suppress
from datetime import datetime, timedelta, timezone
import json
import logging

from app.core.repository import RepositoryError
from app.features.agents.tools import ToolFailure, observed

logger = logging.getLogger(__name__)


class WeatherMonitor:
    def __init__(self, database, agents, settings):
        self.database, self.agents, self.settings = database, agents, settings
        self.task = None

    def start(self):
        if self.database.pool is not None and self.settings.agent_weather_provider == "openmeteo" and self.settings.weather_monitor_interval_seconds:
            self.task = asyncio.create_task(self.run())

    async def close(self):
        if self.task:
            self.task.cancel()
            with suppress(asyncio.CancelledError):
                await self.task

    async def targets(self):
        today = datetime.now(timezone(timedelta(hours=9))).date()
        # Internal worker uses the server pool; public HTTP APIs retain JWT/RLS.
        async with self.database.pool.acquire() as connection:
            return await connection.fetch("""select g.id from groups g join group_schedules s on s.group_id=g.id
                where g.status in ('open','full') and jsonb_array_length(s.items)>0
                and s.items->0->>'date' between $1 and $2 order by g.id""",
                today.isoformat(), (today+timedelta(days=15)).isoformat())

    async def check(self, group_id, *, simulate=False):
        if simulate and self.settings.app_env not in {"development", "local", "test"}:
            raise RepositoryError("SIMULATION_DEVELOPMENT_ONLY", "악천후 모의 테스트는 개발 환경에서만 가능합니다.", 403)
        if self.database.pool is None:
            raise RepositoryError("DATABASE_REQUIRED", "날씨 알림에는 DB 연결이 필요합니다.", 503)
        async with self.database.pool.acquire() as connection:
            row = await connection.fetchrow("""select g.festival_id,s.items from groups g
                join group_schedules s on s.group_id=g.id where g.id=$1 and g.status in ('open','full')""", group_id)
        if not row:
            raise RepositoryError("GROUP_NOT_AVAILABLE", "진행 중인 모임을 찾을 수 없습니다.", 404)
        items = json.loads(row["items"]) if isinstance(row["items"], str) else row["items"]
        if not items:
            raise RepositoryError("SCHEDULE_MISSING", "날씨를 확인할 일정이 없습니다.", 409)
        day = items[0]["date"]
        state = dict(festival_id=row["festival_id"], conditions={"date":day}, tool_results={})
        state["tool_results"]["get_festival"] = await self.agents.tools.invoke("get_festival", state)
        weather = observed("development_weather_simulation", {"date":day,"precipitationProbability":90,"weatherCode":95}, mode="simulation") if simulate else await self.agents.tools.invoke("get_weather", state)
        data = weather["data"]
        risky = data.get("precipitationProbability", 0) >= 60 or data.get("weatherCode") in {65,67,75,77,82,85,86,95,96,99}
        created = []
        if risky and (weather["mode"] == "live" or simulate):
            event_key = f"{'weather-test' if simulate else 'weather'}:{group_id}:{row['festival_id']}:{day}"
            async with self.database.pool.acquire() as connection:
                async with connection.transaction():
                    group = await connection.fetchrow("select festival_id from groups where id=$1 and status in ('open','full') for update", group_id)
                    schedule = await connection.fetchrow("select items from group_schedules where group_id=$1 for share", group_id)
                    latest = json.loads(schedule["items"]) if schedule and isinstance(schedule["items"], str) else schedule["items"] if schedule else []
                    if not group or group["festival_id"] != row["festival_id"] or not latest or latest[0]["date"] != day:
                        raise RepositoryError("RESOURCE_VERSION_CONFLICT", "모임 일정이 변경되었습니다. 다시 확인해 주세요.", 409)
                    created = await connection.fetch("""insert into alerts
                        (user_id,type,festival_id,group_id,severity,title,message,event_key,evidence,is_test)
                        select gm.user_id,'rain',$2,$1,'warning',$5,
                        '참여 예정일에 악천후가 예보되었습니다. 대체 축제를 확인할 수 있습니다.',$3,$4::jsonb,$6
                        from group_members gm join notification_consents n on n.user_id=gm.user_id
                        where gm.group_id=$1 and gm.left_at is null and n.risk_alert=true
                        on conflict (user_id,event_key) do nothing returning id""",
                        group_id, row["festival_id"], event_key, json.dumps(weather, ensure_ascii=False),
                        "[테스트] 악천후 알림" if simulate else "악천후 예보를 확인해 주세요", simulate)
        return {"groupId":group_id, "date":day, "risk":risky, "weather":weather,
            "createdAlertCount":len(created), "isTest":simulate, "nextAction":"risk-response" if risky else None}

    async def run(self):
        while True:
            try:
                for row in await self.targets():
                    try:
                        await self.check(row["id"])
                    except (ToolFailure, RepositoryError) as exc:
                        logger.info("Weather check skipped: %s", exc.code)
            except Exception:
                logger.exception("Weather monitoring cycle failed")
            await asyncio.sleep(self.settings.weather_monitor_interval_seconds)
