"""The Supabase stores, run against an in-memory PostgREST emulator.

SIMULATED: the emulator implements only the PostgREST features the stores
use (eq / gt / lte / not.is.null filters, on_conflict with ignore-duplicates,
Prefer: return=representation). It checks the adapter's logic and that the
whole API works on these stores; it is not a real Supabase project.
"""

import io
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.config import REPO_ROOT, Settings
from app.main import create_app
from app.segmentation import MockSegmentation
from app.supabase import DatabaseError, SupabaseJobStore, SupabaseSessionStore, build_client

TEMPLATE = "little-red-dot-tours"
NOW = datetime(2026, 11, 12, 9, 0, tzinfo=timezone.utc)


class FakePostgrest:
    def __init__(self):
        self.tables: dict[str, list[dict]] = {"sessions": [], "jobs": []}
        self.requests: list[httpx.Request] = []
        self.fail = False

    @staticmethod
    def _matches(row: dict, column: str, expression: str) -> bool:
        value = row.get(column)
        if expression == "not.is.null":
            return value is not None
        operator, _, operand = expression.partition(".")
        if operator == "eq":
            return str(value) == operand
        if value is None:
            return False
        left, right = datetime.fromisoformat(value), datetime.fromisoformat(operand)
        return left > right if operator == "gt" else left <= right

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.fail:
            return httpx.Response(503)
        assert request.headers["apikey"] == "service-key"
        assert request.headers["authorization"] == "Bearer service-key"
        table = self.tables[request.url.path.rsplit("/", 1)[-1]]
        params = dict(request.url.params)
        filters = {k: v for k, v in params.items() if k not in ("select", "on_conflict", "limit")}
        selected = [row for row in table if all(self._matches(row, c, e) for c, e in filters.items())]

        if request.method == "GET":
            return httpx.Response(200, json=selected)
        if request.method == "POST":
            row = json.loads(request.content)
            conflict = params.get("on_conflict")
            if conflict and any(existing[conflict] == row[conflict] for existing in table):
                assert "resolution=ignore-duplicates" in request.headers["prefer"]
                return httpx.Response(201, json=[])
            defaults = {"attempts": 1} if table is self.tables["jobs"] else {}
            table.append({**defaults, **row})
            return httpx.Response(201, json=[table[-1]])
        if request.method == "PATCH":
            for row in selected:
                row.update(json.loads(request.content))
            return httpx.Response(200, json=selected)
        if request.method == "DELETE":
            for row in selected:
                table.remove(row)
                if table is self.tables["sessions"]:  # on delete cascade
                    self.tables["jobs"][:] = [j for j in self.tables["jobs"] if j["session_id"] != row["id"]]
            return httpx.Response(204)
        return httpx.Response(405)


@pytest.fixture
def fake() -> FakePostgrest:
    return FakePostgrest()


@pytest.fixture
def stores(fake: FakePostgrest):
    client = httpx.Client(
        base_url="https://project.supabase.co/rest/v1",
        headers={"apikey": "service-key", "Authorization": "Bearer service-key"},
        transport=httpx.MockTransport(fake.handler),
    )
    return SupabaseSessionStore(client), SupabaseJobStore(client)


def jpeg(width: int = 300, height: int = 400) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), (120, 90, 60)).save(buffer, "JPEG")
    return buffer.getvalue()


def test_session_lifecycle(stores, fake):
    sessions, _ = stores
    created = sessions.create(TEMPLATE, timedelta(minutes=30), NOW)
    assert created.status == "active" and created.expires_at == NOW + timedelta(minutes=30)
    assert sessions.get(created.id) == created
    assert sessions.get("not-a-uuid") is None

    token = sessions.attach_result(created.id, "results/x.jpg", 1080, 1920, NOW + timedelta(hours=24))
    stored = fake.tables["sessions"][0]
    assert token not in json.dumps(stored)  # only the hash is stored
    found = sessions.find_by_token(token, NOW + timedelta(hours=23))
    assert found and found.status == "delivered" and found.result_width == 1080
    assert sessions.find_by_token(token, NOW + timedelta(hours=25)) is None
    assert sessions.find_by_token("wrong", NOW) is None

    sessions.complete(created.id, NOW)
    assert sessions.get(created.id).completed_at == NOW
    assert [s.id for s in sessions.expired(NOW + timedelta(hours=25))] == [created.id]
    assert sessions.expired(NOW) == []
    sessions.delete(created.id)
    assert sessions.count() == 0


def test_job_lifecycle_and_idempotent_start(stores):
    sessions, jobs = stores
    session = sessions.create(TEMPLATE, timedelta(minutes=30), NOW)
    job, created = jobs.start(session.id, NOW)
    again, created_again = jobs.start(session.id, NOW)
    assert (created, created_again) == (True, False)
    assert again.id == job.id and again.attempts == 1

    jobs.mark(job.id, "failed", NOW, error="provider-error")
    jobs.retry(job.id, NOW)
    retried = jobs.get(job.id)
    assert (retried.status, retried.error, retried.attempts) == ("queued", None, 2)

    jobs.mark(job.id, "done", NOW, width=300, height=400, box_left=1, box_top=2, box_right=3, box_bottom=4)
    done = jobs.for_session(session.id)
    assert done.subject_box == (1, 2, 3, 4) and done.width == 300
    assert jobs.get("not-a-uuid") is None
    jobs.delete_for_session(session.id)
    assert jobs.get(job.id) is None


def test_database_failures_are_reported_not_swallowed(stores, fake):
    sessions, _ = stores
    assert sessions.status() == "connected"
    fake.fail = True
    assert sessions.status() == "error"
    with pytest.raises(DatabaseError, match="503"):
        sessions.create(TEMPLATE, timedelta(minutes=30), NOW)


def test_the_whole_api_runs_on_supabase_stores(stores, fake, tmp_path: Path):
    settings = Settings(
        templates_dir=REPO_ROOT / "templates",
        storage_dir=tmp_path / "objects",
        database_path=tmp_path / "unused.sqlite3",
        rate_limit_per_minute=1000,
        admin_token="secret-admin",
    )
    app = create_app(settings, segmentation=MockSegmentation(), database=stores)
    now = [NOW]
    app.state.services.clock = lambda: now[0]
    client = TestClient(app)

    assert client.get("/api/admin/health").json()["services"]["database"] == "connected"
    session_id = client.post("/api/session/create", json={"templateId": TEMPLATE}).json()["sessionId"]
    assert client.put(f"/api/session/{session_id}/capture", content=jpeg()).status_code == 200

    job_id = client.post(f"/api/session/{session_id}/process").json()["jobId"]
    assert client.post(f"/api/session/{session_id}/process").json()["jobId"] == job_id
    job = client.get(f"/api/process/{job_id}").json()
    assert job["status"] == "done" and job["subjectBox"]
    assert client.get(job["foregroundUrl"]).headers["content-type"] == "image/png"

    photo = jpeg(108, 192)
    delivered = client.put(f"/api/session/{session_id}/result", content=photo).json()
    assert client.get(delivered["imageUrl"]).content == photo
    assert fake.tables["jobs"] == []  # intermediates removed once delivered

    now[0] += timedelta(hours=25)
    assert client.get(delivered["imageUrl"]).status_code == 404
    report = client.post("/api/admin/cleanup", headers={"Authorization": "Bearer secret-admin"}).json()
    assert report == {"sessions_deleted": 1, "images_deleted": 1, "errors": 0}
    assert fake.tables["sessions"] == []
    assert not (tmp_path / "unused.sqlite3").exists()  # nothing touched local disk for metadata


def test_supabase_needs_full_configuration():
    with pytest.raises(RuntimeError, match="missing supabase_url, supabase_service_key"):
        build_client(Settings(database_backend="supabase"))
    client = build_client(
        Settings(database_backend="supabase", supabase_url="https://p.supabase.co/", supabase_service_key="k")
    )
    assert str(client.base_url) == "https://p.supabase.co/rest/v1/"
    assert client.headers["apikey"] == "k"
