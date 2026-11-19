from datetime import time
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.features.agents.graph import AgentNodes
from app.features.matching.repository import MatchingRepositoryMixin
from app.features.matching.service import candidate_profile, parse_slots, rank_candidates, score_candidate


def test_festival_tags_do_not_become_matching_interests():
    festivals = [{"id": "fst_1", "name": "불꽃축제", "region": "부산", "category": "festival",
                  "tags": ["불꽃축제", "드론 라이트쇼", "사진"]}]
    result = parse_slots("불꽃축제 드론 라이트쇼에서 사진 좋아하는 동행", festivals)
    assert result["draft"]["festivalId"] == "fst_1"
    assert result["draft"]["interests"] == ["사진"]


@pytest.mark.asyncio
@pytest.mark.parametrize("extracted,previous,explicit,expected", [
    (["불꽃축제", "드론 라이트쇼"], [], {}, []),
    (["불꽃축제", "사진", " 사진 "], [], {}, ["사진"]),
    (["불꽃축제"], ["음악"], {}, ["음악"]),
    (["불꽃축제"], ["음악"], {"interests": ["보드게임"]}, ["보드게임"]),
    (["사진"], ["음악"], {"interests": []}, []),
])
async def test_agent_filters_inferred_interests_but_preserves_explicit_choices(extracted, previous, explicit, expected):
    model = SimpleNamespace(parse=AsyncMock(return_value={"intent": "matching", "conditions": {"interests": extracted}}))
    repo = SimpleNamespace(user=AsyncMock(return_value={"id": "me", "profile": {}}))
    nodes = AgentNodes(repo, None, model, None, None)
    result = await nodes.parse_request({"message": "동행 찾아줘", "context": {}, "intent": "matching", "user_id": "me",
        "festival_id": "fst_1", "conditions": {"date": "2026-11-20", "start_time": "15:00", "interests": previous},
        "explicit_conditions": explicit})
    assert result["status"] == "running"
    assert result["conditions"]["interests"] == expected


def test_sixty_point_boundary_keeps_start_time_and_gender_filters():
    conditions = {"startTime": "15:00", "budgetManwon": 8, "genderPreference": "only_same"}
    requester = {"profile": {"gender": "여성"}}
    def user(uid, budget=15, available="13:00", gender="여성"):
        return {"id": uid, "displayName": uid, "profile": {"availableFrom": available, "budgetManwon": budget, "gender": gender}}
    # Gender adds 5 matching points: (20 + 0 + 5) / 40 rounds to 62, so test the exact boundary separately.
    plain = {"startTime": "15:00", "budgetManwon": 8}
    assert score_candidate(plain, user("boundary"))["score"] == 60
    assert [r["user"]["id"] for r in rank_candidates(plain, [user("boundary"), user("below", budget=16)])] == ["boundary"]
    ranked = rank_candidates(conditions, [user("valid"), user("late", available="16:00"), user("male", gender="남성")], requester)
    assert [r["user"]["id"] for r in ranked] == ["valid"]


def test_profile_summary_is_identical_after_database_conversion():
    profile = {"ageBand": "20대", "interests": ["음악", "사진", "산책", "문화", "자연"],
               "travelStyle": "여유롭게", "availableFrom": "13:30", "gender": "여성", "mbti": ["ENFP"]}
    live = score_candidate({"startTime": "15:00"}, {"id": "candidate", "displayName": "동행", "profile": profile})
    stored = MatchingRepositoryMixin._matching_candidate_view({"candidate_user_id": "candidate", "display_name": "동행",
        "avatar_url": None, "score": live["score"], "parts": live["parts"], "reasons": live["reasons"],
        "age_band": "20대", "interests": profile["interests"], "travel_style": "여유롭게", "available_from": time(13, 30)})
    assert stored == live
    assert len(stored["profile"]["interests"]) == 4
    assert not {"gender", "mbti"} & stored["profile"].keys()
    assert candidate_profile({}) == {"ageBand": None, "interests": [], "travelStyle": None, "availableFrom": None}
