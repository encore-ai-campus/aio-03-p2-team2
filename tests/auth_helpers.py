"""Signed local JWTs and an explicit identity map for isolated HTTP tests only."""
from datetime import datetime, timedelta, timezone

import jwt

from app.core.auth import JWTVerifier
from app.core.config import Settings

SECRET = 'isolated-test-signing-secret-at-least-32-bytes'
ISSUER = 'https://isolated-test.supabase.co/auth/v1'
SUBJECTS = {
    'usr_demo_02': '00000000-0000-0000-0000-000000000002',
    'usr_demo_01': '00000000-0000-0000-0000-000000000001',
}


def token_headers(user_id='usr_demo_02', **overrides):
    now = datetime.now(timezone.utc)
    claims = dict(sub=SUBJECTS[user_id], iss=ISSUER, aud='authenticated',
                  iat=now, exp=now+timedelta(minutes=5), role='authenticated')
    claims.update(overrides)
    return {'Authorization': 'Bearer '+jwt.encode(claims, SECRET, algorithm='HS256')}


def install_test_identity(app, repository):
    app.state.jwt_verifier = JWTVerifier(Settings(
        _env_file=None, supabase_url='https://isolated-test.supabase.co',
        supabase_jwt_secret=SECRET, supabase_jwt_issuer=ISSUER))

    async def lookup(subject):
        user_id = next((key for key, value in SUBJECTS.items() if value == subject), None)
        return await repository.user(user_id) if user_id else None

    repository.user_by_auth_id = lookup
