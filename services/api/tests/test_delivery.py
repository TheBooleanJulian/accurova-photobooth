import io
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from PIL import Image

from app.config import REPO_ROOT, Settings
from app.main import create_app
from app.retention import cleanup_expired
from app.security import RateLimiter
from app.sessions import SessionStore, hash_token
from app.storage import LocalStorage, ObjectNotFound, R2Storage

TEMPLATE = "little-red-dot-tours"


def jpeg(width: int = 108, height: int = 192) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), (142, 27, 27)).save(buffer, "JPEG")
    return buffer.getvalue()


def png() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (10, 10)).save(buffer, "PNG")
    return buffer.getvalue()


class Clock:
    def __init__(self):
        self.now = datetime(2026, 11, 11, 12, 0, tzinfo=timezone.utc)

    def __call__(self) -> datetime:
        return self.now

    def advance(self, **kwargs) -> None:
        self.now += timedelta(**kwargs)


@pytest.fixture
def env(tmp_path: Path):
    settings = Settings(
        templates_dir=REPO_ROOT / "templates",
        database_path=tmp_path / "db.sqlite3",
        storage_dir=tmp_path / "objects",
        admin_token="secret-admin",
        rate_limit_per_minute=1000,
        max_upload_mb=1,
    )
    app = create_app(settings)
    clock = Clock()
    app.state.services.clock = clock
    return TestClient(app), app.state.services, clock


def start(client: TestClient) -> str:
    response = client.post("/api/session/create", json={"templateId": TEMPLATE})
    assert response.status_code == 201
    return response.json()["sessionId"]


def upload(client: TestClient, session_id: str, data: bytes | None = None):
    return client.put(
        f"/api/session/{session_id}/result", content=jpeg() if data is None else data, headers={"Content-Type": "image/jpeg"}
    )


def test_full_delivery_flow(env):
    client, services, _ = env
    session_id = start(client)
    assert client.get(f"/api/session/{session_id}/result").json()["hasResult"] is False

    photo = jpeg()
    delivered = upload(client, session_id, photo).json()
    assert (delivered["width"], delivered["height"]) == (108, 192)

    info = client.get(delivered["infoUrl"]).json()
    assert info["templateId"] == TEMPLATE

    download = client.get(delivered["imageUrl"])
    assert download.status_code == 200
    assert download.content == photo  # delivered byte-for-byte, never re-encoded
    assert download.headers["content-type"] == "image/jpeg"
    assert "attachment" in download.headers["content-disposition"]
    assert download.headers["cache-control"] == "private, no-store"

    assert client.post(f"/api/session/{session_id}/complete").json()["status"] == "complete"
    # Completing the kiosk session must not kill the visitor's link.
    assert client.get(delivered["imageUrl"]).status_code == 200
    assert services.sessions.get(session_id).status == "complete"


def test_session_ids_and_tokens_are_random_and_tokens_are_not_stored(env):
    client, services, _ = env
    ids = {start(client) for _ in range(5)}
    assert len(ids) == 5
    token = upload(client, ids.pop()).json()["token"]
    assert len(token) >= 43
    raw = Path(services.settings.database_path).read_bytes()
    assert token.encode() not in raw
    assert hash_token(token).encode() in raw


def test_unknown_template_and_unknown_session(env):
    client, _, _ = env
    assert client.post("/api/session/create", json={"templateId": "nope"}).status_code == 404
    assert client.get("/api/session/not-a-session/result").status_code == 404
    assert upload(client, "not-a-session").status_code == 404
    assert client.get("/api/download/not-a-token").status_code == 404


@pytest.mark.parametrize(
    "data, status",
    [(b"", 400), (b"not an image", 415), (png(), 415), (jpeg()[:200], 415), (b"\xff\xd8" + b"0" * 2_000_000, 413)],
)
def test_rejects_bad_uploads(env, data, status):
    client, services, _ = env
    session_id = start(client)
    assert upload(client, session_id, data).status_code == status
    assert services.sessions.get(session_id).has_result is False


def test_rejects_oversized_dimensions(tmp_path: Path):
    settings = Settings(
        templates_dir=REPO_ROOT / "templates",
        database_path=tmp_path / "db.sqlite3",
        storage_dir=tmp_path / "o",
        max_image_edge_px=100,
    )
    client = TestClient(create_app(settings))
    assert upload(client, start(client), jpeg(50, 200)).status_code == 413


def test_retry_replaces_the_image_and_revokes_the_old_link(env):
    client, _, _ = env
    session_id = start(client)
    first = upload(client, session_id, jpeg(100, 100)).json()
    second = upload(client, session_id, jpeg(120, 120)).json()
    assert first["token"] != second["token"]
    assert client.get(first["imageUrl"]).status_code == 404
    assert client.get(second["infoUrl"]).json()["width"] == 120


def test_abandoned_session_expires(env):
    client, _, clock = env
    session_id = start(client)
    clock.advance(minutes=31)
    assert client.get(f"/api/session/{session_id}/result").status_code == 404
    assert upload(client, session_id).status_code == 404


def test_link_expires_after_24_hours_and_cleanup_deletes_everything(env):
    client, services, clock = env
    session_id = start(client)
    delivered = upload(client, session_id).json()
    key = services.sessions.get(session_id).result_key

    clock.advance(hours=23, minutes=59)
    assert client.get(delivered["imageUrl"]).status_code == 200

    clock.advance(minutes=2)
    assert client.get(delivered["imageUrl"]).status_code == 404
    assert client.get(delivered["infoUrl"]).status_code == 404
    services.storage.get(key)  # still on disk until cleanup runs

    admin = {"Authorization": "Bearer secret-admin"}
    assert client.post("/api/admin/cleanup", headers=admin).json() == {
        "sessions_deleted": 1,
        "images_deleted": 1,
        "errors": 0,
    }
    with pytest.raises(ObjectNotFound):
        services.storage.get(key)
    assert services.sessions.count() == 0


def test_cleanup_leaves_live_sessions_alone_and_retries_failed_deletes(env):
    client, services, clock = env
    live = start(client)
    upload(client, live)
    stale = start(client)
    upload(client, stale)
    # Make only `stale` expire.
    services.sessions.attach_result(stale, f"results/{stale}.jpg", 1, 1, clock.now - timedelta(seconds=1))

    class Failing:
        def delete(self, key):
            raise RuntimeError("storage offline")

    report = cleanup_expired(services.sessions, Failing(), clock.now)
    assert (report.sessions_deleted, report.errors) == (0, 1)
    assert services.sessions.get(stale) is not None  # kept so the next run retries

    report = cleanup_expired(services.sessions, services.storage, clock.now)
    assert report.sessions_deleted == 1
    assert services.sessions.get(live) is not None


def test_admin_endpoints_need_the_token(env, tmp_path: Path):
    client, _, _ = env
    assert client.post("/api/admin/cleanup").status_code == 401
    assert client.post("/api/admin/cleanup", headers={"Authorization": "Bearer wrong"}).status_code == 401

    unconfigured = TestClient(
        create_app(
            Settings(
                templates_dir=REPO_ROOT / "templates", database_path=tmp_path / "u.sqlite3", storage_dir=tmp_path / "u"
            )
        )
    )
    assert unconfigured.post("/api/admin/cleanup").status_code == 503


def test_rate_limit(tmp_path: Path):
    settings = Settings(
        templates_dir=REPO_ROOT / "templates",
        database_path=tmp_path / "db.sqlite3",
        storage_dir=tmp_path / "o",
        rate_limit_per_minute=3,
    )
    client = TestClient(create_app(settings))
    codes = [client.post("/api/session/create", json={"templateId": TEMPLATE}).status_code for _ in range(5)]
    assert codes == [201, 201, 201, 429, 429]

    limiter = RateLimiter(2)
    limiter.check("a", now=0)
    limiter.check("a", now=1)
    limiter.check("b", now=1)
    with pytest.raises(HTTPException):
        limiter.check("a", now=59)
    limiter.check("a", now=61)  # the window slid


def test_local_storage_is_confined_to_its_root(tmp_path: Path):
    storage = LocalStorage(tmp_path / "objects")
    storage.put("results/a.jpg", b"x", "image/jpeg")
    assert storage.get("results/a.jpg") == b"x"
    storage.delete("results/a.jpg")
    storage.delete("results/a.jpg")  # idempotent
    with pytest.raises(ObjectNotFound):
        storage.get("results/a.jpg")
    with pytest.raises(ValueError):
        storage.put("../escape.jpg", b"x", "image/jpeg")


def test_r2_adapter_against_a_fake_client():
    """SIMULATED: exercises the adapter's calls, not a real R2 bucket."""

    class Missing(Exception):
        response = {"Error": {"Code": "NoSuchKey"}}

    class FakeS3:
        def __init__(self):
            self.objects = {}

        def put_object(self, Bucket, Key, Body, ContentType):
            self.objects[(Bucket, Key)] = (Body, ContentType)

        def get_object(self, Bucket, Key):
            if (Bucket, Key) not in self.objects:
                raise Missing()
            return {"Body": io.BytesIO(self.objects[(Bucket, Key)][0])}

        def delete_object(self, Bucket, Key):
            self.objects.pop((Bucket, Key), None)

        def head_bucket(self, Bucket):
            if Bucket != "photos":
                raise RuntimeError("no such bucket")

    client = FakeS3()
    storage = R2Storage("photos", client)
    storage.put("results/a.jpg", b"jpeg", "image/jpeg")
    assert client.objects[("photos", "results/a.jpg")] == (b"jpeg", "image/jpeg")
    assert storage.get("results/a.jpg") == b"jpeg"
    storage.delete("results/a.jpg")
    with pytest.raises(ObjectNotFound):
        storage.get("results/a.jpg")
    assert storage.status() == "connected"
    assert R2Storage("other", client).status() == "error"


def test_r2_requires_full_configuration(tmp_path: Path):
    settings = Settings(storage_backend="r2", database_path=tmp_path / "db.sqlite3", r2_bucket="photos")
    with pytest.raises(RuntimeError, match="missing r2_account_id"):
        create_app(settings)


def test_session_store_survives_reopening(tmp_path: Path):
    path = tmp_path / "db.sqlite3"
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    created = SessionStore(path).create(TEMPLATE, timedelta(minutes=30), now)
    reopened = SessionStore(path).get(created.id)
    assert reopened == created
    assert reopened.expires_at == now + timedelta(minutes=30)
