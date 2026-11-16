import httpx
import pytest
import json

from app.core.api import APIError
from app.core.config import Settings
from app.features.auth.schemas import LoginRequest, SignupRequest
from app.features.auth.service import SupabaseAuthClient
from app.main import create_app


def test_auth_routes_are_exposed_in_openapi():
    app = create_app(Settings(_env_file=None, app_env="test"))
    schema = app.openapi()

    assert "/api/v1/auth/signup" in schema["paths"]
    assert "/api/v1/auth/login" in schema["paths"]
    assert schema["paths"]["/api/v1/auth/signup"]["post"]["tags"] == ["auth"]
    assert "HTTPBearer" not in schema["paths"]["/api/v1/auth/signup"]["post"].get("security", {})
    assert "SignupRequest" in schema["components"]["schemas"]
    assert "LoginRequest" in schema["components"]["schemas"]


@pytest.mark.asyncio
async def test_supabase_auth_client_forwards_signup_and_login():
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path.endswith("/signup"):
            return httpx.Response(200, json={"user": {"id": "auth-user"}, "session": None})
        return httpx.Response(
            200,
            json={"access_token": "access", "refresh_token": "refresh", "user": {"id": "auth-user"}},
        )

    settings = Settings(_env_file=None, supabase_url="https://example.supabase.co", supabase_key="public-key")
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        auth = SupabaseAuthClient(settings, client=client)
        signup = await auth.signup(SignupRequest(email="User@Example.com", password="secret123", display_name="사용자"))
        login = await auth.login(LoginRequest(email="User@Example.com", password="secret123"))

    assert signup["user"]["id"] == "auth-user"
    assert login["access_token"] == "access"
    assert requests[0].url.path == "/auth/v1/signup"
    assert requests[0].headers["apikey"] == "public-key"
    assert json.loads(requests[0].content) == {
        "email": "user@example.com",
        "password": "secret123",
        "data": {"display_name": "사용자"},
    }
    assert requests[1].url.path == "/auth/v1/token"
    assert requests[1].url.query == b"grant_type=password"


@pytest.mark.asyncio
async def test_supabase_auth_client_maps_invalid_login():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"error_description": "Invalid login credentials"})

    settings = Settings(_env_file=None, supabase_url="https://example.supabase.co", supabase_key="public-key")
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(APIError) as error:
            await SupabaseAuthClient(settings, client=client).login(
                LoginRequest(email="user@example.com", password="secret123")
            )

    assert error.value.status_code == 401
    assert error.value.code == "AUTH_INVALID_CREDENTIALS"
