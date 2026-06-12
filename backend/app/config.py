"""Application settings.

Everything that differs between local dev and a deployed environment lives
here and is driven by environment variables (see .env.example).
"""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # SQLite for zero-setup local dev; point at Postgres (e.g. Neon) in prod.
    database_url: str = "sqlite:///./crm.db"

    # Where the stubbed channel service lives, and the public URL of *this*
    # service that the channel will call back into with delivery receipts.
    channel_service_url: str = "http://localhost:8001"
    crm_public_url: str = "http://localhost:8000"

    # Shared secret used to HMAC-sign receipt callbacks (channel -> CRM).
    webhook_secret: str = "dev-secret-change-me"

    # AI — two interchangeable providers, picked automatically:
    #   1. Anthropic (first-class): set ANTHROPIC_API_KEY.
    #   2. Any OpenAI-compatible endpoint (free tiers: Groq, Google Gemini,
    #      OpenRouter, local Ollama): set AI_API_KEY + AI_BASE_URL + AI_MODEL.
    anthropic_api_key: str = ""
    ai_api_key: str = ""
    ai_base_url: str = ""  # e.g. https://api.groq.com/openai/v1
    ai_model: str = "claude-sonnet-4-6"

    @property
    def ai_provider(self) -> str:
        """'anthropic' | 'openai' | '' (AI disabled)."""
        if self.anthropic_api_key:
            return "anthropic"
        if self.ai_api_key and self.ai_base_url:
            return "openai"
        return ""

    # Dispatch tuning
    send_batch_size: int = 100


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
