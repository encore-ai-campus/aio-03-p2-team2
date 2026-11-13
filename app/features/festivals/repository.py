from __future__ import annotations

import json
from datetime import date, datetime, timezone
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
        async with self._pool().acquire() as connection:
            async with connection.transaction():
                await connection.execute(
                    """
                    insert into festivals (id, name, region, city, start_date, end_date, category, description,
                        tags, venue_name, venue_address, latitude, longitude, risk_status, source_updated_at)
                    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now())
                    on conflict (id) do update set name=excluded.name, region=excluded.region,
                        city=excluded.city, start_date=excluded.start_date, end_date=excluded.end_date,
                        category=excluded.category, description=excluded.description, tags=excluded.tags,
                        venue_name=excluded.venue_name, venue_address=excluded.venue_address,
                        latitude=excluded.latitude, longitude=excluded.longitude,
                        risk_status=excluded.risk_status, source_updated_at=now(), updated_at=now()
                    """,
                    festival_id, data["name"], data["region"], data.get("city"), date.fromisoformat(data["startDate"]), date.fromisoformat(data["endDate"]),
                    data["category"], data.get("description", ""), data.get("tags", []), venue.get("name"), venue.get("address"), venue.get("latitude"), venue.get("longitude"), data.get("riskStatus", "normal"),
                )
                await connection.execute("delete from festival_operating_hours where festival_id = $1", festival_id)
                for item in data.get("operatingHours", []):
                    await connection.execute(
                        "insert into festival_operating_hours (festival_id, date, open_time, close_time, note) values ($1,$2,$3,$4,$5)",
                        festival_id, date.fromisoformat(item["date"]), _time(item["open"]), _time(item["close"]), item.get("note"),
                    )
        return await self.festival(festival_id)  # type: ignore[return-value]

    async def create_sync_job(self, kind: str, params: dict, requested_by: str | None = None) -> dict:
        row = await self._pool().fetchrow(
            "insert into external_sync_runs (kind, params, requested_by) values ($1,$2::jsonb,$3) returning *",
            kind, json.dumps(params), requested_by,
        )
        return self._job_view(row)

    async def update_sync_job(self, job_id: str, **values: Any) -> dict | None:
        allowed = {"status", "accepted", "rejected", "rejections", "error", "started_at", "finished_at"}
        fields = [(key, value) for key, value in values.items() if key in allowed]
        if fields:
            assignments = []
            args: list[Any] = [job_id]
            for index, (key, value) in enumerate(fields, start=2):
                assignments.append(f"{key} = ${index}" + ("::jsonb" if key == "rejections" else ""))
                if key in {"started_at", "finished_at"} and value == "now()":
                    value = datetime.now(timezone.utc)
                args.append(json.dumps(value) if key == "rejections" else value)
            await self._pool().execute(f"update external_sync_runs set {', '.join(assignments)} where id = $1", *args)
        return await self.sync_job(job_id)

    async def sync_job(self, job_id: str) -> dict | None:
        row = await self._pool().fetchrow("select * from external_sync_runs where id = $1", job_id)
        return self._job_view(row) if row else None

    @staticmethod
    def _job_view(row: asyncpg.Record) -> dict:
        return {
            "jobId": row["id"], "status": row["status"], "kind": row["kind"],
            "accepted": row["accepted"], "rejected": row["rejected"], "rejections": row["rejections"],
            "error": row["error"], "acceptedAt": _iso(row["created_at"]),
        }
