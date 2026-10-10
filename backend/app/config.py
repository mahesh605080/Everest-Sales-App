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
    refresh_grace_seconds: int = Field(30, alias="REFRESH_GRACE_SECONDS", ge=0, le=300)  # a refresh whose answer was lost may be repeated this long
    login_max_fails: int = Field(5, alias="LOGIN_MAX_FAILS", ge=3, le=20)
    login_lock_minutes: int = Field(15, alias="LOGIN_LOCK_MINUTES", ge=1)
    login_max_per_ip: int = Field(20, alias="LOGIN_MAX_FAILS_PER_IP", ge=5)
    reset_minutes: int = Field(30, alias="PASSWORD_RESET_MINUTES", ge=5, le=1440)
    public_url: str = Field("", alias="PUBLIC_URL")  # https address of the web app, used in emailed links
    smtp_host: str = Field("", alias="SMTP_HOST")
    smtp_port: int = Field(587, alias="SMTP_PORT")
    smtp_user: str = Field("", alias="SMTP_USER")
    smtp_password: str = Field("", alias="SMTP_PASSWORD")
    smtp_from: str = Field("", alias="SMTP_FROM")
    # Web Push (VAPID). Make a pair with:  python -m app.cli vapid   The private key stays on the server.
    vapid_public_key: str = Field("", alias="VAPID_PUBLIC_KEY")
    vapid_private_key: str = Field("", alias="VAPID_PRIVATE_KEY")
    vapid_subject: str = Field("", alias="VAPID_SUBJECT")  # mailto:someone@yourcompany or the site's https address
    # iPhone push, directly to Apple. All four are needed, plus the key file's contents.
    apns_key: str = Field("", alias="APNS_KEY")            # contents of the .p8 key file
    apns_key_id: str = Field("", alias="APNS_KEY_ID")
    apns_team_id: str = Field("", alias="APNS_TEAM_ID")
    apns_topic: str = Field("", alias="APNS_TOPIC")        # the app's bundle id
    apns_sandbox: bool = Field(False, alias="APNS_SANDBOX")
    notify_max_attempts: int = Field(6, alias="NOTIFY_MAX_ATTEMPTS", ge=1, le=12)
    notify_per_user_hour: int = Field(30, alias="NOTIFY_MAX_PER_USER_PER_HOUR", ge=1)  # more than this to one person in an hour is held back
    notify_batch: int = Field(50, alias="NOTIFY_BATCH", ge=1, le=500)
    # Browsers hand us the address of their vendor's push service. We only ever post to these hosts, so a made-up subscription cannot make the server call somewhere else.
    push_hosts: str = Field("fcm.googleapis.com,updates.push.services.mozilla.com,web.push.apple.com,notify.windows.com,push.apple.com", alias="PUSH_ENDPOINT_HOSTS")
    # The web app has alert rules that need a regular nudge. With both set, the scheduler calls it; the address is never taken from a request.
    web_internal_url: str = Field("", alias="WEB_INTERNAL_URL")  # e.g. http://app:3000 inside Docker
    cron_secret: str = Field("", alias="CRON_SECRET")            # the same value the web app has
    worker_enabled: bool = Field(True, alias="PLATFORM_WORKER")  # run the background worker inside this process
    files_dir: str = Field("./data/files", alias="FILES_DIR")  # where uploaded files are kept; a volume in production
    file_max_bytes: int = Field(10 * 1024 * 1024, alias="FILE_MAX_BYTES", ge=1024)
    file_quota_bytes: int = Field(200 * 1024 * 1024, alias="FILE_QUOTA_BYTES", ge=1024)  # default allowance per person
    file_link_max_seconds: int = Field(3600, alias="FILE_LINK_MAX_SECONDS", ge=60, le=86400)

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
    def webpush_ready(self) -> bool:
        return bool(self.vapid_public_key and self.vapid_private_key and self.vapid_subject)

    @property
    def apns_ready(self) -> bool:
        return bool(self.apns_key and self.apns_key_id and self.apns_team_id and self.apns_topic)

    @property
    def origins(self) -> list[str]:
        return [o.strip().rstrip("/") for o in self.cors_origins.split(",") if o.strip()]

    @property
    def web_cron_ready(self) -> bool:
        return bool(self.web_internal_url.startswith(("http://", "https://")) and len(self.cron_secret) >= 16)

    def problems(self) -> list[str]:
        """Configuration that works but should be fixed. Shown to the Super Admin; never includes the values themselves."""
        out = []
        if self.auth_secret == DEV_SECRET:
            out.append("AUTH_SECRET is the development default")
        elif len(self.auth_secret) < 32:
            out.append("AUTH_SECRET is shorter than 32 characters")
        if not (self.vapid_public_key and self.vapid_private_key and self.vapid_subject):
            out.append("VAPID keys are not set: browser push notifications are off")
        if not self.smtp_host:
            out.append("SMTP is not configured: password reset works only through an administrator")
        if self.env != "production":
            out.append(f"PLATFORM_ENV is '{self.env}', not 'production'")
        return out


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
