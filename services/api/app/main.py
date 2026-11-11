"""Accurova Photobooth API.

Built so far: health, read-only templates, sessions, capture upload,
segmentation jobs, delivery of the final photograph through expiring download
tokens, and retention cleanup. Compositing and frames run in the kiosk.
Services that are not connected are reported as such, never faked.
"""

from dataclasses import asdict, dataclass
from datetime import datetime, timedelta
from typing import Callable

from fastapi import BackgroundTasks, FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import __version__
from .config import Settings
from .jobs import (
    Job,
    JobStore,
    capture_key,
    delete_intermediates,
    fail_if_stalled,
    foreground_key,
    run_job,
)
from .retention import cleanup_expired
from .segmentation import SegmentationProvider, build_segmentation
from .security import RateLimiter, client_key, read_limited, require_admin, validate_jpeg
from .sessions import Session, SessionStore, utcnow
from .storage import ObjectNotFound, ObjectStorage, build_storage
from .templates import TemplateInvalid, TemplateNotFound, TemplateStore


@dataclass
class Services:
    settings: Settings
    templates: TemplateStore
    sessions: SessionStore
    storage: ObjectStorage
    limiter: RateLimiter
    jobs: JobStore
    segmentation: SegmentationProvider | None
    clock: Callable[[], datetime] = utcnow


class CreateSession(BaseModel):
    templateId: str


def _session_view(session: Session) -> dict:
    return {
        "sessionId": session.id,
        "templateId": session.template_id,
        "status": session.status,
        "hasResult": session.has_result,
        "expiresAt": session.expires_at.isoformat(),
    }


def _job_view(job: Job) -> dict:
    done = job.status == "done"
    return {
        "jobId": job.id,
        "sessionId": job.session_id,
        "status": job.status,
        "error": job.error,
        "attempts": job.attempts,
        "provider": job.provider,
        "width": job.width,
        "height": job.height,
        # Pixel bounds of the person in the foreground image: [left, top, right, bottom].
        "subjectBox": list(job.subject_box) if job.subject_box else None,
        "foregroundUrl": f"/api/process/{job.id}/foreground" if done else None,
    }


def create_app(
    settings: Settings | None = None,
    storage: ObjectStorage | None = None,
    segmentation: SegmentationProvider | None = None,
) -> FastAPI:
    settings = settings or Settings()
    services = Services(
        settings=settings,
        templates=TemplateStore(settings.templates_dir),
        sessions=SessionStore(settings.database_path),
        storage=storage or build_storage(settings),
        limiter=RateLimiter(settings.rate_limit_per_minute),
        jobs=JobStore(settings.database_path),
        segmentation=segmentation or build_segmentation(settings),
    )

    app = FastAPI(title="Accurova Photobooth API", version=__version__)
    app.state.services = services
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_methods=["GET", "POST", "PUT"],
        allow_headers=["*"],
    )

    def live_session(session_id: str) -> Session:
        session = services.sessions.get(session_id)
        # Unknown and expired sessions look identical to callers.
        if session is None or session.expires_at <= services.clock():
            raise HTTPException(status_code=404, detail="Session not found")
        return session

    # ---- health and templates -------------------------------------------------

    @app.get("/api/admin/health")
    def health() -> dict:
        try:
            count = len(services.templates.index().templates)
        except (TemplateNotFound, TemplateInvalid):
            count = 0
        return {
            "status": "ok",
            "version": __version__,
            "templates": count,
            "services": {
                "storage": services.storage.status(),
                "database": "local",
                "segmentation": services.segmentation.status() if services.segmentation else "not-configured",
            },
        }

    @app.get("/api/templates")
    def list_templates() -> dict:
        try:
            index = services.templates.index()
        except TemplateNotFound:
            return {"templates": []}
        except TemplateInvalid as e:
            raise HTTPException(status_code=500, detail=str(e)) from e
        return {"templates": [t.model_dump() for t in index.templates if t.enabled]}

    @app.get("/api/templates/{template_id}")
    def get_template(template_id: str) -> dict:
        try:
            return services.templates.get(template_id).model_dump()
        except TemplateNotFound as e:
            raise HTTPException(status_code=404, detail="Template not found") from e
        except TemplateInvalid as e:
            raise HTTPException(status_code=500, detail=str(e)) from e

    # ---- sessions ---------------------------------------------------------------

    @app.post("/api/session/create", status_code=201)
    def create_session(body: CreateSession, request: Request) -> dict:
        services.limiter.check(client_key(request))
        try:
            services.templates.get(body.templateId)
        except TemplateNotFound as e:
            raise HTTPException(status_code=404, detail="Template not found") from e
        except TemplateInvalid as e:
            raise HTTPException(status_code=500, detail=str(e)) from e
        session = services.sessions.create(
            body.templateId, timedelta(minutes=settings.session_ttl_minutes), services.clock()
        )
        return _session_view(session)

    @app.get("/api/session/{session_id}/result")
    def session_result(session_id: str) -> dict:
        return _session_view(live_session(session_id))

    @app.put("/api/session/{session_id}/result")
    async def upload_result(session_id: str, request: Request) -> dict:
        """Stores the final JPEG (raw request body) and returns its download token.

        Safe to retry: a repeat upload replaces the image and the token.
        """
        services.limiter.check(client_key(request))
        session = live_session(session_id)
        data = await read_limited(request, settings.max_upload_bytes)
        width, height = validate_jpeg(data, settings.max_image_edge_px)

        key = f"results/{session.id}.jpg"
        services.storage.put(key, data, "image/jpeg")
        expires_at = services.clock() + timedelta(hours=settings.link_expiry_hours)
        token = services.sessions.attach_result(session.id, key, width, height, expires_at)
        # The final image exists: the original and the mask are no longer needed.
        delete_intermediates(session.id, services.jobs, services.storage)
        return {
            "sessionId": session.id,
            "token": token,
            "imageUrl": f"/api/download/{token}",
            "infoUrl": f"/api/download/{token}/info",
            "width": width,
            "height": height,
            "expiresAt": expires_at.isoformat(),
        }

    @app.post("/api/session/{session_id}/complete")
    def complete_session(session_id: str) -> dict:
        session = live_session(session_id)
        services.sessions.complete(session.id, services.clock())
        return {"sessionId": session.id, "status": "complete"}

    # ---- capture and processing ---------------------------------------------------

    @app.put("/api/session/{session_id}/capture")
    async def upload_capture(session_id: str, request: Request) -> dict:
        """Stores the original capture (raw JPEG body), byte for byte.

        A new upload is a retake: it replaces the capture and discards any
        job and foreground made from the previous one.
        """
        services.limiter.check(client_key(request))
        session = live_session(session_id)
        if session.has_result:
            raise HTTPException(status_code=409, detail="This session already has its final photograph")
        data = await read_limited(request, settings.max_upload_bytes)
        width, height = validate_jpeg(data, settings.max_image_edge_px)
        delete_intermediates(session.id, services.jobs, services.storage)
        services.storage.put(capture_key(session.id), data, "image/jpeg")
        return {"sessionId": session.id, "width": width, "height": height, "bytes": len(data)}

    @app.post("/api/session/{session_id}/process", status_code=202)
    def start_processing(session_id: str, request: Request, background: BackgroundTasks) -> dict:
        """Starts (or returns) the segmentation job for the session's capture."""
        services.limiter.check(client_key(request))
        session = live_session(session_id)
        provider = services.segmentation
        if provider is None:
            raise HTTPException(status_code=503, detail="Segmentation is not configured")

        existing = services.jobs.for_session(session.id)
        if existing is None:
            try:
                services.storage.get(capture_key(session.id))
            except ObjectNotFound as e:
                raise HTTPException(status_code=409, detail="Upload a capture before processing") from e

        job, created = services.jobs.start(session.id, services.clock())
        if not created:
            job = fail_if_stalled(
                services.jobs, job, services.clock(), timedelta(seconds=settings.job_timeout_seconds)
            )
            if job.status != "failed":
                return _job_view(job)  # idempotent: never a second job for the same capture
            if job.attempts >= settings.max_job_attempts:
                raise HTTPException(status_code=409, detail="Processing failed too many times; retake the photo")
            services.jobs.retry(job.id, services.clock())
            job = services.jobs.get(job.id) or job

        background.add_task(
            run_job, job.id, services.jobs, services.storage, provider, services.clock, settings.retain_originals
        )
        return _job_view(job)

    def known_job(job_id: str) -> Job:
        job = services.jobs.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Job not found")
        live_session(job.session_id)
        return fail_if_stalled(services.jobs, job, services.clock(), timedelta(seconds=settings.job_timeout_seconds))

    @app.get("/api/process/{job_id}")
    def job_status(job_id: str) -> dict:
        return _job_view(known_job(job_id))

    @app.get("/api/process/{job_id}/foreground")
    def job_foreground(job_id: str) -> Response:
        job = known_job(job_id)
        if job.status != "done":
            raise HTTPException(status_code=409, detail="The foreground is not ready")
        try:
            data = services.storage.get(foreground_key(job.id))
        except ObjectNotFound as e:
            raise HTTPException(status_code=404, detail="Job not found") from e
        return Response(content=data, media_type="image/png", headers={"Cache-Control": "private, no-store"})

    # ---- delivery ---------------------------------------------------------------

    def by_token(token: str, request: Request) -> Session:
        services.limiter.check(client_key(request))
        session = services.sessions.find_by_token(token, services.clock())
        if session is None:
            # Same answer for wrong, expired and deleted links.
            raise HTTPException(status_code=404, detail="This link is invalid or has expired")
        return session

    @app.get("/api/download/{token}/info")
    def download_info(token: str, request: Request) -> dict:
        session = by_token(token, request)
        return {
            "templateId": session.template_id,
            "width": session.result_width,
            "height": session.result_height,
            "expiresAt": session.expires_at.isoformat(),
            "imageUrl": f"/api/download/{token}",
        }

    @app.get("/api/download/{token}")
    def download(token: str, request: Request) -> Response:
        session = by_token(token, request)
        assert session.result_key is not None
        try:
            data = services.storage.get(session.result_key)
        except ObjectNotFound as e:
            raise HTTPException(status_code=404, detail="This link is invalid or has expired") from e
        return Response(
            content=data,
            media_type="image/jpeg",
            headers={
                "Content-Disposition": f'attachment; filename="{session.template_id}-photo.jpg"',
                "Cache-Control": "private, no-store",
                "X-Robots-Tag": "noindex",
            },
        )

    # ---- administration -----------------------------------------------------------

    @app.post("/api/admin/cleanup")
    def cleanup(request: Request) -> dict:
        require_admin(request, settings.admin_token)
        return asdict(cleanup_expired(services.sessions, services.storage, services.clock(), services.jobs))

    return app


def __getattr__(name: str):
    # `uvicorn app.main:app` builds the app on first use, so importing this
    # module (in tests, tooling) never touches the filesystem.
    if name == "app":
        global app
        app = create_app()
        return app
    raise AttributeError(name)
