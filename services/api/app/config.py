from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    """Runtime configuration. Every value comes from PHOTOBOOTH_* environment variables."""

    model_config = SettingsConfigDict(env_prefix="PHOTOBOOTH_", env_file=".env", extra="ignore")

    templates_dir: Path = REPO_ROOT / "templates"
    cors_origins: str = "http://localhost:5173"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]
