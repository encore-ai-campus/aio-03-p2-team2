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


# 매칭 가중치 (합계 100).
# - 요청자가 고르지 않은 조건은 점수에서 제외(분모에서 빠짐)
# - 후보의 정보가 비어 있는 항목도 제외(missing)하되, 요청한 조건 가중치의 절반 이상에
#   후보 정보가 있어야 추천 대상이 된다 (정보가 거의 없는 후보가 100%가 되는 것 방지)
MATCH_WEIGHTS = {
    "schedule": 20, "interests": 20, "budget": 15, "style": 15,
    "ageBand": 10, "partySize": 10, "gender": 5, "mbti": 5,
}
# 이 점수(%) 이상인 후보만 추천한다.
# 80 → 60 (11/18): 시연 데이터 진단 결과 선택 조건(관심사 등)이 하나라도 안 맞으면 80%를 넘는 후보가 0명 → 60으로 완화
MATCH_THRESHOLD = 60
# 요청한 조건 가중치 중 후보 정보가 있는 비율의 최소값
MIN_PROFILE_COVERAGE = 0.5
AGE_BANDS = ("10대", "20대", "30대", "40대", "50대")
GENDER_PREFERENCES = ("any", "same", "only_same")


def _excluded() -> dict[str, Any]:
    return {"score": 0, "max": 0, "excluded": True}


def _missing(weight: int) -> dict[str, Any]:
    """요청한 조건이지만 후보 정보가 없는 항목: 점수에서는 제외하고 정보 부족으로 표시."""
    return {"score": 0, "max": 0, "excluded": True, "missing": True, "requested": weight}


def _part(score: float, maximum: int) -> dict[str, Any]:
    return {"score": max(0, min(maximum, round(score))), "max": maximum}


def candidate_profile(profile: dict) -> dict[str, Any]:
    """추천 카드용 공개 프로필 요약: 연령대·관심사·여행 스타일·합류 가능 시각."""
    return {
        "ageBand": profile.get("ageBand"),
        "interests": list(profile.get("interests") or [])[:4],
        "travelStyle": profile.get("travelStyle"),
        "availableFrom": profile.get("availableFrom"),
    }


def profile_coverage(parts: dict) -> float:
    """Reconstruct coverage from the persisted score parts as well as fresh results."""
    available = sum(part["max"] for part in parts.values())
    requested = available + sum(part.get("requested", 0) for part in parts.values())
    return round(available / requested, 2) if requested else 0.0


def score_candidate(conditions: dict, user: dict, requester: dict | None = None) -> dict:
    """Score one active user. `requester` is the user asking for matches (for age band / gender)."""
    profile = user.get("profile") or {}
    mine = (requester or {}).get("profile") or {}
    w = MATCH_WEIGHTS
    parts: dict[str, dict[str, Any]] = {}
    reasons: list[str] = []

    # 일정: 후보가 요청 시각까지 합류 가능하면 만점, 늦으면 40%
    desired, available = conditions.get("startTime"), profile.get("availableFrom")
    if not desired:
        parts["schedule"] = _excluded()
    elif not available:
        parts["schedule"] = _missing(w["schedule"])
    elif available <= desired:
        parts["schedule"] = _part(w["schedule"], w["schedule"])
        reasons.append(f"{available}부터 합류 가능")
    else:
        parts["schedule"] = _part(w["schedule"] * 0.4, w["schedule"])

    # 관심사: 요청한 관심사 중 겹치는 비율
    wanted = list(dict.fromkeys(conditions.get("interests") or []))
    matches = [item for item in wanted if item in set(profile.get("interests") or [])]
    if not wanted:
        parts["interests"] = _excluded()
    elif not profile.get("interests"):
        parts["interests"] = _missing(w["interests"])
    else:
        parts["interests"] = _part(w["interests"] * len(matches) / len(wanted), w["interests"])
        if matches:
            reasons.append(f"관심사 {len(matches)}개 일치({', '.join(matches)})")

    # 예산: 1만원 차이마다 2점 감점
    budget, their_budget = conditions.get("budgetManwon"), profile.get("budgetManwon")
    if budget is None:
        parts["budget"] = _excluded()
    elif their_budget is None:
        parts["budget"] = _missing(w["budget"])
    else:
        gap = abs(budget - their_budget)
        parts["budget"] = _part(w["budget"] - gap * 2, w["budget"])
        reasons.append(f"예산 차이 {gap}만원")

    # 여행 스타일: 같으면 만점
    style = conditions.get("travelStyle")
    if not style:
        parts["style"] = _excluded()
    elif not profile.get("travelStyle"):
        parts["style"] = _missing(w["style"])
    else:
        same_style = style == profile.get("travelStyle")
        parts["style"] = _part(w["style"] if same_style else 0, w["style"])
        if same_style:
            reasons.append(f"여행 스타일 같음({style})")

    # 나이대: 같은 나이대 만점, 바로 옆 나이대 절반 (조건이 없으면 요청자 본인 나이대 기준)
    target, theirs = conditions.get("ageBand") or mine.get("ageBand"), profile.get("ageBand")
    if target not in AGE_BANDS:
        parts["ageBand"] = _excluded()
    elif theirs not in AGE_BANDS:
        parts["ageBand"] = _missing(w["ageBand"])
    else:
        distance = abs(AGE_BANDS.index(target) - AGE_BANDS.index(theirs))
        parts["ageBand"] = _part(w["ageBand"] if distance == 0 else w["ageBand"] / 2 if distance == 1 else 0, w["ageBand"])
        if distance == 0:
            reasons.append(f"같은 나이대({theirs})")

    # 희망 인원: 1명 차이마다 3점 감점
    party, their_party = conditions.get("partySize"), profile.get("preferredPartySize")
    if not party:
        parts["partySize"] = _excluded()
    elif their_party is None:
        parts["partySize"] = _missing(w["partySize"])
    else:
        parts["partySize"] = _part(w["partySize"] - abs(party - their_party) * 3, w["partySize"])

    # 성별: '상관없음'이면 제외, '동성 선호'면 같은 성별에 점수 ('동성만'은 rank_candidates 에서 먼저 거름)
    preference, my_gender = conditions.get("genderPreference") or "any", mine.get("gender")
    if preference == "any" or not my_gender:
        parts["gender"] = _excluded()
    elif not profile.get("gender"):
        parts["gender"] = _missing(w["gender"])
    else:
        parts["gender"] = _part(w["gender"] if profile.get("gender") == my_gender else 0, w["gender"])

    # MBTI: 선호 MBTI 를 골랐고 후보가 MBTI 를 공개한 경우에만 계산 (비공개는 감점하지 않음)
    preferred, their_mbti = set(conditions.get("preferredMbti") or []), set(profile.get("mbti") or [])
    if not preferred or not their_mbti:
        parts["mbti"] = _excluded()
    else:
        parts["mbti"] = _part(w["mbti"] if preferred & their_mbti else 0, w["mbti"])

    total_max = sum(part["max"] for part in parts.values())
    score = round(sum(part["score"] for part in parts.values()) / total_max * 100) if total_max else 0
    # 요청한 조건 가중치 중 후보 정보가 있는 비율 (MBTI 비공개는 감점·부족으로 보지 않음)
    coverage = profile_coverage(parts)
    return {
        "user": {"id": user["id"], "displayName": user["displayName"], "avatarUrl": user.get("avatarUrl")},
        # 화면에 보여 줄 후보 프로필 요약 (성별·MBTI 등 민감할 수 있는 값은 제외)
        "profile": candidate_profile(profile),
        "score": score,
        "parts": parts,
        "reasons": reasons,
        "coverage": coverage,
    }


def rank_candidates(conditions: dict, users: list[dict], requester: dict | None = None, *,
                    top_k: int = 5, threshold: int = MATCH_THRESHOLD) -> list[dict]:
    """시작 시각·동성만 조건으로 거른 뒤 기준점 이상 후보를 높은 순으로 돌려준다."""
    # Known late arrivals cannot satisfy the requested start time. Missing times remain
    # explicitly unknown and are handled by profile coverage, as in the current PR policy.
    start_time = conditions.get("startTime")
    if start_time:
        users = [user for user in users if not (user.get("profile") or {}).get("availableFrom")
                 or user["profile"]["availableFrom"] <= start_time]
    if (conditions.get("genderPreference") or "any") == "only_same":
        my_gender = ((requester or {}).get("profile") or {}).get("gender")
        if not my_gender:
            raise ServiceError(400, "MATCHING_GENDER_REQUIRED", "'동성만' 조건을 쓰려면 내 프로필에 성별을 입력해 주세요.")
        users = [user for user in users if (user.get("profile") or {}).get("gender") == my_gender]
    scored = [score_candidate(conditions, user, requester) for user in users]
    passed = [item for item in scored
              if item["coverage"] >= MIN_PROFILE_COVERAGE and item["score"] >= threshold]
    return sorted(passed, key=lambda item: item["score"], reverse=True)[:top_k]


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

        conditions = payload.conditions.model_dump(mode="json", by_alias=True)
        day = conditions.get("date")
        if day and not festival["startDate"] <= day <= festival["endDate"]:
            raise ServiceError(422, "MATCHING_DATE_INVALID", "참여 날짜는 축제 운영 기간 안에서 선택해 주세요.")
        requester = await self.repository.user(user_id)
        users = await self.repository.users(exclude_id=user_id)
        candidates = rank_candidates(conditions, users, requester, top_k=payload.top_k)

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
                    "conditions": {"date": day, "start_time": payload.conditions.start_time},
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
