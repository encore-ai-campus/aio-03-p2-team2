from __future__ import annotations

import httpx
import pytest

from app.features.sync.providers import TourAPIClient, tour_item_to_festival


def payload(item):
    return {
        "response": {
            "header": {"resultCode": "0000"},
            "body": {"totalCount": 1, "items": {"item": item}},
        }
    }


def item():
    return {
        "contentid": "123",
        "title": "Test Festival",
        "eventstartdate": "20261120",
        "eventenddate": "20261121",
        "addr1": "서울특별시 종로구 세종대로",
        "addr2": "1",
        "mapx": "126.98",
        "mapy": "37.57",
        "modifiedtime": "20261116123456",
    }


def test_tour_item_uses_display_region_and_source_modified_time():
    result = tour_item_to_festival(item())

    assert result["id"] == "fst_tour_123"
    assert result["region"] == "서울특별시"
    assert result["city"] == "종로구"
    assert result["sourceUpdatedAt"] == "2026-11-16T03:34:56+00:00"


@pytest.mark.asyncio
async def test_tour_client_accepts_single_item_response():
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json=payload(item()))

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await TourAPIClient("test-key", http_client=client).fetch_festivals(
            {"startDate": "2026-11-20", "endDate": "2026-11-21", "pageSize": 30, "maxPages": 1}
        )

    assert len(result) == 1
    assert result[0]["id"] == "fst_tour_123"
    assert requests[0].url.params["eventEndDate"] == "20261121"


@pytest.mark.asyncio
async def test_tour_client_can_enrich_rows_with_common_and_intro_details():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("searchFestival2"):
            return httpx.Response(200, json=payload(item()))
        if request.url.path.endswith("detailCommon2"):
            return httpx.Response(200, json=payload({"contentid": "123", "overview": "Detailed overview"}))
        return httpx.Response(200, json=payload({"contentid": "123", "playtime": "10:00~18:00"}))

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        result = await TourAPIClient("test-key", http_client=client).fetch_festivals(
            {"startDate": "2026-11-20", "endDate": "2026-11-21", "pageSize": 1, "maxPages": 1, "includeDetails": True}
        )

    assert result[0]["description"] == "Detailed overview"
