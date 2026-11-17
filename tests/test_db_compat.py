"""DB(v4.3 스키마) 제약과 API 입력·에러 처리가 맞는지 확인."""

from __future__ import annotations

import asyncpg
import pytest
from pydantic import ValidationError

from app.features.auth.schemas import ProfilePatch
from app.features.matching.schemas import MatchingConditions, MatchingGroupInput
from app.main import _postgres_error


def test_profile_patch_accepts_korean_gender_and_age_band():
    patch = ProfilePatch.model_validate({"gender": "여성", "ageBand": "20대"})
    assert patch.model_dump(by_alias=True, exclude_none=True) == {"gender": "여성", "ageBand": "20대"}


@pytest.mark.parametrize("payload", [{"gender": "female"}, {"ageBand": "50대 이상"}, {"ageBand": "60대"}])
def test_profile_patch_rejects_values_outside_db_check(payload):
    with pytest.raises(ValidationError):
        ProfilePatch.model_validate(payload)


def test_profile_patch_normalizes_and_validates_mbti():
    assert ProfilePatch.model_validate({"mbti": ["enfp", "ENFP", "istj"]}).mbti == ["ENFP", "ISTJ"]
    with pytest.raises(ValidationError):
        ProfilePatch.model_validate({"mbti": ["ENFX"]})


def test_party_size_and_group_text_follow_db_limits():
    MatchingConditions.model_validate({"partySize": 8})
    with pytest.raises(ValidationError):
        MatchingConditions.model_validate({"partySize": 9})
    with pytest.raises(ValidationError):
        MatchingGroupInput.model_validate({"title": "가" * 46, "postBody": "본문"})


@pytest.mark.parametrize(
    ("error", "status", "code"),
    [
        (asyncpg.InsufficientPrivilegeError("new row violates row-level security policy"), 403, "DB_PERMISSION_DENIED"),
        (asyncpg.CheckViolationError("check"), 400, "DB_INVALID_VALUE"),
        (asyncpg.UniqueViolationError("dup"), 409, "DB_DUPLICATE"),
        (asyncpg.ForeignKeyViolationError("fk"), 409, "DB_REFERENCE_INVALID"),
        (asyncpg.PostgresError("other"), 500, "DB_ERROR"),
    ],
)
def test_postgres_errors_map_to_api_status(error, status, code):
    assert _postgres_error(error)[:2] == (status, code)


def test_rpc_result_accepts_jsonb_text_from_asyncpg():
    from app.core.repository import RepositoryError, assert_rpc_success

    assert assert_rpc_success('{"ok": true, "version": 2}') == {"ok": True, "version": 2}
    assert assert_rpc_success({"ok": True}) == {"ok": True}
    with pytest.raises(RepositoryError) as failed:
        assert_rpc_success('{"ok": false, "code": "GROUP_CAPACITY_EXCEEDED", "status": 409, "message": "정원"}')
    assert failed.value.code == "GROUP_CAPACITY_EXCEEDED" and failed.value.status_code == 409
    with pytest.raises(RepositoryError) as invalid:
        assert_rpc_success("not json")
    assert invalid.value.code == "DATABASE_RPC_INVALID"


def test_jsonb_codec_encoder_does_not_double_encode():
    import json as _json

    from app.core.database import _encode_json

    # 기존 코드처럼 json.dumps 한 문자열은 그대로, dict/list 는 JSON 으로
    assert _encode_json('{"a": 1}') == '{"a": 1}'
    assert _json.loads(_encode_json({"a": 1, "b": ["축제"]})) == {"a": 1, "b": ["축제"]}
