"""Application settings loaded from environment variables / the project-root .env file."""
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def to_sqlalchemy_url(url: str) -> str:
    """Hosting providers (e.g. Render) hand out postgres:// or postgresql:// URLs;
    SQLAlchemy needs the driver named explicitly to use psycopg 3."""
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=PROJECT_ROOT / ".env", extra="ignore")

    database_url: str = "postgresql+psycopg://traceverify:change-me@localhost:5432/traceverify"
    test_database_url: str | None = None
    # Browser origins allowed to call the API: an exact comma-separated list and/or a regex.
    cors_origins: str = ""
    cors_origin_regex: str = r"^http://(localhost|127\.0\.0\.1)(:\d+)?$"

    # Default investigation parameters (overridable per request, except the threshold: it is a fixed,
    # validated system setting applied to every investigation run)
    default_window_before: int = 300
    default_window_after: int = 1800
    default_threshold: float = 0.60
    default_weight_entity: float = 0.40
    default_weight_temporal: float = 0.30
    default_weight_rule: float = 0.30
    default_temporal_decay: float = 300.0
    default_max_hops: int = 3
    default_max_nodes: int = 60

    @field_validator("database_url", "test_database_url")
    @classmethod
    def _driver(cls, v: str | None) -> str | None:
        return to_sqlalchemy_url(v) if v else v

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip().rstrip("/") for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
