"""PC 시계가 Supabase 서버보다 조금 느려도 방금 발급된 토큰을 받아야 한다 (로그인 직후 401 → 자동 로그아웃 방지)."""
from datetime import datetime, timedelta, timezone

import jwt
import pytest

from app.core.api import APIError
from app.core.auth import JWTVerifier
from app.core.config import Settings

SECRET = "isolated-test-signing-secret-at-least-32-bytes"
ISSUER = "https://isolated-test.supabase.co/auth/v1"


def _verifier(**overrides):
    return JWTVerifier(Settings(_env_file=None, supabase_url="https://isolated-test.supabase.co",
                                supabase_jwt_secret=SECRET, supabase_jwt_issuer=ISSUER, **overrides))


def _token(issued_in_seconds: int) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode({"sub": "user-1", "iss": ISSUER, "aud": "authenticated",
                       "iat": now + timedelta(seconds=issued_in_seconds),
                       "exp": now + timedelta(minutes=60)}, SECRET, algorithm="HS256")


@pytest.mark.asyncio
async def test_token_issued_slightly_in_the_future_is_accepted():
    # 서버 시계가 1~5초 빠른 상황 (실제 측정: 이 PC가 Supabase보다 0.8초 느림)
    claims = await _verifier().verify(_token(5))
    assert claims.subject == "user-1"


@pytest.mark.asyncio
async def test_token_far_in_the_future_is_still_rejected():
    with pytest.raises(APIError) as error:
        await _verifier().verify(_token(600))
    assert error.value.status_code == 401


@pytest.mark.asyncio
async def test_leeway_zero_reproduces_the_original_bug():
    with pytest.raises(APIError):
        await _verifier(supabase_jwt_leeway_seconds=0).verify(_token(2))
