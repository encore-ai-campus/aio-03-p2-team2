"""Deterministic checks are independent of the generating model."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
import re
from typing import NamedTuple
from zoneinfo import ZoneInfo

from .schemas import Conditions, SCHEDULE_LABEL_MAX_LENGTH, SchedulePlan
from .weather import DEFAULT_MEETING_MINUTES


def today() -> str:
    return datetime.now(timezone(timedelta(hours=9))).date().isoformat()


def minutes(value: str) -> int:
    hour, minute = value.split(":")
    return int(hour) * 60 + int(minute)


def hhmm(value: int) -> str:
    return f"{value // 60:02d}:{value % 60:02d}"


def parse_text(text: str) -> dict:
    values = {}
    dates = re.search(r"\b(20\d{2}-\d{2}-\d{2})\b", text)
    if dates:
        values["date"] = dates[1]
    times = list(re.finditer(r"(?:(오전|오후)\s*)?(\d{1,2})(?::(\d{2})|\s*시(?:\s*(\d{1,2})\s*분)?)", text))
    if times:
        values["start_time"] = hhmm((int(times[0][2]) % 12 + 12 if times[0][1] == "오후" else 0 if times[0][1] == "오전" and int(times[0][2]) == 12 else int(times[0][2])) * 60 + int(times[0][3] or times[0][4] or 0))
    if len(times) > 1:
        match = times[1]
        hour = int(match[2])
        hour = hour % 12 + 12 if match[1] == "오후" else (0 if match[1] == "오전" and hour == 12 else hour)
        values["end_time"] = hhmm(hour * 60 + int(match[3] or match[4] or 0))
    budget = re.search(r"(\d+)\s*만\s*원", text)
    if budget:
        values["budget_manwon"] = int(budget[1])
    party = re.search(r"([2-8])\s*명", text)
    if party:
        values["party_size"] = int(party[1])
    age = re.search(r"(?<!\d)(10|20|30|40|50)\s*대(?!\d)", text)
    if age:
        values["age_band"] = age[1] + "대"
    if re.search(r"성별\s*(?:상관\s*없|무관|관계\s*없)", text):
        values["gender_preference"] = "any"
    elif re.search(r"동성\s*(?:만|끼리)|같은\s*성별\s*만", text):
        values["gender_preference"] = "only_same"
    elif re.search(r"동성\s*선호|같은\s*성별\s*선호", text):
        values["gender_preference"] = "same"
    if "실내" in text:
        values["indoor_only"] = True
    if "야외도" in text or "실내만 아니어도" in text:
        values["indoor_only"] = False
    if "비" in text and any(word in text for word in ("피해", "피하", "싫", "없는")):
        values["avoid_rain"] = True
    try:
        return Conditions.model_validate(values).model_dump(mode="json", exclude_none=True)
    except ValueError:
        return {}  # The input node will ask for validated structured conditions.


def infer_intent(message: str) -> str:
    if any(word in message for word in ("취소", "대체", "위험")):
        return "risk_response"
    if any(word in message for word in ("매칭", "동행 추천", "동행 찾아")):
        return "matching"
    return "scheduling"


def required_tools(state: dict) -> list[str]:
    """Minimum evidence required before generation, not the OpenAI execution plan."""
    if state["intent"] == "risk_response":
        return ["get_festival", "get_weather", "search_festivals"]
    if state["intent"] == "matching":
        tools = ["get_festival", "get_candidates"]
        if state["conditions"].get("avoid_rain"):
            tools.append("get_weather")
        return tools
    return ["get_festival", "get_availability", "get_weather"]


def error(code: str, message: str, **details) -> dict:
    return {"code": code, "message": message, "details": details}


class ScheduleWindow(NamedTuple):
    available: tuple[str, str]
    forecast: tuple[str, str] | None

    @property
    def allowed(self) -> tuple[str, str]:
        start, end = self.available
        if self.forecast:
            start = max(start, self.forecast[0])
            end = min(end, self.forecast[1])
        return start, end


def schedule_window(conditions: dict, results: dict) -> tuple[ScheduleWindow | None, dict | None]:
    festival = results.get("get_festival", {}).get("data") or {}
    hours = next((row for row in festival.get("operatingHours", []) if row["date"] == conditions.get("date")), None)
    if not hours or not hours.get("open") or not hours.get("close"):
        return None, error("OPERATING_HOURS_MISSING", "해당 날짜의 운영시간을 확인해야 합니다.")

    availability = results.get("get_availability", {}).get("data", [])
    if not availability or any(not row.get("availableFrom") for row in availability):
        return None, error("AVAILABILITY_MISSING", "모든 참여자의 가능 시간이 필요합니다.")

    earliest = max(hours["open"], conditions.get("start_time") or "00:00", *(row["availableFrom"] for row in availability))
    latest = min(hours["close"], conditions.get("end_time") or "23:59", *(row.get("availableUntil") or "23:59" for row in availability))
    weather = results.get("get_weather", {}).get("data") or {}
    forecast_start, forecast_end = weather.get("startTime"), weather.get("endTime")
    if bool(forecast_start) != bool(forecast_end):
        return None, error("TOOL_RESPONSE_INVALID", "조회한 예보의 시작·종료 시간을 확인해야 합니다.")
    forecast = (forecast_start, forecast_end) if forecast_start and forecast_end else None
    if forecast is None and not conditions.get("end_time"):
        latest = hhmm(min(minutes(latest), minutes(earliest) + DEFAULT_MEETING_MINUTES))
    window = ScheduleWindow((earliest, latest), forecast)
    start, end = window.allowed
    if start >= end:
        return None, error("SCHEDULE_WINDOW_EMPTY", "운영시간, 참여 가능 시간, 예보 시간대가 겹치지 않습니다. 모임 시간을 확인해 주세요.",
                           earliest=start, latest=end)
    return window, None


def validate_plan(candidate: dict | None, conditions: dict, results: dict, intent: str) -> list[dict]:
    try:
        return _validate_plan(candidate,conditions,results,intent)
    except (TypeError,KeyError,ValueError,AttributeError):
        return [error("TOOL_RESPONSE_INVALID","조회 데이터의 날짜·시간·조건 형식을 확인해야 합니다.")]


def _validate_plan(candidate: dict | None, conditions: dict, results: dict, intent: str) -> list[dict]:
    festival = results.get("get_festival", {}).get("data") or {}
    errors = []
    if intent != "risk_response" and (not festival or festival.get("endDate", "") < conditions.get("date", today()) or festival.get("startDate", "") > conditions.get("date", today()) or festival.get("riskStatus") == "cancelled"):
        errors.append(error("FESTIVAL_UNAVAILABLE", "축제 기간 또는 취소 상태를 확인해야 합니다."))
    if intent != "risk_response" and conditions.get("indoor_only") and festival.get("venueType") != "indoor":
        errors.append(error("VENUE_UNCONFIRMED", "실내 조건을 충족하는 장소 정보가 필요합니다."))
    weather = results.get("get_weather", {}).get("data")
    if intent != "risk_response" and conditions.get("avoid_rain") and festival.get("venueType") != "indoor" and weather and weather.get("precipitationProbability", 0) >= 60:
        errors.append(error("WEATHER_RISK", "비를 피하려는 조건과 예보가 충돌합니다."))
    if intent != "scheduling":
        if not candidate or candidate.get("kind") != intent:
            errors.append(error("CANDIDATE_INVALID", "추천 결과 형식이 올바르지 않습니다."))
        elif intent == "matching":
            known = {user["id"]:user for user in results.get("get_candidates",{}).get("data",[])}
            for item in candidate.get("items",[]):
                user = known.get(item.get("user",{}).get("id"))
                if not user:
                    errors.append(error("UNGROUNDED_CANDIDATE","도구 결과에 없는 사용자입니다."))
                elif conditions.get("start_time") and user.get("profile",{}).get("availableFrom") and user["profile"]["availableFrom"] > conditions["start_time"]:
                    errors.append(error("TIME_CONFLICT","후보자의 시작 가능 시간이 맞지 않습니다."))
        else:
            known = {row["id"] for row in results.get("search_festivals",{}).get("data",[])}
            if any(row.get("id") not in known or row.get("id") == festival.get("id") or row.get("riskStatus") == "cancelled" for row in candidate.get("items",[])):
                errors.append(error("UNGROUNDED_CANDIDATE","조회 결과에 없는 대체 축제이거나 이용할 수 없는 후보입니다."))
        return errors
    try:
        plan = SchedulePlan.model_validate(candidate)
    except ValueError:
        return errors + [error("CANDIDATE_INVALID", "일정 항목 형식이 올바르지 않습니다.")]
    target_date = conditions["date"]
    window, window_error = schedule_window(conditions, results)
    if window_error:
        return errors + [window_error]
    lower, upper = window.available
    allowed_start, allowed_end = window.allowed
    previous_end = None
    for item in plan.items:
        if window.forecast and (item.time < window.forecast[0] or item.end_time > window.forecast[1]):
            errors.append(error("WEATHER_TIME_CONFLICT", "일정이 확인한 예보 시간대를 벗어났습니다. 모임 시작·종료 시간을 확인해 주세요.",
                                earliest=allowed_start, latest=allowed_end))
        if item.date.isoformat() != target_date:
            errors.append(error("DATE_MISMATCH", "요청 날짜를 벗어났습니다.", expected=target_date))
        if item.time < lower or item.end_time > upper:
            errors.append(error("TIME_CONFLICT", "참여 시간 또는 운영시간을 벗어났습니다.", earliest=lower, latest=upper))
        if item.time >= item.end_time or (previous_end and item.time < previous_end):
            errors.append(error("TIMELINE_ORDER", "일정의 시간 순서가 올바르지 않습니다."))
        previous_end = item.end_time
    return errors


def rules_plan(conditions: dict, results: dict, window: ScheduleWindow | None = None) -> dict:
    if window is None:
        window, _ = schedule_window(conditions, results)
    if window is None:
        return {"summary": "조건을 만족하는 시간이 없습니다.", "items": []}
    festival = results["get_festival"]["data"]
    name = festival.get("name")
    label = name[:SCHEDULE_LABEL_MAX_LENGTH] if isinstance(name, str) and name else "축제 관람"
    allowed_start, allowed_end = window.allowed
    start = minutes(allowed_start)
    end = min(start + DEFAULT_MEETING_MINUTES, minutes(allowed_end))
    if end <= start + 30:
        return {"summary": "참여 가능 시간에 맞춘 축제 관람", "items": [
            {"date": conditions["date"], "time": hhmm(start), "endTime": hhmm(end), "label": label, "description": "축제를 관람합니다."}]}
    return {"summary": "참여 가능 시간과 운영시간을 반영한 공동 일정", "items": [
        {"date": conditions["date"], "time": hhmm(start), "endTime": hhmm(start+30), "label": "모임 참석자 확인", "description": "축제 장소에서 참석자를 확인합니다."},
        {"date": conditions["date"], "time": hhmm(start+30), "endTime": hhmm(end), "label": label, "description": "확인한 운영시간 안에서 축제를 관람합니다."},
    ]}
