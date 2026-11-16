from __future__ import annotations

import asyncio
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, AsyncIterator

import jwt
from fastapi import Depends, Request, WebSocket
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.api import APIError
from app.core.config import Settings, get_settings
from app.core.repositories import get_repository


bearer_scheme = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class AuthClaims:
    """Claims validated from a Supabase access token."""

    subject: str
    claims: dict[str, Any]


@dataclass(frozen=True)
class CurrentUser:
    """Application user resolved from the JWT subject."""

    id: str
    auth_user_id: str
    claims: dict[str, Any]


class JWTVerifier:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._jwks_client: jwt.PyJWKClient | None = None

    @property
    def issuer(self) -> str | None:
        return self.settings.supabase_jwt_issuer or (
            f"{self.settings.supabase_url.rstrip('/')}/auth/v1"
            if self.settings.supabase_url
            else None
        )

    def _decode(self, token: str) -> dict[str, Any]:
        issuer = self.issuer
        if not issuer:
            raise APIError(503, "AUTH_NOT_CONFIGURED", "Supabase Auth 설정이 없습니다.")
        try:
            header = jwt.get_unverified_header(token)
            algorithm = header.get("alg")
            if algorithm not in {"HS256", "RS256", "ES256"}:
                raise APIError(401, "AUTH_TOKEN_INVALID", "지원하지 않는 JWT 알고리즘입니다.")
            if self.settings.supabase_jwt_secret:
                if algorithm != "HS256":
                    raise APIError(401, "AUTH_TOKEN_INVALID", "JWT 서명 알고리즘이 올바르지 않습니다.")
                key: Any = self.settings.supabase_jwt_secret
            else:
                if not self.settings.supabase_url:
                    raise APIError(503, "AUTH_NOT_CONFIGURED", "Supabase Auth JWKS 설정이 없습니다.")
                if self._jwks_client is None:
                    jwks_url = f"{self.settings.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
                    self._jwks_client = jwt.PyJWKClient(jwks_url)
                key = self._jwks_client.get_signing_key_from_jwt(token).key
            decoded = jwt.decode(
                token,
                key,
                algorithms=[algorithm],
                audience=self.settings.supabase_jwt_audience,
                issuer=issuer,
                options={"require": ["sub", "exp", "iat"]},
            )
        except APIError:
            raise
        except (jwt.PyJWTError, ValueError, TypeError) as exc:
            raise APIError(401, "AUTH_TOKEN_INVALID", "유효하지 않은 Supabase Auth 토큰입니다.") from exc
        subject = decoded.get("sub")
        if not isinstance(subject, str) or not subject:
            raise APIError(401, "AUTH_TOKEN_INVALID", "JWT subject가 없습니다.")
        return decoded

    async def verify(self, token: str) -> AuthClaims:
        decoded = await asyncio.to_thread(self._decode, token)
        return AuthClaims(subject=decoded["sub"], claims=decoded)


@lru_cache
def get_jwt_verifier() -> JWTVerifier:
    return JWTVerifier(get_settings())


async def _claims_from_credentials(credentials: HTTPAuthorizationCredentials | None, verifier: JWTVerifier) -> AuthClaims:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise APIError(401, "AUTH_REQUIRED", "Authorization Bearer 토큰이 필요합니다.")
    return await verifier.verify(credentials.credentials)


async def require_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> AsyncIterator[CurrentUser]:
    """Validate JWT, bind its claims to the DB session, and resolve app user."""

    auth = await _claims_from_credentials(credentials, request.app.state.jwt_verifier)
    database = request.app.state.database
    context_token = database.bind_auth_claims(auth.claims)
    try:
        user = await get_repository(request).user_by_auth_id(auth.subject)
        if not user:
            raise APIError(403, "AUTH_USER_NOT_LINKED", "Supabase Auth 사용자와 앱 사용자가 연결되지 않았습니다.")
        current_user = CurrentUser(id=user["id"], auth_user_id=auth.subject, claims=auth.claims)
        request.state.current_user = current_user
        yield current_user
    finally:
        database.reset_auth_claims(context_token)


def current_user_id(request: Request) -> str:
    current_user = getattr(request.state, "current_user", None)
    if not isinstance(current_user, CurrentUser):
        raise APIError(401, "AUTH_REQUIRED", "인증된 사용자를 확인할 수 없습니다.")
    return current_user.id


async def require_admin(current_user: CurrentUser = Depends(require_current_user)) -> CurrentUser:
    app_metadata = current_user.claims.get("app_metadata") or {}
    role = app_metadata.get("role") or current_user.claims.get("role")
    if role not in {"admin", "service_role"}:
        raise APIError(403, "ADMIN_REQUIRED", "관리자 권한이 필요합니다.")
    return current_user


async def authenticate_websocket(websocket: WebSocket) -> tuple[CurrentUser, Any]:
    """Authenticate a WebSocket using a bearer header or access_token query token."""

    authorization = websocket.headers.get("authorization")
    token = authorization[7:].strip() if authorization and authorization.lower().startswith("bearer ") else None
    # Keep both spellings while browser clients migrate to the API contract.
    # `accessToken` is the documented frontend spelling; `access_token` remains
    # supported for existing clients and direct API usage.
    token = token or websocket.query_params.get("accessToken") or websocket.query_params.get("access_token")
    if not token:
        raise APIError(401, "AUTH_REQUIRED", "WebSocket 인증 토큰이 필요합니다.")
    auth = await websocket.app.state.jwt_verifier.verify(token)
    database = websocket.app.state.database
    context_token = database.bind_auth_claims(auth.claims)
    try:
        user = await get_repository(websocket).user_by_auth_id(auth.subject)
    except Exception:
        database.reset_auth_claims(context_token)
        raise
    if not user:
        database.reset_auth_claims(context_token)
        raise APIError(403, "AUTH_USER_NOT_LINKED", "Supabase Auth 사용자와 앱 사용자가 연결되지 않았습니다.")
    return CurrentUser(id=user["id"], auth_user_id=auth.subject, claims=auth.claims), context_token
