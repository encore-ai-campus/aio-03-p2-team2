from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone
from typing import Any

import asyncpg

from app.core.repository import RepositoryBase, _hhmm, _iso, _time


class FestivalRepositoryMixin(RepositoryBase):
    async def festival(self, festival_id: str) -> dict | None:
        row = await self._pool().fetchrow("select * from festivals_with_status where id = $1", festival_id)
        if not row:
            return None
        return await self._festival_view(row)

    async def festivals(
        self,
        *,
        year: int | None = None,
        month: int | None = None,
        start_date: date | None = None,
        end_date: date | None = None,
        region: str | None = None,
        category: str | None = None,
        keyword: str | None = None,
        status: str = "all",
    ) -> list[dict]:
        clauses = ["1 = 1"]
        args: list[Any] = []

        def add(clause: str, value: Any) -> None:
            args.append(value)
            clauses.append(clause.replace("?", f"${len(args)}"))

        if year is not None:
            add("extract(year from start_date) = ?", year)
        if month is not None:
            add("extract(month from start_date) = ?", month)
        if start_date is not None:
            add("end_date >= ?", start_date)
        if end_date is not None:
            add("start_date <= ?", end_date)
        if region:
            args.extend([region, region])
            clauses.append(f"(region = ${len(args) - 1} or city = ${len(args)})")
        if category:
            add("category = ?", category)
        if keyword:
            args.extend([f"%{keyword}%", f"%{keyword}%", f"%{keyword}%"])
            clauses.append(f"(name ilike ${len(args) - 2} or coalesce(description, '') ilike ${len(args) - 1} or array_to_string(tags, ' ') ilike ${len(args)})")
        if status == "available":
            clauses.append("end_date >= current_date and risk_status <> 'cancelled'")
        elif status == "past":
            clauses.append("end_date < current_date")
        rows = await self._pool().fetch(
            f"select * from festivals_with_status where {' and '.join(clauses)} order by start_date asc, id asc",
            *args,
        )
        return [await self._festival_view(row) for row in rows]

    async def _festival_view(self, row: asyncpg.Record) -> dict:
        hours = await self._pool().fetch(
            "select date, open_time, close_time, note from festival_operating_hours where festival_id = $1 order by date",
            row["id"],
        )
        return {
            "id": row["id"], "name": row["name"], "region": row["region"], "city": row["city"],
            "startDate": _iso(row["start_date"]), "endDate": _iso(row["end_date"]), "category": row["category"],
            "description": row["description"] or row["overview"] or "", "tags": row["tags"] or [],
            "status": row["status"], "source": "official_api" if row["source_updated_at"] else "manual",
            "sourceUpdatedAt": _iso(row["source_updated_at"]),
            "venue": {"name": row["venue_name"], "address": row["venue_address"], "latitude": row["latitude"], "longitude": row["longitude"]},
            "operatingHours": [{"date": _iso(item["date"]), "open": _hhmm(item["open_time"]), "close": _hhmm(item["close_time"]), "note": item["note"]} for item in hours],
            "riskStatus": row["risk_status"],
        }

    async def upsert_festival(self, data: dict[str, Any]) -> dict:
        festival_id = data.get("id") or f"fst_{datetime.now(timezone.utc).strftime('%y%m%d%H%M%S%f')}"
        venue = data.get("venue") or {}
        source_updated_at = data.get("sourceUpdatedAt")
        if isinstance(source_updated_at, str):
            source_updated_at = datetime.fromisoformat(source_updated_at.replace("Z", "+00:00"))
        source_updated_at = source_updated_at or datetime.now(timezone.utc)
        async with self._pool().acquire() as connection:
            async with connection.transaction():
                await connection.execute(
                    """
                    insert into festivals (id, name, region, city, start_date, end_date, category, description,
                        tags, venue_name, venue_address, latitude, longitude, risk_status, source_updated_at)
                    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
                    on conflict (id) do update set name=excluded.name, region=excluded.region,
                        city=excluded.city, start_date=excluded.start_date, end_date=excluded.end_date,
                        category=excluded.category, description=excluded.description, tags=excluded.tags,
                        venue_name=excluded.venue_name, venue_address=excluded.venue_address,
                        latitude=excluded.latitude, longitude=excluded.longitude,
                        risk_status=excluded.risk_status, source_updated_at=now(), updated_at=now()
                    """,
                    festival_id, data["name"], data["region"], data.get("city"), date.fromisoformat(data["startDate"]), date.fromisoformat(data["endDate"]),
                    data["category"], data.get("description", ""), data.get("tags", []), venue.get("name"), venue.get("address"), venue.get("latitude"), venue.get("longitude"), data.get("riskStatus", "normal"), source_updated_at,
                )
                await connection.execute("delete from festival_operating_hours where festival_id = $1", festival_id)
                for item in data.get("operatingHours", []):
                    await connection.execute(
                        "insert into festival_operating_hours (festival_id, date, open_time, close_time, note) values ($1,$2,$3,$4,$5)",
                        festival_id, date.fromisoformat(item["date"]), _time(item["open"]), _time(item["close"]), item.get("note"),
                    )
        return await self.festival(festival_id)  # type: ignore[return-value]

    async def upsert_weather_forecast(self, festival_id: str, forecast: dict[str, Any]) -> None:
        """Persist the latest daily forecast used by weather synchronization."""
        await self._pool().execute(
            """
            insert into festival_weather_forecasts
                (festival_id, forecast_date, precipitation_probability, weather_code, source, fetched_at)
            values ($1, $2, $3, $4, $5, now())
            on conflict (festival_id, forecast_date) do update set
                precipitation_probability = excluded.precipitation_probability,
                weather_code = excluded.weather_code,
                source = excluded.source,
                fetched_at = now()
            """,
            festival_id,
            date.fromisoformat(forecast["date"]),
            forecast["precipitationProbability"],
            forecast.get("weatherCode"),
            forecast.get("source", "open-meteo"),
        )

    async def create_sync_job(self, kind: str, params: dict, requested_by: str | None = None) -> dict:
        row = await self._pool().fetchrow(
            "insert into external_sync_runs (kind, params, requested_by, status) values ($1,$2::jsonb,$3,'queued') returning *",
            kind, json.dumps(params), requested_by,
        )
        return self._job_view(row)

    async def claim_next_sync_job(self, worker_id: str, *, lease_seconds: int, max_attempts: int) -> dict | None:
        row = await self._pool().fetchrow(
            """
            with candidate as (
                select id
                from external_sync_runs
                where status = 'queued'
                  and (next_attempt_at is null or next_attempt_at <= now())
                  and attempts < least(max_attempts, $2)
                order by created_at asc, id asc
                for update skip locked
                limit 1
            )
            update external_sync_runs as run
               set status = 'running',
                   attempts = run.attempts + 1,
                   max_attempts = least(run.max_attempts, $2),
                   started_at = coalesce(run.started_at, now()),
                   locked_at = now(),
                   worker_id = $1,
                   next_attempt_at = null,
                   error = null
              from candidate
             where run.id = candidate.id
         returning run.*
            """,
            worker_id,
            max_attempts,
        )
        return self._job_view(row) if row else None

    async def requeue_stale_sync_jobs(self, lease_seconds: int) -> int:
        result = await self._pool().execute(
            """
            update external_sync_runs
               set status = case when attempts >= max_attempts then 'failed' else 'queued' end,
                   locked_at = null, worker_id = null, next_attempt_at = null,
                   finished_at = case when attempts >= max_attempts then now() else finished_at end,
                   error = coalesce(error, 'SYNC_LEASE_EXPIRED: Worker lease expired')
             where status = 'running'
               and locked_at is not null
               and locked_at < now() - ($1 * interval '1 second')
            """,
            lease_seconds,
        )
        try:
            return int(result.rsplit(" ", 1)[-1])
        except (TypeError, ValueError):
            return 0

    async def update_sync_job(self, job_id: str, **values: Any) -> dict | None:
        allowed = {
            "status", "accepted", "rejected", "rejections", "error", "started_at", "finished_at",
            "attempts", "max_attempts", "next_attempt_at", "locked_at", "worker_id",
        }
        fields = [(key, value) for key, value in values.items() if key in allowed]
        if fields:
            assignments = []
            args: list[Any] = [job_id]
            for index, (key, value) in enumerate(fields, start=2):
                assignments.append(f"{key} = ${index}" + ("::jsonb" if key == "rejections" else ""))
                if key in {"started_at", "finished_at"} and value == "now()":
                    value = datetime.now(timezone.utc)
                if key == "next_attempt_at" and isinstance(value, str) and value.startswith("delay:"):
                    value = datetime.now(timezone.utc) + timedelta(seconds=float(value.split(":", 1)[1]))
                args.append(json.dumps(value) if key == "rejections" or (key == "error" and isinstance(value, (dict, list))) else value)
            await self._pool().execute(f"update external_sync_runs set {', '.join(assignments)} where id = $1", *args)
        return await self.sync_job(job_id)

    async def sync_job(self, job_id: str) -> dict | None:
        row = await self._pool().fetchrow("select * from external_sync_runs where id = $1", job_id)
        return self._job_view(row) if row else None

    @staticmethod
    def _job_view(row: asyncpg.Record) -> dict:
        return {
            "jobId": row["id"], "status": row["status"], "kind": row["kind"],
            "params": row["params"],
            "accepted": row["accepted"], "rejected": row["rejected"], "rejections": row["rejections"],
            "error": row["error"], "createdAt": _iso(row["created_at"]),
            "startedAt": _iso(row["started_at"]), "finishedAt": _iso(row["finished_at"]),
            "attempts": row["attempts"], "maxAttempts": row["max_attempts"],
            "nextAttemptAt": _iso(row["next_attempt_at"]), "lockedAt": _iso(row["locked_at"]),
            "workerId": row["worker_id"],
        }
