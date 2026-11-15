from __future__ import annotations

import re
from typing import Any

from app.core.service import ServiceError


def parse_slots(text: str, festivals: list[dict]) -> dict:
    """Extract matching conditions from the user's natural-language input."""
    draft = {
        "festivalId": None,
        "startTime": None,
        "budgetManwon": None,
        "interests": [],
        "travelStyle": None,
        "preferredMbti": [],
        "partySize": None,
        "joinMode": None,
    }
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

    missing = [
        key
        for key, value in (
            ("festivalId", draft["festivalId"]),
            ("startTime", draft["startTime"]),
            ("budgetManwon", draft["budgetManwon"]),
            ("partySize", draft["partySize"]),
        )
        if value is None
    ]
    return {
        "draft": draft,
        "missingSlots": missing,
        "confidence": round(max(0.4, 1 - len(missing) * 0.12), 2),
        "parserVersion": "match-slot-v1",
    }


def score_candidate(conditions: dict, user: dict) -> dict:
    """Score one active user using the product's matching weights."""
    profile = user["profile"]
    weights = {"schedule": 25, "interests": 20, "budget": 20, "style": 15, "mbti": 10, "partySize": 10}
    parts: dict[str, dict[str, Any]] = {}

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
    return {
        "user": {"id": user["id"], "displayName": user["displayName"], "avatarUrl": user.get("avatarUrl")},
        "score": score,
        "parts": parts,
        "reasons": reasons,
    }


# Backward-compatible name for callers that used the old router helper.
candidate = score_candidate


class MatchingService:
    def __init__(self, repository: Any) -> None:
        self.repository = repository

    async def parse(self, text: str) -> dict:
        return parse_slots(text, await self.repository.festivals())

    async def create_run(self, user_id: str, payload: Any) -> dict:
        festival = await self.repository.festival(payload.festival_id)
        if not festival or festival["riskStatus"] == "cancelled":
            raise ServiceError(422, "FESTIVAL_NOT_AVAILABLE", "매칭할 수 없는 축제입니다.")

        conditions = payload.conditions.model_dump(by_alias=True)
        users = await self.repository.users(exclude_id=user_id)
        candidates = sorted(
            [score_candidate(conditions, user) for user in users],
            key=lambda item: item["score"],
            reverse=True,
        )[: payload.top_k]

        group_id = None
        if payload.create_group:
            if not payload.group:
                raise ServiceError(400, "MATCHING_CONDITION_INVALID", "모임 생성 정보가 필요합니다.")
            group = await self.repository.create_group(
                user_id,
                {
                    "festivalId": payload.festival_id,
                    "title": payload.group.title,
                    "postBody": payload.group.post_body,
                    "capacity": payload.conditions.party_size or 4,
                    "joinMode": payload.conditions.join_mode or "approval",
                },
            )
            group_id = group["id"]

        run = await self.repository.create_matching_run(
            user_id,
            payload.festival_id,
            conditions,
            candidates,
            payload.top_k,
            payload.create_group,
            group_id,
        )
        return {
            "runId": run["runId"],
            "festivalId": payload.festival_id,
            "candidates": run["candidates"],
            "group": run["group"],
        }
