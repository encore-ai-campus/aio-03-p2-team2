from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from app.core.service import ServiceError


def available(festival: dict) -> bool:
    return festival["endDate"] >= date.today().isoformat() and festival["riskStatus"] != "cancelled"


class FestivalService:
    def __init__(self, repository: Any) -> None:
        self.repository = repository

    async def calendar(self, year: int, month: int, **filters: Any) -> dict:
        festivals = await self.repository.festivals(year=year, month=month, **filters)
        events = []
        for festival in festivals:
            current = date.fromisoformat(festival["startDate"])
            finish = date.fromisoformat(festival["endDate"])
            while current <= finish:
                if current.year == year and current.month == month:
                    events.append({"date": current.isoformat(), "festivalId": festival["id"], "name": festival["name"], "category": festival["category"], "status": festival["status"]})
                current += timedelta(days=1)
        return {"year": year, "month": month, "events": events}

    async def alternatives(self, festival_id: str, limit: int) -> list[dict]:
        source = await self.repository.festival(festival_id)
        if not source:
            raise ServiceError(404, "FESTIVAL_NOT_FOUND", "축제를 찾을 수 없습니다.")
        items = [
            item
            for item in await self.repository.festivals()
            if item["id"] != festival_id
            and available(item)
            and (item["category"] == source["category"] or set(item.get("tags", [])) & set(source.get("tags", [])))
        ]
        items.sort(key=lambda item: abs((date.fromisoformat(item["startDate"]) - date.fromisoformat(source["startDate"])).days))
        return items[:limit]

    async def import_festivals(self, payload: Any) -> dict:
        job = await self.repository.create_sync_job("festival_import", {"count": len(payload.festivals)})
        accepted = 0
        rejected = 0
        rejections = []
        for index, item in enumerate(payload.festivals):
            if item.end_date < item.start_date:
                rejected += 1
                rejections.append({"index": index, "reason": "endDate must be on or after startDate"})
                continue
            await self.repository.upsert_festival(item.model_dump(by_alias=True, mode="json", exclude_none=True))
            accepted += 1
        await self.repository.update_sync_job(job["jobId"], status="succeeded", accepted=accepted, rejected=rejected, rejections=rejections, finished_at="now()")
        return {"jobId": job["jobId"], "accepted": accepted, "rejected": rejected}
