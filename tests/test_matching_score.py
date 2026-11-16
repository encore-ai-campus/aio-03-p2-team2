"""매칭 점수: 가중치 합 100, 미선택 조건 제외, 빈 정보 0점, 80% 기준, 성별 선택 조건."""

from __future__ import annotations

import pytest

from app.core.service import ServiceError
from app.features.matching.service import MATCH_THRESHOLD, MATCH_WEIGHTS, rank_candidates, score_candidate


def user(uid, **profile):
    return {"id": uid, "displayName": uid, "profile": profile}


ME = user("me", gender="여성", ageBand="20대")
FULL = {"startTime": "13:00", "budgetManwon": 8, "interests": ["음악", "미식"], "travelStyle": "계획적으로",
        "partySize": 4, "preferredMbti": [], "genderPreference": "same"}
TWIN = user("twin", availableFrom="12:00", budgetManwon=8, interests=["음악", "미식", "사진"], travelStyle="계획적으로",
            preferredPartySize=4, gender="여성", ageBand="20대", mbti=["ENFP"])


def test_weights_sum_to_100():
    assert sum(MATCH_WEIGHTS.values()) == 100
    assert MATCH_THRESHOLD == 80


def test_perfect_match_scores_100_with_reasons():
    result = score_candidate(FULL, TWIN, ME)
    assert result["score"] == 100
    assert any("관심사 2개" in reason for reason in result["reasons"])
    assert result["parts"]["mbti"]["excluded"] is True  # 선호 MBTI 미선택 → 제외


def test_unselected_conditions_are_excluded_not_free_points():
    only_time = {"startTime": "13:00"}
    early = score_candidate(only_time, user("a", availableFrom="12:00"))
    late = score_candidate(only_time, user("b", availableFrom="15:00"))
    assert early["score"] == 100 and late["score"] == 40
    assert all(part.get("excluded") for key, part in early["parts"].items() if key != "schedule")


def test_missing_candidate_info_gets_zero_not_full():
    empty = score_candidate(FULL, user("empty"), ME)
    assert empty["parts"]["budget"]["score"] == 0
    assert empty["score"] == 0


def test_age_band_same_adjacent_far():
    cond = {"ageBand": "20대"}
    assert score_candidate(cond, user("a", ageBand="20대"))["score"] == 100
    assert score_candidate(cond, user("b", ageBand="30대"))["score"] == 50
    assert score_candidate(cond, user("c", ageBand="40대"))["score"] == 0


def test_age_band_defaults_to_requester_band():
    assert score_candidate({}, user("a", ageBand="20대"), ME)["parts"]["ageBand"]["max"] == 10


def test_gender_any_is_excluded_and_same_scores():
    any_pref = score_candidate({**FULL, "genderPreference": "any"}, TWIN, ME)
    assert any_pref["parts"]["gender"]["excluded"] is True
    male_twin = {**TWIN, "profile": {**TWIN["profile"], "gender": "남성"}}
    assert score_candidate(FULL, male_twin, ME)["parts"]["gender"]["score"] == 0


def test_rank_applies_threshold_and_only_same_filter():
    weak = user("weak", availableFrom="16:00", budgetManwon=20, interests=["전통"], travelStyle="여유롭게",
                preferredPartySize=8, gender="여성", ageBand="40대")
    male = {**TWIN, "id": "male", "profile": {**TWIN["profile"], "gender": "남성"}}
    ranked = rank_candidates(FULL, [weak, TWIN, male], ME)
    assert [item["user"]["id"] for item in ranked][0] == "twin"
    assert "weak" not in [item["user"]["id"] for item in ranked]
    only_same = rank_candidates({**FULL, "genderPreference": "only_same"}, [TWIN, male], ME)
    assert [item["user"]["id"] for item in only_same] == ["twin"]


def test_only_same_requires_my_gender():
    with pytest.raises(ServiceError):
        rank_candidates({"genderPreference": "only_same"}, [TWIN], user("me"))
