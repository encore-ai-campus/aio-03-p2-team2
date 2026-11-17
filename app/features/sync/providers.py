from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any
from urllib.parse import unquote
import re

import httpx


TOUR_API_URL = "https://apis.data.go.kr/B551011/KorService2/searchFestival2"
TOUR_COMMON_URL = "https://apis.data.go.kr/B551011/KorService2/detailCommon2"
TOUR_INTRO_URL = "https://apis.data.go.kr/B551011/KorService2/detailIntro2"
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


def _tour_source_updated_at(value: Any) -> str:
    """Convert TourAPI's local modifiedtime to an ISO-8601 timestamp."""
    text = str(value or "").strip()
    if len(text) == 14 and text.isdigit():
        try:
            local = datetime.strptime(text, "%Y%m%d%H%M%S").replace(tzinfo=timezone(timedelta(hours=9)))
            return local.astimezone(timezone.utc).isoformat()
        except ValueError:
            pass
    return datetime.now(timezone.utc).isoformat()


def _tour_region_city(item: dict[str, Any]) -> tuple[str, str | None]:
    """Derive display region/city from the address, not addr2's detail address."""
    address_parts = str(item.get("addr1") or "").strip().split()
    region = address_parts[0] if address_parts else str(item.get("areacode") or "unknown").strip()
    city = address_parts[1] if len(address_parts) > 1 else str(item.get("sigungucode") or "").strip() or None
    return region or "unknown", city


def _tour_operating_hours(value: Any, start_date: str, end_date: str) -> list[dict[str, str]]:
    """Only expand unambiguous daily hours; never invent hours for a complex schedule."""
    text = str(value or "").strip()
    match = re.fullmatch(r"(?:매일\s*)?(\d{1,2}):(\d{2})\s*[~～∼〜–-]\s*(\d{1,2}):(\d{2})", text)
    if not match:
        match = re.fullmatch(r"(?:매일\s*)?(\d{1,2})시\s*[~～∼〜–-]\s*(\d{1,2})시", text)
        if not match:
            return []
        opening, closing = (int(match[1]), 0), (int(match[2]), 0)
    else:
        opening, closing = (int(match[1]), int(match[2])), (int(match[3]), int(match[4]))
    if any(not 0 <= hour <= 23 or not 0 <= minute <= 59 for hour, minute in (opening, closing)) or closing <= opening:
        return []
    start, end = date.fromisoformat(start_date), date.fromisoformat(end_date)
    # A broad/annual programme needs explicit per-date hours rather than a guessed calendar.
    if (end - start).days > 366:
        return []
    return [{"date": (start + timedelta(days=offset)).isoformat(),
             "open": f"{opening[0]:02d}:{opening[1]:02d}", "close": f"{closing[0]:02d}:{closing[1]:02d}"}
            for offset in range((end - start).days + 1)]


def tour_item_to_festival(item: dict[str, Any]) -> dict[str, Any]:
    content_id = str(item.get("contentid") or "").strip()
    name = str(item.get("title") or "").strip()
    if not content_id or not name:
        raise SyncProviderError("TOUR_API_RESPONSE_INVALID", "TourAPI item is missing contentid or title")

    start_date = _tour_date(item.get("eventstartdate"), field="eventstartdate")
    end_date = _tour_date(item.get("eventenddate") or item.get("eventstartdate"), field="eventenddate")
    if end_date < start_date:
        raise SyncProviderError("TOUR_API_RESPONSE_INVALID", "TourAPI event dates are reversed")

    address = " ".join(str(part).strip() for part in (item.get("addr1"), item.get("addr2")) if part)
    region, city = _tour_region_city(item)
    hours = _tour_operating_hours(item.get("playtime"), start_date, end_date)
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
        "operatingHours": hours,
        "operatingHoursKnown": bool(hours),
        "riskStatus": "normal",
        "sourceUpdatedAt": _tour_source_updated_at(item.get("modifiedtime") or item.get("modifiedTime")),
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
            payload = await self._get(TOUR_API_URL, request_params)
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
                if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
                    raise TypeError("items.item is not a list")
                for row in rows:
                    enriched = row
                    if params.get("includeDetails"):
                        content_id = str(row.get("contentid") or "").strip()
                        if not content_id:
                            raise SyncProviderError("TOUR_API_RESPONSE_INVALID", "TourAPI item is missing contentid")
                        details = await self.fetch_festival_details(content_id)
                        enriched = {**row, **details}
                    result.append(tour_item_to_festival(enriched))
                total_count = int(body.get("totalCount") or 0)
            except SyncProviderError:
                raise
            except (KeyError, TypeError, ValueError) as exc:
                raise SyncProviderError("TOUR_API_RESPONSE_INVALID", "TourAPI response shape is invalid") from exc
            if not rows or len(result) >= total_count or len(rows) < page_size:
                break
        return result

    async def fetch_festival_details(self, content_id: str, *, content_type_id: int = 15) -> dict[str, Any]:
        """Fetch common and introduction data for one festival content id."""
        if not self.service_key:
            raise SyncProviderError("TOUR_API_KEY_MISSING", "TOUR_API_SERVICE_KEY is not configured")
        base = {
            "serviceKey": unquote(self.service_key),
            "MobileOS": "ETC",
            "MobileApp": "FestaMate",
            "_type": "json",
            "contentId": content_id,
            "numOfRows": 1,
            "pageNo": 1,
        }
        common = await self._get(TOUR_COMMON_URL, base)
        intro_params = {**base, "contentTypeId": content_type_id}
        intro = await self._get(TOUR_INTRO_URL, intro_params)
        return {**self._detail_item(common), **self._detail_item(intro)}

    @staticmethod
    def _detail_item(payload: dict[str, Any]) -> dict[str, Any]:
        try:
            response = payload["response"]
            header = response["header"]
            if str(header.get("resultCode")) != "0000":
                raise SyncProviderError("TOUR_API_REJECTED", str(header.get("resultMsg") or header.get("resultCode")))
            body = response["body"]
            items = body.get("items") or {}
            row = items.get("item", []) if isinstance(items, dict) else []
            if isinstance(row, list):
                return row[0] if row else {}
            if isinstance(row, dict):
                return row
            raise TypeError("detail item is not an object")
        except SyncProviderError:
            raise
        except (KeyError, TypeError, ValueError) as exc:
            raise SyncProviderError("TOUR_API_RESPONSE_INVALID", "TourAPI detail response shape is invalid") from exc

    async def _get(self, url: str, params: dict[str, Any]) -> dict[str, Any]:
        try:
            response = await self.http.get(url, params=params)
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

