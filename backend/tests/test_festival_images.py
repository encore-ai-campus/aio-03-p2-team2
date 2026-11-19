"""TourAPI 이미지 URL 저장·응답, 축제 목록 운영시간 일괄 조회."""

from __future__ import annotations

import asyncio
from datetime import date

from app.features.festivals.repository import FestivalRepositoryMixin
from app.features.sync.providers import tour_item_to_festival


def tour_item(**extra):
    return {
        "contentid": "123", "title": "이미지 축제", "eventstartdate": "20261120", "eventenddate": "20261121",
        "addr1": "부산광역시 해운대구", "mapx": "129.16", "mapy": "35.15", "modifiedtime": "20261116123456", **extra,
    }


def test_tour_item_maps_images_and_upgrades_tourapi_http_to_https():
    festival = tour_item_to_festival(tour_item(
        firstimage="http://tong.visitkorea.or.kr/cms/resource/1/a.jpg",
        firstimage2="https://tong.visitkorea.or.kr/cms/resource/1/a_s.jpg",
    ))
    assert festival["imageUrl"] == "https://tong.visitkorea.or.kr/cms/resource/1/a.jpg"
    assert festival["thumbnailUrl"] == "https://tong.visitkorea.or.kr/cms/resource/1/a_s.jpg"


def test_tour_item_without_image_keeps_none():
    festival = tour_item_to_festival(tour_item(firstimage="", firstimage2=None))
    assert festival["imageUrl"] is None and festival["thumbnailUrl"] is None


ROW = {
    "id": "fst_tour_123", "name": "이미지 축제", "region": "부산", "city": "해운대구",
    "start_date": date(2026, 11, 20), "end_date": date(2026, 11, 21), "category": "festival",
    "description": "", "overview": None, "tags": [], "status": "upcoming", "source_updated_at": None,
    "venue_name": None, "venue_address": None, "latitude": None, "longitude": None, "risk_status": "normal",
    "image_url": "https://tong.visitkorea.or.kr/a.jpg", "thumbnail_url": None,
}


class FakePool:
    def __init__(self, rows, hours):
        self.rows, self.hours, self.queries = rows, hours, []

    async def fetch(self, sql, *args):
        self.queries.append(sql)
        return self.hours if "festival_operating_hours" in sql else self.rows


class Repo(FestivalRepositoryMixin):
    def __init__(self, pool):
        self.pool = pool

    def _pool(self):
        return self.pool


def test_festival_list_returns_images_and_queries_hours_once():
    rows = [ROW, {**ROW, "id": "fst_tour_456", "image_url": None}]
    hours = [{"festival_id": "fst_tour_123", "date": date(2026, 11, 20), "open_time": None, "close_time": None, "note": None}]
    pool = FakePool(rows, hours)
    items = asyncio.run(Repo(pool).festivals())
    assert [i["imageUrl"] for i in items] == ["https://tong.visitkorea.or.kr/a.jpg", None]
    assert len(items[0]["operatingHours"]) == 1 and items[1]["operatingHours"] == []
    # 목록 1번 + 운영시간 1번 (축제 수와 무관)
    assert len(pool.queries) == 2
