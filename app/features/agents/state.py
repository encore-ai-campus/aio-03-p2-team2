from typing import Any, TypedDict


class AgentState(TypedDict, total=False):
    run_id: str
    session_id: str
    user_id: str
    message: str
    intent: str
    group_id: str | None
    festival_id: str | None
    conditions: dict
    explicit_conditions: dict
    context: dict
    missing: list[str]
    group: dict | None
    tools: list[str]
    tool_results: dict[str, Any]
    candidate: dict | None
    errors: list[dict]
    repair: dict
    iteration: int
    tool_attempts: int
    tool_calls: list[dict]
    approval: str | None
    proposal_id: str | None
    base_version: int | None
    base_group_version: int | None
    status: str
    result: dict | None
    trace: list[dict]
