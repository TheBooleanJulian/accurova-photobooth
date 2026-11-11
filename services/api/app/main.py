"""Accurova Photobooth API.

Built so far: health, read-only templates, sessions, delivery of the final
photograph through expiring download tokens, and retention cleanup.
Not built: capture upload, segmentation and compositing jobs (M3-M5). Their
backing services are reported as "not-configured" rather than faked.
"""

from dataclasses import asdict, dataclass
from datetime import datetime, timedelta
from typing import Callable

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import __version__
from .config import Settings
from .retention import cleanup_expired
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


def create_app(settings: Settings | None = None, storage: ObjectStorage | None = None) -> FastAPI:
    settings = settings or Settings()
    services = Services(
        settings=settings,
        templates=TemplateStore(settings.templates_dir),
        sessions=SessionStore(settings.database_path),
        storage=storage or build_storage(settings),
        limiter=RateLimiter(settings.rate_limit_per_minute),
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
                "segmentation": "not-configured",
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
        return asdict(cleanup_expired(services.sessions, services.storage, services.clock()))

    return app


def __getattr__(name: str):
    # `uvicorn app.main:app` builds the app on first use, so importing this
    # module (in tests, tooling) never touches the filesystem.
    if name == "app":
        global app
        app = create_app()
        return app
    raise AttributeError(name)
