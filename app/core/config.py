from functools import lru_cache
from pathlib import Path
from typing import Literal
from pydantic import SecretStr, Field

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parents[2] / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "FestaMate API"
    app_env: str = "development"
    api_prefix: str = "/api/v1"
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    agent_database_pool_max_size: int = Field(default=5,ge=2,le=20)
    agent_database_timeout: float = Field(default=10,ge=1,le=60)
    agent_data_dir: Path = Path(__file__).resolve().parents[2] / "data"
    agent_model_provider: Literal["rules", "openai"] = "rules"
    openai_api_key: SecretStr | None = None
    openai_model: str = ""
    agent_weather_provider: Literal["demo", "openmeteo"] = "demo"
    weather_monitor_interval_seconds: int = Field(default=300, ge=0, le=86400)
    tour_api_service_key: SecretStr | None = None
    external_sync_poll_interval: float = Field(default=5, ge=0.1, le=300)
    external_sync_http_timeout: float = Field(default=15, ge=1, le=120)
    external_sync_lease_seconds: int = Field(default=300, ge=30, le=3600)
    external_sync_max_attempts: int = Field(default=3, ge=1, le=10)
    external_sync_retry_base_seconds: float = Field(default=5, ge=0.1, le=3600)
    agent_max_iterations: int = Field(default=3,ge=1,le=8)
    agent_tool_retries: int = Field(default=2,ge=0,le=4)
    agent_max_tool_rounds: int = Field(default=8,ge=2,le=16)
    agent_max_tool_calls: int = Field(default=12,ge=3,le=32)
    database_url: str | None = None
    database_required: bool = False
    database_pool_min_size: int = 1
    database_pool_max_size: int = 5
    database_authenticated_role: str = "authenticated"
    database_anon_role: str = "anon"
    supabase_url: str | None = None
    # Public Supabase client key used for Auth sign-up/sign-in requests.
    # This is not used to verify JWTs; keep SUPABASE_JWT_SECRET separate.
    supabase_key: SecretStr | None = None
    supabase_jwt_secret: str | None = None
    supabase_jwt_audience: str = "authenticated"
    supabase_jwt_issuer: str | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()
