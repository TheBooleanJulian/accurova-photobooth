import io
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.config import REPO_ROOT, Settings
from app.jobs import capture_key, foreground_key
from app.main import create_app
from app.segmentation import HttpSegmentation, MockSegmentation, SegmentationError
from app.storage import ObjectNotFound

TEMPLATE = "little-red-dot-tours"


def jpeg(width: int = 300, height: int = 400, orientation: int | None = None) -> bytes:
    image = Image.new("RGB", (width, height), (90, 120, 150))
    buffer = io.BytesIO()
    if orientation:
        exif = Image.Exif()
        exif[0x0112] = orientation
        image.save(buffer, "JPEG", exif=exif)
    else:
        image.save(buffer, "JPEG")
    return buffer.getvalue()


class Clock:
    def __init__(self):
        self.now = datetime(2026, 11, 11, 12, 0, tzinfo=timezone.utc)

    def __call__(self) -> datetime:
        return self.now


class CountingMock(MockSegmentation):
    def __init__(self):
        self.calls = 0

    def segment(self, image):
        self.calls += 1
        return super().segment(image)


class Failing:
    name = "failing"

    def __init__(self, code: str = "provider-error"):
        self.code = code
        self.calls = 0

    def segment(self, image):
        self.calls += 1
        raise SegmentationError(self.code, "boom")

    def status(self) -> str:
        return "configured"


def build(tmp_path: Path, provider=None, **overrides):
    settings = Settings(
        templates_dir=REPO_ROOT / "templates",
        database_path=tmp_path / "db.sqlite3",
        storage_dir=tmp_path / "objects",
        rate_limit_per_minute=1000,
        admin_token="secret-admin",
        **overrides,
    )
    app = create_app(settings, segmentation=provider)
    clock = Clock()
    app.state.services.clock = clock
    return TestClient(app), app.state.services, clock


def start(client: TestClient) -> str:
    return client.post("/api/session/create", json={"templateId": TEMPLATE}).json()["sessionId"]


def capture(client: TestClient, session_id: str, data: bytes | None = None):
    return client.put(f"/api/session/{session_id}/capture", content=jpeg() if data is None else data)


def test_processing_is_refused_not_faked_when_unconfigured(tmp_path: Path):
    client, _, _ = build(tmp_path)
    session_id = start(client)
    capture(client, session_id)
    assert client.post(f"/api/session/{session_id}/process").status_code == 503
    assert client.get("/api/admin/health").json()["services"]["segmentation"] == "not-configured"


def test_capture_is_required_first(tmp_path: Path):
    client, _, _ = build(tmp_path, CountingMock())
    assert client.post(f"/api/session/{start(client)}/process").status_code == 409


def test_full_processing_flow_with_the_mock_provider(tmp_path: Path):
    provider = CountingMock()
    client, services, _ = build(tmp_path, provider)
    session_id = start(client)
    original = jpeg(300, 400)
    assert capture(client, session_id, original).json() == {
        "sessionId": session_id,
        "width": 300,
        "height": 400,
        "bytes": len(original),
    }
    assert services.storage.get(capture_key(session_id)) == original  # stored untouched

    accepted = client.post(f"/api/session/{session_id}/process")
    assert accepted.status_code == 202
    job = client.get(f"/api/process/{accepted.json()['jobId']}").json()
    assert job["status"] == "done"
    assert job["provider"] == "mock"
    assert (job["width"], job["height"]) == (300, 400)
    left, top, right, bottom = job["subjectBox"]
    assert 0 < left < right < 300 and 0 < top < bottom < 400

    png = client.get(job["foregroundUrl"])
    assert png.headers["content-type"] == "image/png"
    foreground = Image.open(io.BytesIO(png.content))
    assert foreground.mode == "RGBA" and foreground.size == (300, 400)
    assert foreground.getpixel((150, 200))[3] == 255  # torso is opaque
    assert foreground.getpixel((5, 5))[3] == 0  # corner is transparent

    # Originals are deleted after successful processing by default.
    with pytest.raises(ObjectNotFound):
        services.storage.get(capture_key(session_id))
    assert client.get("/api/admin/health").json()["services"]["segmentation"] == "mock"
    assert provider.calls == 1


def test_starting_twice_never_creates_a_second_job(tmp_path: Path):
    provider = CountingMock()
    client, _, _ = build(tmp_path, provider)
    session_id = start(client)
    capture(client, session_id)
    first = client.post(f"/api/session/{session_id}/process").json()
    second = client.post(f"/api/session/{session_id}/process").json()
    assert first["jobId"] == second["jobId"]
    assert second["status"] == "done"
    assert provider.calls == 1


def test_retake_discards_the_previous_job_and_foreground(tmp_path: Path):
    client, services, _ = build(tmp_path, CountingMock())
    session_id = start(client)
    capture(client, session_id)
    old = client.post(f"/api/session/{session_id}/process").json()["jobId"]

    capture(client, session_id, jpeg(200, 300))
    assert client.get(f"/api/process/{old}").status_code == 404
    with pytest.raises(ObjectNotFound):
        services.storage.get(foreground_key(old))

    new = client.post(f"/api/session/{session_id}/process").json()["jobId"]
    assert new != old
    assert client.get(f"/api/process/{new}").json()["width"] == 200


def test_failed_jobs_can_be_retried_a_limited_number_of_times(tmp_path: Path):
    provider = Failing()
    client, services, _ = build(tmp_path, provider, max_job_attempts=2)
    session_id = start(client)
    capture(client, session_id)

    job_id = client.post(f"/api/session/{session_id}/process").json()["jobId"]
    job = client.get(f"/api/process/{job_id}").json()
    assert (job["status"], job["error"], job["foregroundUrl"]) == ("failed", "provider-error", None)
    assert client.get(f"/api/process/{job_id}/foreground").status_code == 409
    services.storage.get(capture_key(session_id))  # original kept so a retry is possible

    retried = client.post(f"/api/session/{session_id}/process")
    assert retried.status_code == 202 and retried.json()["jobId"] == job_id
    assert client.get(f"/api/process/{job_id}").json()["attempts"] == 2
    assert client.post(f"/api/session/{session_id}/process").status_code == 409
    assert provider.calls == 2


def test_an_empty_mask_fails_as_no_subject(tmp_path: Path):
    class Empty(MockSegmentation):
        def segment(self, image):
            return Image.new("L", image.size, 0)

    client, _, _ = build(tmp_path, Empty())
    session_id = start(client)
    capture(client, session_id)
    job_id = client.post(f"/api/session/{session_id}/process").json()["jobId"]
    assert client.get(f"/api/process/{job_id}").json()["error"] == "no-subject"


def test_low_resolution_masks_are_scaled_to_the_photograph(tmp_path: Path):
    class Small(MockSegmentation):
        def segment(self, image):
            return super().segment(image.resize((64, 64)))

    client, _, _ = build(tmp_path, Small())
    session_id = start(client)
    capture(client, session_id, jpeg(600, 800))
    job = client.get(f"/api/process/{client.post(f'/api/session/{session_id}/process').json()['jobId']}").json()
    assert (job["status"], job["width"], job["height"]) == ("done", 600, 800)


def test_exif_rotation_is_applied_to_the_foreground(tmp_path: Path):
    client, _, _ = build(tmp_path, CountingMock())
    session_id = start(client)
    capture(client, session_id, jpeg(400, 300, orientation=6))  # stored sideways, meant to be portrait
    job = client.get(f"/api/process/{client.post(f'/api/session/{session_id}/process').json()['jobId']}").json()
    assert (job["width"], job["height"]) == (300, 400)


def test_a_stalled_job_times_out_instead_of_hanging(tmp_path: Path):
    client, services, clock = build(tmp_path, CountingMock(), job_timeout_seconds=120)
    session_id = start(client)
    capture(client, session_id)
    job, _ = services.jobs.start(session_id, clock.now)  # queued, but no worker ever picks it up

    assert client.get(f"/api/process/{job.id}").json()["status"] == "queued"
    clock.now += timedelta(seconds=121)
    stalled = client.get(f"/api/process/{job.id}").json()
    assert (stalled["status"], stalled["error"]) == ("failed", "timeout")

    # ...and the kiosk can recover by starting it again.
    assert client.post(f"/api/session/{session_id}/process").status_code == 202
    assert client.get(f"/api/process/{job.id}").json()["status"] == "done"


def test_originals_can_be_retained_when_authorised(tmp_path: Path):
    client, services, _ = build(tmp_path, CountingMock(), retain_originals=True)
    session_id = start(client)
    capture(client, session_id)
    client.post(f"/api/session/{session_id}/process")
    services.storage.get(capture_key(session_id))


def test_intermediates_are_deleted_once_the_final_photo_is_delivered(tmp_path: Path):
    client, services, _ = build(tmp_path, CountingMock(), retain_originals=True)
    session_id = start(client)
    capture(client, session_id)
    job_id = client.post(f"/api/session/{session_id}/process").json()["jobId"]

    assert client.put(f"/api/session/{session_id}/result", content=jpeg()).status_code == 200
    assert client.get(f"/api/process/{job_id}").status_code == 404
    for key in (capture_key(session_id), foreground_key(job_id)):
        with pytest.raises(ObjectNotFound):
            services.storage.get(key)
    # No new capture once the session has its final photograph.
    assert capture(client, session_id).status_code == 409


def test_cleanup_removes_intermediates_of_abandoned_sessions(tmp_path: Path):
    client, services, clock = build(tmp_path, CountingMock(), retain_originals=True)
    session_id = start(client)
    capture(client, session_id)
    job_id = client.post(f"/api/session/{session_id}/process").json()["jobId"]

    clock.now += timedelta(minutes=31)
    assert client.get(f"/api/process/{job_id}").status_code == 404  # session expired
    report = client.post("/api/admin/cleanup", headers={"Authorization": "Bearer secret-admin"}).json()
    assert report["sessions_deleted"] == 1
    for key in (capture_key(session_id), foreground_key(job_id)):
        with pytest.raises(ObjectNotFound):
            services.storage.get(key)
    assert services.jobs.get(job_id) is None


def test_rejects_non_jpeg_captures(tmp_path: Path):
    client, _, _ = build(tmp_path, CountingMock())
    assert capture(client, start(client), b"not an image").status_code == 415
    assert capture(client, "missing-session").status_code == 404


class TestHttpSegmentation:
    """SIMULATED transport: checks the adapter's contract, not a real inference service."""

    image = Image.new("RGB", (40, 60), (10, 20, 30))

    def provider(self, handler, **kwargs) -> HttpSegmentation:
        return HttpSegmentation(
            "https://inference.example/segment", client=httpx.Client(transport=httpx.MockTransport(handler)), **kwargs
        )

    @staticmethod
    def png(image: Image.Image) -> bytes:
        buffer = io.BytesIO()
        image.save(buffer, "PNG")
        return buffer.getvalue()

    def test_sends_a_jpeg_with_the_key_and_reads_the_alpha_channel(self):
        seen = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen["auth"] = request.headers.get("authorization")
            seen["type"] = request.headers["content-type"]
            seen["format"] = Image.open(io.BytesIO(request.content)).format
            rgba = Image.new("RGBA", (40, 60), (0, 0, 0, 0))
            rgba.paste((255, 255, 255, 255), (10, 10, 30, 50))
            return httpx.Response(200, content=self.png(rgba))

        mask = self.provider(handler, api_key="k123").segment(self.image)
        assert seen == {"auth": "Bearer k123", "type": "image/jpeg", "format": "JPEG"}
        assert mask.mode == "L" and mask.getpixel((20, 30)) == 255 and mask.getpixel((0, 0)) == 0

    def test_accepts_a_greyscale_mask(self):
        mask = self.provider(lambda r: httpx.Response(200, content=self.png(Image.new("L", (8, 8), 200)))).segment(
            self.image
        )
        assert mask.getpixel((0, 0)) == 200

    @pytest.mark.parametrize(
        "response, code",
        [
            (httpx.Response(500), "provider-error"),
            (httpx.Response(200, content=b"not a png"), "provider-error"),
        ],
    )
    def test_maps_bad_answers_to_error_codes(self, response, code):
        with pytest.raises(SegmentationError) as error:
            self.provider(lambda r: response).segment(self.image)
        assert error.value.code == code

    def test_maps_transport_failures(self):
        def timeout(request):
            raise httpx.ReadTimeout("slow", request=request)

        def refused(request):
            raise httpx.ConnectError("down", request=request)

        with pytest.raises(SegmentationError) as error:
            self.provider(timeout).segment(self.image)
        assert error.value.code == "timeout"
        with pytest.raises(SegmentationError) as error:
            self.provider(refused).segment(self.image)
        assert error.value.code == "provider-unreachable"


def test_http_provider_needs_a_url(tmp_path: Path):
    with pytest.raises(RuntimeError, match="SEGMENTATION_URL"):
        create_app(Settings(database_path=tmp_path / "db.sqlite3", storage_dir=tmp_path / "o", segmentation_provider="http"))
