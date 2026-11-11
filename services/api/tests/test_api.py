import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import REPO_ROOT, Settings
from app.main import create_app


@pytest.fixture
def data_dir(tmp_path_factory) -> Path:
    return tmp_path_factory.mktemp("data")


@pytest.fixture
def make_client(data_dir: Path):
    def make(root: Path) -> TestClient:
        settings = Settings(
            templates_dir=root, database_path=data_dir / "db.sqlite3", storage_dir=data_dir / "objects"
        )
        return TestClient(create_app(settings))

    return make


@pytest.fixture
def client(make_client) -> TestClient:
    return make_client(REPO_ROOT / "templates")


def test_health_reports_unconnected_services_honestly(client: TestClient):
    body = client.get("/api/admin/health").json()
    assert body["status"] == "ok"
    assert body["templates"] >= 1
    assert body["services"] == {"storage": "local", "database": "local", "segmentation": "not-configured"}


def test_lists_enabled_templates(client: TestClient):
    ids = [t["id"] for t in client.get("/api/templates").json()["templates"]]
    assert "little-red-dot-tours" in ids


def test_returns_full_template(client: TestClient):
    body = client.get("/api/templates/little-red-dot-tours").json()
    assert body["name"] == "Little Red Dot Tours"
    assert len(body["backgrounds"]) == 6
    assert body["frames"][0]["sponsorSlots"][0]["id"] == "sponsor-primary"


@pytest.mark.parametrize("template_id", ["unknown", "..", "UPPER", "a%2Fb", "little-red-dot-tours.json"])
def test_unknown_or_unsafe_ids_are_404(client: TestClient, template_id: str):
    assert client.get(f"/api/templates/{template_id}").status_code == 404


def test_disabled_templates_are_hidden(tmp_path: Path, make_client):
    (tmp_path / "index.json").write_text(
        json.dumps({"schemaVersion": 1, "templates": [{"id": "off", "name": "Off", "enabled": False}]})
    )
    client = make_client(tmp_path)
    assert client.get("/api/templates").json() == {"templates": []}
    assert client.get("/api/templates/off").status_code == 404


def test_invalid_template_is_a_server_error_not_a_crash(tmp_path: Path, make_client):
    (tmp_path / "index.json").write_text(
        json.dumps({"schemaVersion": 1, "templates": [{"id": "bad", "name": "Bad", "enabled": True}]})
    )
    (tmp_path / "bad").mkdir()
    (tmp_path / "bad" / "template.json").write_text('{"id": "bad"}')
    response = make_client(tmp_path).get("/api/templates/bad")
    assert response.status_code == 500
    assert "invalid" in response.json()["detail"]


def test_missing_templates_dir_is_empty_not_fatal(tmp_path: Path, make_client):
    client = make_client(tmp_path / "nope")
    assert client.get("/api/templates").json() == {"templates": []}
    assert client.get("/api/admin/health").json()["templates"] == 0
