"""Settings loaded from environment variables (CONTRACT section 4)."""
from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

PILOT_INSTITUTION_ID = "00000000-0000-0000-0000-000000000001"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    supabase_url: str = ""
    supabase_jwt_secret: str = ""
    database_url: str = ""
    gemini_api_key: str = ""
    gemini_model: str = "gemini-flash-latest"
    gemini_base_url: str = "https://generativelanguage.googleapis.com/v1beta"
    gemini_timeout_s: float = 20.0
    gemini_retry_delay_s: float = 2.0
    cors_origins: str = ""
    env: str = "development"
    dev_auth: bool = False
    # "db" or "file:<path>" (local development without a database)
    map_source: str = "db"
    institution_id: str = PILOT_INSTITUTION_ID
    ai_rate_limit_calls: int = 20
    ai_rate_limit_window_s: float = 300.0
    max_image_bytes: int = 5 * 1024 * 1024
    max_audio_bytes: int = 2 * 1024 * 1024

    @property
    def is_production(self) -> bool:
        return self.env.strip().lower() == "production"

    @property
    def dev_auth_enabled(self) -> bool:
        """DEV_AUTH is never honoured in production."""
        return self.dev_auth and not self.is_production

    @property
    def cors_list(self) -> list[str]:
        items = [o.strip() for o in self.cors_origins.split(",") if o.strip()]
        if not items and not self.is_production:
            return ["*"]
        return items


@lru_cache
def get_settings() -> Settings:
    return Settings()
