"""Read-only function schemas and server-enforced scope for model tool requests."""
from copy import deepcopy
import json

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .tools import ToolFailure


class FestivalArguments(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    festival_id: str = Field(min_length=1, max_length=100)


class GroupArguments(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    group_id: str = Field(min_length=1, max_length=100)


class WeatherArguments(FestivalArguments):
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")


class SearchArguments(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")


ARGUMENT_MODELS = {
    "get_festival": FestivalArguments,
    "get_availability": GroupArguments,
    "get_candidates": FestivalArguments,
    "get_weather": WeatherArguments,
    "search_festivals": SearchArguments,
}
DESCRIPTIONS = {
    "get_festival": "Read the selected festival's dates, operating hours, venue and cancellation status. Needed before weather lookup.",
    "get_availability": "Read every active member's available times in the current group. Required for scheduling.",
    "get_candidates": "Read up to 50 ranked eligible companions for the selected festival using current matching conditions and the authenticated requester's profile. The current user and candidates unavailable at the requested start time are excluded. Required for matching.",
    "get_weather": "Read hourly weather for the selected festival coordinates and server-owned meeting time window. Call get_festival first. Scheduling should read get_availability first to reflect participant start times. Required for scheduling, risk response and rain-avoidance matching.",
    "search_festivals": "Search alternative festivals for the request date. Required for risk response; optional when alternatives are relevant. Does not change the group's festival.",
}


def allowed_tools(state):
    names = ["get_festival", "get_weather", "search_festivals"]
    if state["intent"] == "scheduling":
        names.append("get_availability")
    elif state["intent"] == "matching":
        names.append("get_candidates")
    return names


def function_definitions(state):
    return [{"type": "function", "name": name, "description": DESCRIPTIONS[name],
             "parameters": deepcopy(ARGUMENT_MODELS[name].model_json_schema()), "strict": True}
            for name in allowed_tools(state)]


def bound_arguments(name, state):
    if name == "get_availability":
        return {"group_id": state.get("group_id")}
    if name == "search_festivals":
        return {"date": state["conditions"].get("date")}
    values = {"festival_id": state.get("festival_id")}
    if name == "get_weather":
        values["date"] = state["conditions"].get("date")
    return values


def validate_tool_request(request, state, results):
    name = request.get("name")
    if name not in allowed_tools(state):
        raise ToolFailure("TOOL_NOT_ALLOWED", "이 요청에서 허용되지 않은 도구입니다.")
    raw = request.get("arguments")
    try:
        if isinstance(raw, str):
            if len(raw) > 2000:
                raise ValueError("arguments too long")
            raw = json.loads(raw)
        values = ARGUMENT_MODELS[name].model_validate(raw).model_dump()
    except (ValueError, TypeError, ValidationError):
        raise ToolFailure("TOOL_ARGUMENTS_INVALID", "도구 인자 스키마를 확인하고 누락·잘못된 값을 수정하세요.") from None
    if values != bound_arguments(name, state):
        raise ToolFailure("TOOL_SCOPE_MISMATCH", "현재 요청의 festival_id·group_id·date와 일치하는 인자를 사용하세요.")
    if name == "get_weather" and "get_festival" not in results:
        raise ToolFailure("TOOL_DEPENDENCY_MISSING", "get_festival을 먼저 조회한 후 날씨를 요청하세요.")
    return values
