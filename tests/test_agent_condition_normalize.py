"""시연 중 발견: AI가 '11월 21일'을 1111-11-21로, '계획적으로'를 '계획적'으로 추출 → 매칭 중단·스타일 점수 0."""
from datetime import date

from app.features.agents.schemas import Conditions, _seoul_today
from app.features.matching.service import score_candidate


def test_nonsense_year_becomes_upcoming_same_day():
    today = _seoul_today()
    fixed = Conditions.model_validate({"date": "1111-11-21"}).date
    assert (fixed.month, fixed.day) == (11, 21)
    assert fixed >= today and fixed.year in (today.year, today.year + 1)


def test_real_dates_are_untouched():
    today = _seoul_today()
    assert Conditions.model_validate({"date": today.isoformat()}).date == today
    assert Conditions.model_validate({"date": f"{today.year - 1}-05-01"}).date == date(today.year - 1, 5, 1)


def test_travel_style_short_forms_match_profile_values():
    for raw, expected in [("계획적", "계획적으로"), ("계획적으로", "계획적으로"), ("여유", "여유롭게"), ("활동적인", "활동적으로")]:
        assert Conditions.model_validate({"travel_style": raw}).travel_style == expected


def test_short_style_now_scores_full_style_points():
    conditions = Conditions.model_validate({"travel_style": "계획적"}).model_dump(mode="json", by_alias=True, exclude_none=True)
    user = {"id": "u", "displayName": "u", "profile": {"travelStyle": "계획적으로"}}
    assert score_candidate(conditions, user)["parts"]["style"] == {"score": 15, "max": 15}
