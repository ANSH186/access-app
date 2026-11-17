"""Settings loaded from environment variables (CONTRACT section 4)."""
from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

PILOT_INSTITUTION_ID = "00000000-0000-0000-0000-000000000001"

# Public Supabase "publishable" key. It is safe to ship in a client app and is
# used only as the PostgREST `apikey` header when the API falls back to reading
# the campus map over Supabase REST (for example when DATABASE_URL is down).
# Row-level security still decides what the caller's JWT can read.
DEFAULT_SUPABASE_PUBLIC_KEY = "sb_publishable_MG6k_aUH1JSy20-r9q4SqQ_sdtJp4NT"

API_VERSION = "2.0.0"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    supabase_url: str = ""
    supabase_jwt_secret: str = ""
    # Optional override. The publishable key is public; the API also accepts a
    # service-role key here if an operator supplies one.
    supabase_public_key: str = DEFAULT_SUPABASE_PUBLIC_KEY
    database_url: str = ""
    gemini_api_key: str = ""
    gemini_model: str = "gemini-flash-lite-latest"
    gemini_fallback_models: str = "gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-3.8-flash,gemini-flash-latest"
    gemini_base_url: str = "https://generativelanguage.googleapis.com/v1beta"
    gemini_timeout_s: float = 45.0
    gemini_retry_delay_s: float = 1.5
    # Independent OCR fallback. "helloworld" is the public testing key; set your
    # own free OCR_SPACE_API_KEY for a real deployment.
    ocr_space_api_key: str = "helloworld"
    ocr_space_timeout_s: float = 15.0
    # How many Gemini models to race for OCR. 1 disables the race (tests).
    gemini_ocr_race_models: int = 2
    cors_origins: str = ""
    env: str = "development"
    dev_auth: bool = False
    # "db" or "file:<path>" (local development without a database)
    map_source: str = "db"
    # Additional outdoor campus graph, merged with the database map.
    campus_map_enabled: bool = True
    campus_map_path: str = "app/data/nie_north_campus.json"
    institution_id: str = PILOT_INSTITUTION_ID
    ai_rate_limit_calls: int = 40
    ai_rate_limit_window_s: float = 300.0
    news_cache_ttl_s: int = 300
    max_image_bytes: int = 5 * 1024 * 1024
    max_audio_bytes: int = 2 * 1024 * 1024

    @property
    def gemini_fallbacks(self) -> list[str]:
        return [m.strip() for m in self.gemini_fallback_models.split(",") if m.strip()]

    @property
    def public_supabase_key(self) -> str:
        return self.supabase_public_key.strip() or DEFAULT_SUPABASE_PUBLIC_KEY

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
