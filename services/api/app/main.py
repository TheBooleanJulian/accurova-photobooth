"""Accurova Photobooth API.

Milestone M0 scope: health and read-only template endpoints. Capture,
processing, storage and delivery endpoints arrive with M3-M6; until then
their backing services are reported as "not-configured" rather than faked.
"""

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from . import __version__
from .config import Settings
from .templates import TemplateInvalid, TemplateNotFound, TemplateStore


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    store = TemplateStore(settings.templates_dir)

    app = FastAPI(title="Accurova Photobooth API", version=__version__)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )

    def get_store() -> TemplateStore:
        return store

    @app.get("/api/admin/health")
    def health(store: TemplateStore = Depends(get_store)) -> dict:
        try:
            count = len(store.index().templates)
        except (TemplateNotFound, TemplateInvalid):
            count = 0
        return {
            "status": "ok",
            "version": __version__,
            "templates": count,
            "services": {
                "storage": "not-configured",
                "database": "not-configured",
                "segmentation": "not-configured",
            },
        }

    @app.get("/api/templates")
    def list_templates(store: TemplateStore = Depends(get_store)) -> dict:
        try:
            index = store.index()
        except TemplateNotFound:
            return {"templates": []}
        except TemplateInvalid as e:
            raise HTTPException(status_code=500, detail=str(e)) from e
        return {"templates": [t.model_dump() for t in index.templates if t.enabled]}

    @app.get("/api/templates/{template_id}")
    def get_template(template_id: str, store: TemplateStore = Depends(get_store)) -> dict:
        try:
            return store.get(template_id).model_dump()
        except TemplateNotFound as e:
            raise HTTPException(status_code=404, detail="Template not found") from e
        except TemplateInvalid as e:
            raise HTTPException(status_code=500, detail=str(e)) from e

    return app


app = create_app()
