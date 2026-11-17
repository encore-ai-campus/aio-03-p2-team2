from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
import math

from .weather import meeting_window, SEVERE_CODES
import json
from urllib.parse import unquote

import httpx


class ToolFailure(Exception):
    def __init__(self, code: str, message: str, retryable: bool = False):
        self.code, self.message, self.retryable = code, message, retryable
        super().__init__(message)


def observed(source: str, data, *, mode: str = "repository", url: str | None = None):
    return {"data": data, "source": source, "mode": mode, "url": url, "fetchedAt": datetime.now(timezone.utc).isoformat()}


class AgentTools:
    """Only server-owned tools are callable; model content cannot introduce URLs/SQL."""
    def __init__(self, repository, settings, http_client=None):
        self.repository = repository
        self.settings = settings
        self.http = http_client or httpx.AsyncClient(timeout=15, follow_redirects=False)
        self.owns_http = http_client is None

    async def close(self):
        if self.owns_http:
            await self.http.aclose()

    async def invoke(self, name: str, state: dict):
        if name not in {"get_festival", "get_availability", "get_candidates", "get_weather", "search_festivals"}:
            raise ToolFailure("TOOL_NOT_ALLOWED", "허용되지 않은 조회 도구입니다.")
        try:
            return await getattr(self, name)(state)
        except ToolFailure:
            raise
        except (httpx.TimeoutException, httpx.TransportError):
            raise ToolFailure("TOOL_NETWORK_ERROR", f"{name} 도구의 네트워크 연결에 실패했습니다.", True) from None
        except (ValueError, KeyError, TypeError, IndexError, AttributeError):
            raise ToolFailure("TOOL_RESPONSE_INVALID", f"{name} 도구 결과 형식을 확인해야 합니다.") from None

    async def get_festival(self, state):
        item = await self.repository.festival(state["festival_id"])
        if not item:
            raise ToolFailure("FESTIVAL_UNAVAILABLE", "축제를 찾을 수 없습니다.")
        item = dict(item)
        item["description"] = item.get("description", "")[:500]
        item.setdefault("venueType", "indoor" if "실내" in item.get("tags", []) else "outdoor" if "야외" in item.get("tags", []) else "unknown")
        return observed("festival_repository", item, mode="demo" if item.get("source") == "demo" else "repository")

    async def get_availability(self, state):
        group = await self.repository.group(state["group_id"])
        if not group:
            raise ToolFailure("GROUP_NOT_FOUND", "모임을 찾을 수 없습니다.")
        rows = []
        for member in group["members"]:
            user = await self.repository.user(member["userId"])
            profile = (user or {}).get("profile", {})
            rows.append({"userId": member["userId"], "availableFrom": profile.get("availableFrom"), "availableUntil": profile.get("availableUntil")})
        return observed("member_profiles", rows, mode=getattr(self.repository, "mode", "database"))

    async def get_candidates(self, state):
        from app.features.matching.service import rank_candidates
        from .schemas import Conditions
        users = await self.repository.users(exclude_id=state["user_id"])
        conditions = Conditions.model_validate(state["conditions"]).model_dump(mode="json", by_alias=True, exclude_none=True)
        # Rank the complete candidate pool before bounding model-visible facts. A strong
        # candidate after row 50 must not disappear only from the agent's results.
        ranked = rank_candidates(conditions, users, state.get("requester"), top_k=50)
        by_id = {user["id"]: user for user in users}
        return observed("user_profiles", [by_id[item["user"]["id"]] for item in ranked], mode=getattr(self.repository,"mode","database"))

    async def get_weather(self, state):
        if self.settings.agent_weather_provider == "demo":
            return observed("demo_weather_fixture", {"date":state["conditions"]["date"],"precipitationProbability":20,"weatherCode":1}, mode="demo")
        festival = state["tool_results"]["get_festival"]["data"]
        venue = festival.get("venue", {})
        if venue.get("latitude") is None or venue.get("longitude") is None:
            raise ToolFailure("WEATHER_LOCATION_MISSING", "날씨 조회에 필요한 축제 좌표가 없습니다.")
        day = state["conditions"]["date"]
        try:
            latitude, longitude = float(venue["latitude"]), float(venue["longitude"])
            if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
                raise ValueError()
        except (ValueError, TypeError):
            raise ToolFailure("WEATHER_LOCATION_MISSING", "유효한 축제 위도·경도가 필요합니다.") from None
        try:
            start, end = meeting_window(state, festival)
        except ValueError:
            raise ToolFailure("WEATHER_TIME_MISSING", "날씨를 확인할 같은 날짜의 모임 시작·종료 시간을 확인해 주세요.") from None
        # Precipitation probability describes the PRECEDING hour. For 15:30–17:00,
        # use the intervals ending at 16:00 and 17:00, not the one ending at 15:00.
        first = start.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
        last = end.replace(minute=0, second=0, microsecond=0)
        if end.minute:
            last += timedelta(hours=1)
        expected = []
        stamp = first
        while stamp <= last:
            expected.append(stamp.isoformat(timespec="minutes"))
            stamp += timedelta(hours=1)
        response = await self.http.get("https://api.open-meteo.com/v1/forecast", params={
            "latitude": latitude, "longitude": longitude,
            "hourly": "precipitation_probability,weather_code,wind_speed_10m",
            "wind_speed_unit": "ms", "timezone": "Asia/Seoul",
            "start_hour": expected[0], "end_hour": expected[-1]})
        if response.status_code >= 500 or response.status_code == 429:
            raise ToolFailure("TOOL_NETWORK_ERROR", "기상 API가 일시적으로 응답하지 않습니다.", True)
        if response.status_code != 200:
            raise ToolFailure("WEATHER_DATE_UNAVAILABLE", "해당 시간의 예보를 조회할 수 없습니다. 예보 가능 범위의 날짜를 선택해 주세요.")
        hourly = response.json()["hourly"]
        rows = []
        for stamp in expected:
            if stamp not in hourly["time"]:
                raise ToolFailure("WEATHER_DATE_UNAVAILABLE", "모임 시간 전체의 예보가 아직 제공되지 않습니다.")
            index = hourly["time"].index(stamp)
            probability = hourly["precipitation_probability"][index]
            code = hourly["weather_code"][index]
            wind = hourly["wind_speed_10m"][index]
            if (not isinstance(probability, (int, float)) or not 0 <= probability <= 100
                    or not isinstance(code, int) or code < 0
                    or not isinstance(wind, (int, float)) or not math.isfinite(wind) or wind < 0):
                raise ToolFailure("TOOL_RESPONSE_INVALID", "모임 시간대의 날씨 데이터가 누락되었거나 잘못되었습니다.")
            rows.append({"time": stamp, "precipitationProbability": probability, "weatherCode": code, "windSpeed": wind})
        codes = [row["weatherCode"] for row in rows]
        return observed("Open-Meteo", {"date": day, "startTime": start.strftime("%H:%M"),
            "endTime": end.strftime("%H:%M"), "timezone": "Asia/Seoul",
            "latitude": latitude, "longitude": longitude,
            "precipitationProbability": max(row["precipitationProbability"] for row in rows),
            "weatherCode": max((code for code in codes if code in SEVERE_CODES), default=max(codes)),
            "windSpeed": max(row["windSpeed"] for row in rows), "windSpeedUnit": "m/s",
            "hourly": rows}, mode="live", url="https://api.open-meteo.com/v1/forecast")

    async def search_festivals(self, state):
        if not self.settings.tour_api_service_key:
            rows = await self.repository.festivals(start_date=None, end_date=None)
            return observed("festival_repository", rows[:30], mode=getattr(self.repository,"mode","database"))
        day = state["conditions"]["date"].replace("-", "")
        response = await self.http.get("https://apis.data.go.kr/B551011/KorService2/searchFestival2", params={"serviceKey":unquote(self.settings.tour_api_service_key.get_secret_value()),"MobileOS":"ETC","MobileApp":"FestaMate","_type":"json","eventStartDate":day,"numOfRows":30,"pageNo":1})
        if response.status_code >= 500 or response.status_code == 429:
            raise ToolFailure("TOOL_NETWORK_ERROR", "축제 API가 일시적으로 응답하지 않습니다.", True)
        if response.status_code != 200:
            raise ToolFailure("TOOL_CONFIGURATION_MISSING", "축제 API 키와 이용 설정을 확인해야 합니다.")
        payload = response.json()["response"]
        if payload["header"]["resultCode"] != "0000":
            raise ToolFailure("TOOL_CONFIGURATION_MISSING", "축제 API가 요청을 거절했습니다.")
        items = payload["body"].get("items") or {}
        rows = items.get("item", []) if isinstance(items, dict) else []
        def iso(value):
            value = str(value)
            return f"{value[:4]}-{value[4:6]}-{value[6:8]}"
        return observed("Korea Tourism Organization TourAPI", [{"id":str(row["contentid"]),"name":row["title"],"region":str(row.get("areacode","")),"startDate":iso(row["eventstartdate"]),"endDate":iso(row["eventenddate"]),"category":"festival","tags":[],"riskStatus":"normal","source":"official_api"} for row in rows], mode="live", url="https://apis.data.go.kr/B551011/KorService2/searchFestival2")
