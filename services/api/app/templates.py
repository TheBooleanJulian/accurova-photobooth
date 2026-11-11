"""Reads templates from disk.

The kiosk validates templates in full with the TypeScript schema
(packages/template-engine). This service checks the structural minimum it
needs and passes the rest through unchanged, so the two never drift on detail.
"""

import json
import re
from pathlib import Path

from pydantic import BaseModel, ConfigDict, ValidationError

SLUG = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")


class TemplateNotFound(Exception):
    pass


class TemplateInvalid(Exception):
    pass


class IndexEntry(BaseModel):
    id: str
    name: str
    enabled: bool


class TemplateIndex(BaseModel):
    schemaVersion: int
    templates: list[IndexEntry]


class TemplateDocument(BaseModel):
    model_config = ConfigDict(extra="allow")

    schemaVersion: int
    id: str
    name: str
    defaultLocale: str
    locales: list[str]
    backgrounds: list[dict]
    frames: list[dict]
    defaultFrameId: str


class TemplateStore:
    def __init__(self, root: Path):
        self.root = root

    def _read(self, path: Path) -> object:
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError as e:
            raise TemplateNotFound(path.name) from e
        except json.JSONDecodeError as e:
            raise TemplateInvalid(f"{path.name} is not valid JSON: {e}") from e

    def index(self) -> TemplateIndex:
        try:
            return TemplateIndex.model_validate(self._read(self.root / "index.json"))
        except ValidationError as e:
            raise TemplateInvalid(f"index.json is invalid: {e.error_count()} error(s)") from e

    def get(self, template_id: str) -> TemplateDocument:
        # The id is used to build a path: accept slugs only.
        if not SLUG.match(template_id):
            raise TemplateNotFound(template_id)
        entry = next((t for t in self.index().templates if t.id == template_id), None)
        if entry is None or not entry.enabled:
            raise TemplateNotFound(template_id)
        try:
            doc = TemplateDocument.model_validate(self._read(self.root / template_id / "template.json"))
        except ValidationError as e:
            raise TemplateInvalid(f"{template_id}/template.json is invalid: {e.error_count()} error(s)") from e
        if doc.id != template_id:
            raise TemplateInvalid(f'folder "{template_id}" declares id "{doc.id}"')
        return doc
