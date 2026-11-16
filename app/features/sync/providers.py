from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any
from urllib.parse import unquote

import httpx


TOUR_API_URL = "https://apis.data.go.kr/B551011/KorService2/searchFestival2"
OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"


class SyncProviderError(Exception):
    """An external provider failure with an explicit retry policy."""

    def __init__(self, code: str, message: str, *, retryable: bool = False) -> None:
        self.code = code
        self.message = message
        self.retryable = retryable
        super().__init__(message)


def _api_date(value: Any, *, field: str) -> date:
    if not isinstance(value, str):
        raise SyncProviderError("SYNC_PARAMETER_INVALID", f"{field} must be YYYY-MM-DD")
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise SyncProviderError("SYNC_PARAMETER_INVALID", f"{field} must be YYYY-MM-DD") from exc


def _tour_date(value: Any, *, field: str) -> str:
    text = str(value or "")
    if len(text) != 8 or not text.isdigit():
        raise SyncProviderError("TOUR_API_RESPONSE_INVALID", f"TourAPI {field} is invalid")
    try:
        return date(int(text[:4]), int(text[4:6]), int(text[6:8])).isoformat()
    except ValueError as exc:
        raise SyncProviderError("TOUR_API_RESPONSE_INVALID", f"TourAPI {field} is invalid") from exc


def _float_or_none(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def tour_item_to_festival(item: dict[str, Any]) -> dict[str, Any]:
    content_id = str(item.get("contentid") or "").strip()
    name = str(item.get("title") or "").strip()
    if not content_id or not name:
        raise SyncProviderError("TOUR_API_RESPONSE_INVALID", "TourAPI item is missing contentid or title")

    start_date = _tour_date(item.get("eventstartdate"), field="eventstartdate")
    end_date = _tour_date(item.get("eventenddate") or item.get("eventstartdate"), field="eventenddate")
    if end_date < start_date:
        raise SyncProviderError("TOUR_API_RESPONSE_INVALID", "TourAPI event dates are reversed")

    address = " ".join(part for part in (item.get("addr1"), item.get("addr2")) if part)
    region = str(item.get("addr1") or item.get("areacode") or "unknown").strip()
    city = str(item.get("addr2") or item.get("sigungucode") or "").strip() or None
    return {
        "id": f"fst_tour_{content_id}",
        "name": name,
        "region": region,
        "city": city,
        "startDate": start_date,
        "endDate": end_date,
        "category": "festival",
        "description": str(item.get("overview") or "").strip(),
        "tags": [],
        "venue": {
            "name": name,
            "address": address or None,
            # TourAPI mapx is longitude and mapy is latitude.
            "latitude": _float_or_none(item.get("mapy")),
            "longitude": _float_or_none(item.get("mapx")),
        },
        "operatingHours": [],
        "riskStatus": "normal",
        "sourceUpdatedAt": datetime.now(timezone.utc).isoformat(),
    }


class TourAPIClient:
    def __init__(self, service_key: str | None, *, http_client: httpx.AsyncClient | None = None, timeout: float = 15) -> None:
        self.service_key = service_key
        self.http = http_client or httpx.AsyncClient(timeout=timeout, follow_redirects=False)
        self.owns_http = http_client is None

    async def close(self) -> None:
        if self.owns_http:
            await self.http.aclose()

    async def fetch_festivals(self, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        if not self.service_key:
            raise SyncProviderError("TOUR_API_KEY_MISSING", "TOUR_API_SERVICE_KEY is not configured")
        params = params or {}
        start = _api_date(params.get("startDate") or date.today().isoformat(), field="startDate")
        end = _api_date(params.get("endDate") or start.isoformat(), field="endDate")
        if end < start:
            raise SyncProviderError("SYNC_PARAMETER_INVALID", "endDate must be on or after startDate")

        try:
            page_size = min(max(int(params.get("pageSize", 100)), 1), 1000)
            max_pages = min(max(int(params.get("maxPages", 100)), 1), 100)
        except (TypeError, ValueError) as exc:
            raise SyncProviderError("SYNC_PARAMETER_INVALID", "pageSize and maxPages must be integers") from exc

        request_params: dict[str, Any] = {
            "serviceKey": unquote(self.service_key),
            "MobileOS": "ETC",
            "MobileApp": "FestaMate",
            "_type": "json",
            "eventStartDate": start.strftime("%Y%m%d"),
            "eventEndDate": end.strftime("%Y%m%d"),
            "numOfRows": page_size,
        }
        for source, target in (("areaCode", "areaCode"), ("sigunguCode", "sigunguCode")):
            if params.get(source) not in (None, ""):
                request_params[target] = params[source]

        result: list[dict[str, Any]] = []
        for page in range(1, max_pages + 1):
            request_params["pageNo"] = page
            payload = await self._get(request_params)
            try:
                response = payload["response"]
                header = response["header"]
                result_code = str(header.get("resultCode"))
                if result_code != "0000":
                    raise SyncProviderError("TOUR_API_REJECTED", str(header.get("resultMsg") or result_code))
                body = response["body"]
                items = body.get("items") or {}
                rows = items.get("item", []) if isinstance(items, dict) else []
                if isinstance(rows, dict):
                    rows = [rows]
                if not isinstance(rows, list):
                    raise TypeError("items.item is not a list")
                result.extend(tour_item_to_festival(row) for row in rows)
                total_count = int(body.get("totalCount") or 0)
            except SyncProviderError:
                raise
            except (KeyError, TypeError, ValueError) as exc:
                raise SyncProviderError("TOUR_API_RESPONSE_INVALID", "TourAPI response shape is invalid") from exc
            if not rows or len(result) >= total_count or len(rows) < page_size:
                break
        return result

    async def _get(self, params: dict[str, Any]) -> dict[str, Any]:
        try:
            response = await self.http.get(TOUR_API_URL, params=params)
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            raise SyncProviderError("TOUR_API_NETWORK_ERROR", "TourAPI network request failed", retryable=True) from exc
        if response.status_code == 429 or response.status_code >= 500:
            raise SyncProviderError("TOUR_API_UNAVAILABLE", "TourAPI is temporarily unavailable", retryable=True)
        if response.status_code != 200:
            raise SyncProviderError("TOUR_API_HTTP_ERROR", f"TourAPI returned HTTP {response.status_code}")
        try:
            return response.json()
        except ValueError as exc:
            raise SyncProviderError("TOUR_API_RESPONSE_INVALID", "TourAPI did not return JSON") from exc


class OpenMeteoClient:
    def __init__(self, *, http_client: httpx.AsyncClient | None = None, timeout: float = 15) -> None:
        self.http = http_client or httpx.AsyncClient(timeout=timeout, follow_redirects=False)
        self.owns_http = http_client is None

    async def close(self) -> None:
        if self.owns_http:
            await self.http.aclose()

    async def fetch_daily(self, latitude: float, longitude: float, day: str) -> dict[str, Any]:
        _api_date(day, field="date")
        try:
            response = await self.http.get(
                OPEN_METEO_URL,
                params={
                    "latitude": latitude,
                    "longitude": longitude,
                    "daily": "precipitation_probability_max,weather_code",
                    "timezone": "Asia/Seoul",
                    "start_date": day,
                    "end_date": day,
                },
            )
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            raise SyncProviderError("WEATHER_NETWORK_ERROR", "Weather API network request failed", retryable=True) from exc
        if response.status_code == 429 or response.status_code >= 500:
            raise SyncProviderError("WEATHER_API_UNAVAILABLE", "Weather API is temporarily unavailable", retryable=True)
        if response.status_code != 200:
            raise SyncProviderError("WEATHER_API_HTTP_ERROR", f"Weather API returned HTTP {response.status_code}")
        try:
            daily = response.json()["daily"]
            index = daily["time"].index(day)
            probability = daily["precipitation_probability_max"][index]
            weather_code = daily["weather_code"][index]
            if not isinstance(probability, (int, float)) or not 0 <= probability <= 100:
                raise ValueError("invalid precipitation probability")
            return {"date": day, "precipitationProbability": probability, "weatherCode": weather_code}
        except (KeyError, TypeError, ValueError, IndexError) as exc:
            raise SyncProviderError("WEATHER_API_RESPONSE_INVALID", "Weather API response shape is invalid") from exc

