"""All configuration comes from environment variables. Nothing secret has a usable default in production."""
from functools import lru_cache

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEV_SECRET = "dev-only-secret-change-me-please"  # noqa: S105  the same development fallback the web app uses


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    env: str = Field("development", alias="PLATFORM_ENV")  # development | test | production
    database_url: str = Field(..., alias="DATABASE_URL")
    auth_secret: str = Field(DEV_SECRET, alias="AUTH_SECRET")  # shared with the web app so both accept each other's tokens
    cors_origins: str = Field("", alias="CORS_ORIGINS")  # comma-separated allowlist; empty means same-origin only
    access_token_minutes: int = Field(15, alias="ACCESS_TOKEN_MINUTES", ge=1, le=120)
    refresh_token_days: int = Field(30, alias="REFRESH_TOKEN_DAYS", ge=1, le=180)
    max_body_bytes: int = Field(1_048_576, alias="MAX_BODY_BYTES", ge=1024)  # uploads get their own, larger limit
    db_pool_size: int = Field(5, alias="DB_POOL_SIZE", ge=1, le=50)
    statement_timeout_ms: int = Field(15000, alias="DB_STATEMENT_TIMEOUT_MS", ge=100)
    trusted_proxy: bool = Field(True, alias="TRUSTED_PROXY")  # take the client address from the reverse proxy's header
    log_level: str = Field("INFO", alias="LOG_LEVEL")

    @field_validator("database_url")
    @classmethod
    def _driver(cls, v: str) -> str:
        # The web app's URL is postgresql://...; SQLAlchemy needs the driver named.
        if v.startswith("postgres://"):
            v = "postgresql://" + v[len("postgres://"):]
        if v.startswith("postgresql://"):
            v = "postgresql+psycopg://" + v[len("postgresql://"):]
        return v

    @model_validator(mode="after")
    def _production_is_strict(self):
        if self.env == "production" and (self.auth_secret == DEV_SECRET or len(self.auth_secret) < 32):
            raise ValueError("AUTH_SECRET must be set to at least 32 random characters in production")
        return self

    @property
    def origins(self) -> list[str]:
        return [o.strip().rstrip("/") for o in self.cors_origins.split(",") if o.strip()]

    def problems(self) -> list[str]:
        """Configuration that works but should be fixed. Shown to the Super Admin; never includes the values themselves."""
        out = []
        if self.auth_secret == DEV_SECRET:
            out.append("AUTH_SECRET is the development default")
        elif len(self.auth_secret) < 32:
            out.append("AUTH_SECRET is shorter than 32 characters")
        if self.env != "production":
            out.append(f"PLATFORM_ENV is '{self.env}', not 'production'")
        return out


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
