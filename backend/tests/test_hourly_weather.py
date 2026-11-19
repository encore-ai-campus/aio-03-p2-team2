from types import SimpleNamespace

import httpx
import pytest

from app.core.demo_repository import DemoRepository
from app.features.agents.tools import AgentTools, ToolFailure
from app.features.agents.weather import meeting_window, schedule_conditions
from app.features.agents.policy import validate_plan
from app.features.alerts.monitor import WeatherMonitor
from tests.test_connected_workflow import WeatherDatabase


def state():
    return {"conditions": {"date": "2030-01-01", "start_time": "15:30", "end_time": "17:00"},
            "tool_results": {"get_festival": {"data": {"venue": {"latitude": 35.1587, "longitude": 129.1604}}}}}


@pytest.mark.asyncio
@pytest.mark.parametrize("bad", [None, "missing", "null", "retry", "date"])
async def test_hourly_weather_uses_coordinates_and_only_meeting_hours(bad):
    async def respond(request):
        assert request.url.params["latitude"] == "35.1587"
        assert request.url.params["longitude"] == "129.1604"
        assert request.url.params["timezone"] == "Asia/Seoul"
        assert request.url.params["start_hour"] == "2030-01-01T16:00"
        assert request.url.params["end_hour"] == "2030-01-01T17:00"
        if bad in {"retry", "date"}:
            return httpx.Response(429 if bad == "retry" else 400)
        hourly = {"time": ["2030-01-01T10:00", "2030-01-01T16:00", "2030-01-01T17:00"],
                  "precipitation_probability": [100, 10, 20], "weather_code": [95, 1, 2],
                  "wind_speed_10m": [20, 2, 3]}
        if bad == "missing":
            hourly["time"][2] = "2030-01-01T18:00"
        if bad == "null":
            hourly["precipitation_probability"][2] = None
        return httpx.Response(200, json={"hourly": hourly})
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        tools = AgentTools(None, SimpleNamespace(agent_weather_provider="openmeteo"), client)
        if bad:
            with pytest.raises(ToolFailure) as exc:
                await tools.invoke("get_weather", state())
            assert exc.value.code == {"missing": "WEATHER_DATE_UNAVAILABLE", "null": "TOOL_RESPONSE_INVALID",
                                      "retry": "TOOL_NETWORK_ERROR", "date": "WEATHER_DATE_UNAVAILABLE"}[bad]
        else:
            result = await tools.invoke("get_weather", state())
            assert result["mode"] == "live"
            assert result["data"]["precipitationProbability"] == 20
            assert result["data"]["weatherCode"] == 2
            assert result["data"]["windSpeed"] == 3
            assert len(result["data"]["hourly"]) == 2


def test_saved_schedule_and_default_duration_are_used():
    items = [{"date": "2030-01-01", "time": "15:00", "endTime": "15:30"},
             {"date": "2030-01-01", "time": "15:30", "endTime": "17:00"}]
    conditions = schedule_conditions(items)
    assert conditions == {"date": "2030-01-01", "start_time": "15:00", "end_time": "17:00"}
    start, end = meeting_window({"conditions": conditions}, {})
    assert (end - start).total_seconds() == 7200
    start, end = meeting_window({"conditions": {"date": "2030-01-01", "start_time": "15:30"}}, {})
    assert (end - start).total_seconds() == 5400
    start, end = meeting_window({"conditions": {"date": "2030-01-01"},
        "group": {"schedule": {"items": items}},
        "tool_results": {"get_availability": {"data": [{"availableFrom": "18:00"}]}}}, {})
    assert start.strftime("%H:%M") == "18:00"
    assert end.strftime("%H:%M") == "19:30"


@pytest.mark.asyncio
async def test_monitor_passes_entire_schedule_window():
    database = WeatherDatabase()
    database.items = [{"date": "2030-01-01", "time": "15:30", "endTime": "16:00"},
                      {"date": "2030-01-01", "time": "16:00", "endTime": "17:00"}]
    async def invoke(name, request):
        if name == "get_festival":
            return {"data": {"id": "festival"}}
        assert request["conditions"] == {"date": "2030-01-01", "start_time": "15:30", "end_time": "17:00"}
        return {"data": {"precipitationProbability": 20, "weatherCode": 1}, "mode": "live"}
    monitor = WeatherMonitor(database, SimpleNamespace(tools=SimpleNamespace(invoke=invoke)), None)
    assert (await monitor.check("group"))["risk"] is False


@pytest.mark.asyncio
async def test_demo_festivals_keep_real_coordinates():
    repo = DemoRepository()
    for festival in await repo.festivals():
        assert festival["source"] == "demo"
        assert 33 < festival["venue"]["latitude"] < 39
        assert 124 < festival["venue"]["longitude"] < 132


def test_plan_cannot_extend_beyond_checked_weather_window():
    day = "2030-01-01"
    results = {"get_festival": {"data": {"startDate": day, "endDate": day,
        "operatingHours": [{"date": day, "open": "10:00", "close": "21:00"}]}},
        "get_availability": {"data": [{"availableFrom": "13:00"}]},
        "get_weather": {"data": {"startTime": "15:00", "endTime": "16:30"}}}
    errors = validate_plan({"summary": "test", "items": [{"date": day, "time": "15:00",
        "endTime": "18:00", "label": "festival", "description": ""}]},
        {"date": day, "start_time": "15:00"}, results, "scheduling")
    assert "WEATHER_TIME_CONFLICT" in [error["code"] for error in errors]


@pytest.mark.asyncio
async def test_alert_is_not_written_when_schedule_changes_during_weather_fetch():
    from app.core.repository import RepositoryError
    database = WeatherDatabase()
    database.items[0]["endTime"] = "17:00"
    async def invoke(name, request):
        if name == "get_festival":
            return {"data": {"id": "festival"}}
        database.items[0]["endTime"] = "18:00"
        return {"data": {"precipitationProbability": 90, "weatherCode": 95}, "mode": "live"}
    monitor = WeatherMonitor(database, SimpleNamespace(tools=SimpleNamespace(invoke=invoke)), None)
    with pytest.raises(RepositoryError) as exc:
        await monitor.check("group")
    assert exc.value.code == "RESOURCE_VERSION_CONFLICT"
    assert not database.created
