"""시연 중 발견: AI가 '11월 21일'을 1111-11-21로, '계획적으로'를 '계획적'으로 추출 → 매칭 중단·스타일 점수 0."""
from datetime import date
from unittest.mock import AsyncMock

import pytest

from app.features.agents.providers import OpenAIModel
from app.features.agents.schemas import Conditions, ParsedRequest, RunStart
from app.features.matching.service import score_candidate
from tests.test_agent_workflow import USER, running


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "message, extracted, expected",
    [
        ("11월 21일 오후 1시", "1111-11-21", "2026-11-21"),
        ("10/21 오후 1시", "1111-10-21", "2027-10-21"),
        ("2월 29일 오후 1시", "1112-02-29", "2028-02-29"),
        ("2023년 11월 21일", "2023-11-21", "2023-11-21"),
        ("2023-11-21 오후 1시", "2023-11-21", "2023-11-21"),
        ("23년 11월 21일", "2023-11-21", "2023-11-21"),
        ("내년 11월 21일", "1111-11-21", "1111-11-21"),
        ("동행 찾아줘", "1111-11-21", "1111-11-21"),
        ("11월 20일", "1111-11-21", "1111-11-21"),
        ("11월 21일", "2026-11-21", "2026-11-21"),
    ],
)
async def test_openai_repairs_only_an_inferred_year(monkeypatch, message, extracted, expected):
    monkeypatch.setattr("app.features.agents.providers.today", lambda: "2026-11-18")
    model = OpenAIModel("test-key", "test-model")
    try:
        model._structured = AsyncMock(return_value=ParsedRequest(
            intent="matching", conditions={"date": extracted},
        ))
        result = await model.parse(message, {})
        assert result["conditions"]["date"] == expected
    finally:
        await model.close()


@pytest.mark.asyncio
async def test_explicit_past_date_is_validated_against_the_festival(running):
    service, _, group, day = running
    festival_day = date.fromisoformat(day)
    requested = festival_day.replace(year=festival_day.year - 4).isoformat()
    run = await service.start(USER, RunStart.model_validate({
        "message": "동행 찾아줘",
        "intent": "matching",
        "festivalId": group["festivalId"],
        "conditions": {"date": requested, "startTime": "13:00"},
    }))
    assert run["conditions"]["date"] == requested
    assert run["status"] == "failed"
    assert "FESTIVAL_UNAVAILABLE" in {error["code"] for error in run["errors"]}


def test_travel_style_short_forms_match_profile_values():
    for raw, expected in [("계획적", "계획적으로"), ("계획적으로", "계획적으로"), ("계획 세워서", "계획적으로"),
                          ("여유 있게", "여유롭게"), ("여유롭게", "여유롭게"), ("활동적인", "활동적으로")]:
        assert Conditions.model_validate({"travel_style": raw}).travel_style == expected


def test_negated_styles_are_not_turned_into_the_opposite():
    # 팀 리뷰(저라뎃): "계획 없이"가 "계획적으로"로 바뀌면 반대 성향 후보 점수가 잘못 오른다
    for raw in ["계획 없이", "계획없이", "계획 없는", "여유 없게", "여유없이", "활동 안 하고", "활동적이지 않게"]:
        assert Conditions.model_validate({"travel_style": raw}).travel_style == raw


def test_negated_style_gets_no_style_points():
    conditions = Conditions.model_validate({"travel_style": "계획 없이"}).model_dump(mode="json", by_alias=True, exclude_none=True)
    user = {"id": "u", "displayName": "u", "profile": {"travelStyle": "계획적으로"}}
    assert score_candidate(conditions, user)["parts"]["style"] == {"score": 0, "max": 15}


def test_short_style_now_scores_full_style_points():
    conditions = Conditions.model_validate({"travel_style": "계획적"}).model_dump(mode="json", by_alias=True, exclude_none=True)
    user = {"id": "u", "displayName": "u", "profile": {"travelStyle": "계획적으로"}}
    assert score_candidate(conditions, user)["parts"]["style"] == {"score": 15, "max": 15}
