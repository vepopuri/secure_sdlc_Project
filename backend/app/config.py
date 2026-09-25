"""Application settings, loaded from environment variables (never hard-coded secrets)."""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def normalize_database_url(url: str) -> str:
    """Accept postgres:// and postgresql:// URLs and force the psycopg 3 driver.

    Neon, Vercel and Heroku hand out ``postgres://`` URLs; SQLAlchemy needs an explicit
    driver name to use psycopg 3 instead of psycopg2.
    """
    url = url.strip()
    for prefix in ("postgres://", "postgresql://", "postgresql+psycopg2://", "postgresql+psycopg://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = Field(default="development", alias="APP_ENV")
    database_url: str = Field(default="sqlite:///./ssdlc.db", alias="DATABASE_URL")

    # Shared secret with the Next.js frontend; used to verify HS256 JWTs.
    auth_secret: str = Field(default="", alias="AUTH_SECRET")
    jwt_issuer: str = Field(default="ssdlc-frontend", alias="JWT_ISSUER")
    jwt_audience: str = Field(default="ssdlc-api", alias="JWT_AUDIENCE")

    # Comma-separated list of allowed browser origins (the frontend URL).
    cors_origins: str = Field(default="http://localhost:3000", alias="CORS_ORIGINS")

    # Claude API
    anthropic_api_key: str = Field(default="", alias="ANTHROPIC_API_KEY")
    anthropic_model: str = Field(default="claude-opus-5", alias="ANTHROPIC_MODEL")
    anthropic_effort: str = Field(default="medium", alias="ANTHROPIC_EFFORT")
    anthropic_max_tokens: int = Field(default=16000, alias="ANTHROPIC_MAX_TOKENS")
    anthropic_fallbacks: bool = Field(default=True, alias="ANTHROPIC_FALLBACKS")
    # Upper bound on evidence characters sent to the model per request (~4 chars/token).
    evidence_char_budget: int = Field(default=600_000, alias="EVIDENCE_CHAR_BUDGET")

    # Uploads
    max_direct_upload_mb: float = Field(default=4.0, alias="MAX_DIRECT_UPLOAD_MB")
    max_blob_upload_mb: float = Field(default=50.0, alias="MAX_BLOB_UPLOAD_MB")
    blob_allowed_hosts: str = Field(
        default=".public.blob.vercel-storage.com", alias="BLOB_ALLOWED_HOSTS"
    )

    @field_validator("database_url")
    @classmethod
    def _normalize(cls, v: str) -> str:
        return normalize_database_url(v)

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip().rstrip("/") for o in self.cors_origins.split(",") if o.strip()]

    @property
    def blob_host_suffixes(self) -> list[str]:
        return [h.strip().lower() for h in self.blob_allowed_hosts.split(",") if h.strip()]

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")


@lru_cache
def get_settings() -> Settings:
    return Settings()
