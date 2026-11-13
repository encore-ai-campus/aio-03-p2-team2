from __future__ import annotations

import re

from fastapi import APIRouter, Header, Query, Request

from app.core.api import APIError, success
from app.core.repositories import SupabaseRepository, get_repository
from app.core.schemas import MatchingParseRequest, MatchingRunRequest

router = APIRouter(prefix="/matching", tags=["matching"])


async def require_demo(value: str | None, repository: SupabaseRepository) -> str:
    if not value or not await repository.user(value):
        raise APIError(400, "DEMO_USER_INVALID", "유효한 X-Demo-User-Id가 필요합니다.")
    return value


def parse_slots(text: str, festivals: list[dict]) -> dict:
    draft = {"festivalId": None, "startTime": None, "budgetManwon": None, "interests": [], "travelStyle": None, "preferredMbti": [], "partySize": None, "joinMode": None}
    for festival in festivals:
        if festival["name"] in text or festival["region"] in text or festival["category"] in text:
            draft["festivalId"] = festival["id"]
            break
    time_match = re.search(r"(?:오후\s*)?(\d{1,2})\s*시", text)
    if time_match:
        hour = int(time_match.group(1))
        if "오후" in text and hour < 12:
            hour += 12
        draft["startTime"] = f"{hour:02d}:00"
    budget_match = re.search(r"(\d+)\s*만\s*원", text)
    if budget_match:
        draft["budgetManwon"] = int(budget_match.group(1))
    interests = {tag for festival in festivals for tag in festival.get("tags", [])} | {"미식", "사진", "문화", "공연"}
    draft["interests"] = [interest for interest in interests if interest in text]
    if "여유롭게" in text:
        draft["travelStyle"] = "여유롭게"
    elif "활동적으로" in text:
        draft["travelStyle"] = "활동적으로"
    if "즉시" in text:
        draft["joinMode"] = "instant"
    elif "승인" in text:
        draft["joinMode"] = "approval"
    missing = [key for key, value in (("festivalId", draft["festivalId"]), ("startTime", draft["startTime"]), ("budgetManwon", draft["budgetManwon"]), ("partySize", draft["partySize"])) if value is None]
    return {"draft": draft, "missingSlots": missing, "confidence": round(max(0.4, 1 - len(missing) * 0.12), 2), "parserVersion": "match-slot-v1"}


def candidate(conditions: dict, user: dict) -> dict:
    profile = user["profile"]
    weights = {"schedule": 25, "interests": 20, "budget": 20, "style": 15, "mbti": 10, "partySize": 10}
    parts = {}
    available = profile.get("availableFrom") or "23:59"
    desired = conditions.get("startTime") or "00:00"
    parts["schedule"] = {"score": weights["schedule"] if available <= desired else round(weights["schedule"] * 0.4), "max": weights["schedule"]}
    matches = set(conditions.get("interests") or []) & set(profile.get("interests") or [])
    parts["interests"] = {"score": round(weights["interests"] * len(matches) / max(1, len(conditions.get("interests") or []))), "max": weights["interests"]}
    budget = conditions.get("budgetManwon")
    budget_score = weights["budget"] if budget is None or profile.get("budgetManwon") is None else max(0, weights["budget"] - abs(budget - profile["budgetManwon"]) * 2)
    parts["budget"] = {"score": budget_score, "max": weights["budget"]}
    parts["style"] = {"score": weights["style"] if not conditions.get("travelStyle") or conditions["travelStyle"] == profile.get("travelStyle") else 0, "max": weights["style"]}
    preferred = set(conditions.get("preferredMbti") or [])
    parts["mbti"] = {"score": weights["mbti"] if preferred and preferred & set(profile.get("mbti") or []) else 0, "max": weights["mbti"] if preferred and profile.get("mbti") else 0}
    if parts["mbti"]["max"] == 0:
        parts["mbti"]["excluded"] = True
    party = conditions.get("partySize")
    parts["partySize"] = {"score": weights["partySize"] if not party or party == profile.get("preferredPartySize") else max(0, weights["partySize"] - 4), "max": weights["partySize"]}
    score = round(sum(part["score"] for part in parts.values()) / max(1, sum(part["max"] for part in parts.values())) * 100)
    reasons = []
    if matches:
        reasons.append(f"관심사가 {len(matches)}개 일치")
    if budget is not None and profile.get("budgetManwon") is not None:
        reasons.append(f"예산 차이 {abs(budget - profile['budgetManwon'])}만원")
    return {"user": {"id": user["id"], "displayName": user["displayName"], "avatarUrl": user.get("avatarUrl")}, "score": score, "parts": parts, "reasons": reasons}


@router.post("/parse", operation_id="parseMatchingText")
async def parse_matching(payload: MatchingParseRequest, request: Request, x_demo_user_id: str | None = Header(default=None)):
    repository = get_repository(request)
    await require_demo(x_demo_user_id, repository)
    return success(parse_slots(payload.text, await repository.festivals()), request)


@router.post("/runs", operation_id="createMatchingRun", status_code=201)
async def create_run(payload: MatchingRunRequest, request: Request, x_demo_user_id: str | None = Header(default=None)):
    repository = get_repository(request)
    user_id = await require_demo(x_demo_user_id, repository)
    festival = await repository.festival(payload.festival_id)
    if not festival or festival["riskStatus"] == "cancelled":
        raise APIError(422, "FESTIVAL_NOT_AVAILABLE", "매칭할 수 없는 축제입니다.")
    users = await repository.users(exclude_id=user_id)
    conditions = payload.conditions.model_dump(by_alias=True)
    candidates = sorted([candidate(conditions, user) for user in users], key=lambda item: item["score"], reverse=True)[: payload.top_k]
    group_id = None
    if payload.create_group:
        if not payload.group:
            raise APIError(400, "MATCHING_CONDITION_INVALID", "모임 생성 정보가 필요합니다.")
        group = await repository.create_group(user_id, {"festivalId": payload.festival_id, "title": payload.group.title, "postBody": payload.group.post_body, "capacity": payload.conditions.party_size or 4, "joinMode": payload.conditions.join_mode or "approval"})
        group_id = group["id"]
    run = await repository.create_matching_run(user_id, payload.festival_id, conditions, candidates, payload.top_k, payload.create_group, group_id)
    return success({"runId": run["runId"], "festivalId": payload.festival_id, "candidates": run["candidates"], "group": run["group"]}, request, status_code=201)


@router.get("/runs/{run_id}", operation_id="getMatchingRun")
async def get_run(run_id: str, request: Request, x_demo_user_id: str | None = Header(default=None)):
    repository = get_repository(request)
    user_id = await require_demo(x_demo_user_id, repository)
    run = await repository.matching_run(run_id, user_id)
    if not run:
        raise APIError(404, "MATCHING_RUN_NOT_FOUND", "매칭 실행을 찾을 수 없습니다.")
    return success(run, request)


@router.get("/runs/{run_id}/candidates", operation_id="listMatchingCandidates")
async def list_candidates(run_id: str, request: Request, page: int = Query(default=1, ge=1), page_size: int = Query(default=20, ge=1, le=100, alias="pageSize"), x_demo_user_id: str | None = Header(default=None)):
    repository = get_repository(request)
    user_id = await require_demo(x_demo_user_id, repository)
    run = await repository.matching_run(run_id, user_id)
    if not run:
        raise APIError(404, "MATCHING_RUN_NOT_FOUND", "매칭 실행을 찾을 수 없습니다.")
    start = (page - 1) * page_size
    items = run["candidates"][start : start + page_size]
    return success({"items": items, "page": page, "pageSize": page_size, "total": len(run["candidates"])}, request)
