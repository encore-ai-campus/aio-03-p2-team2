from __future__ import annotations

from typing import Any

import httpx

from app.core.api import APIError
from app.core.config import Settings
from .schemas import LoginRequest, SignupRequest


class SupabaseAuthClient:
    """Small HTTP client for the public Supabase Auth REST API."""

    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None) -> None:
        self.settings = settings
        self.client = client

    async def signup(self, payload: SignupRequest) -> dict[str, Any]:
        body: dict[str, Any] = {
            "email": payload.email,
            "password": payload.password,
        }
        if payload.display_name:
            body["data"] = {"display_name": payload.display_name}
        return await self._post("/auth/v1/signup", body, action="signup")

    async def login(self, payload: LoginRequest) -> dict[str, Any]:
        return await self._post(
            "/auth/v1/token?grant_type=password",
            {"email": payload.email, "password": payload.password},
            action="login",
        )

    async def _post(self, path: str, body: dict[str, Any], *, action: str) -> dict[str, Any]:
        base_url = (self.settings.supabase_url or "").rstrip("/")
        if not base_url or self.settings.supabase_key is None:
            raise APIError(
                503,
                "AUTH_NOT_CONFIGURED",
                "Supabase Auth 설정(SUPABASE_URL, SUPABASE_KEY)이 필요합니다.",
            )

        headers = {
            "apikey": self.settings.supabase_key.get_secret_value(),
            "Content-Type": "application/json",
        }
        owns_client = self.client is None
        try:
            if owns_client:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    response = await client.post(f"{base_url}{path}", json=body, headers=headers)
            else:
                response = await self.client.post(f"{base_url}{path}", json=body, headers=headers)
        except httpx.TimeoutException as exc:
            raise APIError(504, "AUTH_PROVIDER_TIMEOUT", "Supabase Auth 응답 시간이 초과되었습니다.") from exc
        except httpx.RequestError as exc:
            raise APIError(502, "AUTH_PROVIDER_UNAVAILABLE", "Supabase Auth에 연결할 수 없습니다.") from exc

        try:
            result = response.json()
        except ValueError as exc:
            raise APIError(502, "AUTH_PROVIDER_INVALID_RESPONSE", "Supabase Auth 응답을 해석할 수 없습니다.") from exc

        if response.is_success:
            if not isinstance(result, dict):
                raise APIError(502, "AUTH_PROVIDER_INVALID_RESPONSE", "Supabase Auth 응답 형식이 올바르지 않습니다.")
            return result

        provider_message = self._provider_message(result)
        normalized_message = provider_message.lower()
        if action == "login" and response.status_code in {400, 401}:
            raise APIError(401, "AUTH_INVALID_CREDENTIALS", "이메일 또는 비밀번호가 올바르지 않습니다.")
        if action == "signup" and response.status_code in {400, 409} and any(
            phrase in normalized_message for phrase in ("already registered", "already exists", "user exists")
        ):
            raise APIError(409, "AUTH_EMAIL_ALREADY_REGISTERED", "이미 가입된 이메일입니다.")
        if response.status_code == 429:
            raise APIError(429, "AUTH_RATE_LIMITED", "인증 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.")
        if response.status_code >= 500:
            raise APIError(502, "AUTH_PROVIDER_ERROR", "Supabase Auth 처리 중 오류가 발생했습니다.")
        raise APIError(400, "AUTH_REQUEST_FAILED", provider_message)

    @staticmethod
    def _provider_message(result: Any) -> str:
        if isinstance(result, dict):
            for key in ("msg", "message", "error_description", "error"):
                value = result.get(key)
                if isinstance(value, str) and value:
                    return value
        return "Supabase Auth 요청을 처리할 수 없습니다."
