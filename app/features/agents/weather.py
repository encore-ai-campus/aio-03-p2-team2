"""Server-owned meeting windows and shared weather risk policy."""
from datetime import datetime, timedelta

DEFAULT_MEETING_MINUTES = 90
SEVERE_CODES = {65, 67, 75, 77, 82, 85, 86, 95, 96, 99}


def schedule_conditions(items):
    first = items[0]
    day = first["date"]
    same_day = [item for item in items if item["date"] == day]
    return {"date": day, "start_time": min(item["time"] for item in same_day),
            "end_time": max(item.get("endTime") or
                            (datetime.fromisoformat(f"{day}T{item['time']}") + timedelta(minutes=DEFAULT_MEETING_MINUTES)).strftime("%H:%M")
                            for item in same_day)}


def meeting_window(state, festival):
    conditions = state["conditions"]
    day = conditions["date"]
    schedule = (state.get("group") or {}).get("schedule", {})
    items = schedule.get("items") or ([schedule["current"]] if schedule.get("current") else [])
    items = [item for item in items if item["date"] == day]
    saved = schedule_conditions(items) if items else {}
    hours = next((row for row in festival.get("operatingHours", []) if row["date"] == day), {})
    start_time = conditions.get("start_time") or saved.get("start_time") or hours.get("open")
    if not start_time:
        raise ValueError("meeting start time is required")
    start = datetime.fromisoformat(f"{day}T{start_time}")
    if hours.get("open"):
        start = max(start, datetime.fromisoformat(f"{day}T{hours['open']}"))
    # Scheduling can start later when another member is unavailable at the requested time.
    availability = state.get("tool_results", {}).get("get_availability", {}).get("data", [])
    for member in availability:
        if member.get("availableFrom"):
            start = max(start, datetime.fromisoformat(f"{day}T{member['availableFrom']}"))
    end_time = conditions.get("end_time") or (saved.get("end_time") if not conditions.get("start_time") and not availability else None)
    end = datetime.fromisoformat(f"{day}T{end_time}") if end_time else start + timedelta(minutes=DEFAULT_MEETING_MINUTES)
    if end <= start or end.date() != start.date():
        raise ValueError("meeting window must end later on the same day")
    return start, end


def weather_risky(data):
    return data.get("precipitationProbability", 0) >= 60 or data.get("weatherCode") in SEVERE_CODES


def needs_weather_confirmation(data):
    # Light rain also deserves a question, while existing alert thresholds stay unchanged.
    rain_codes = {51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99}
    return weather_risky(data) or data.get("weatherCode") in rain_codes
