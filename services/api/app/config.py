from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]
API_ROOT = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    """Runtime configuration. Every value comes from PHOTOBOOTH_* environment variables."""

    model_config = SettingsConfigDict(env_prefix="PHOTOBOOTH_", env_file=".env", extra="ignore")

    templates_dir: Path = REPO_ROOT / "templates"
    cors_origins: str = (
        "http://localhost:5173,https://photobooth.accurova.com,"
        "https://accurova-photobooth.juliancheung.workers.dev"
    )

    # Where session metadata lives. SQLite today; a Supabase adapter follows
    # once a project exists (schema: infra/supabase/migrations).
    database_path: Path = API_ROOT / "data" / "photobooth.sqlite3"

    # Where final photographs live.
    storage_backend: Literal["local", "r2"] = "local"
    storage_dir: Path = API_ROOT / "data" / "objects"
    r2_account_id: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_bucket: str = ""

    # Retention and limits.
    session_ttl_minutes: int = 30
    link_expiry_hours: float = 24
    max_upload_mb: float = 25
    max_image_edge_px: int = 12000
    rate_limit_per_minute: int = 30

    # Segmentation. "none" refuses processing; "mock" is for development only.
    segmentation_provider: Literal["none", "mock", "http"] = "none"
    segmentation_url: str = ""
    segmentation_api_key: str = ""
    segmentation_timeout_seconds: float = 60
    # A job with no progress for this long is failed so the kiosk can recover.
    job_timeout_seconds: float = 120
    max_job_attempts: int = 3
    # Originals are deleted after successful processing unless retention is authorised.
    retain_originals: bool = False

    # Bearer token for /api/admin/* (except health). Admin endpoints are
    # disabled while this is empty.
    admin_token: str = ""

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def max_upload_bytes(self) -> int:
        return int(self.max_upload_mb * 1024 * 1024)
