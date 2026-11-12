"""Supabase (Postgres) session and job stores.

Drop-in replacements for the SQLite stores in sessions.py and jobs.py, talking
to Supabase's REST interface (PostgREST) with the service-role key. With
these and R2 storage the API keeps no state on disk, so it can run on any
container host without a persistent volume and across several instances.

Schema: infra/supabase/migrations. Selected with
PHOTOBOOTH_DATABASE_BACKEND=supabase.
"""

import uuid
from datetime import datetime, timedelta, timezone

import httpx

from .config import Settings
from .jobs import Job
from .sessions import Session, hash_token, new_token


class DatabaseError(RuntimeError):
    pass


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat()


def _parse(value: str | None) -> datetime | None:
    if not value:
        return None
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _session(row: dict) -> Session:
    created, expires = _parse(row["created_at"]), _parse(row["expires_at"])
    assert created and expires
    return Session(
        id=row["id"],
        template_id=row["template_id"],
        status=row["status"],
        created_at=created,
        expires_at=expires,
        completed_at=_parse(row.get("completed_at")),
        result_key=row.get("result_key"),
        result_width=row.get("result_width"),
        result_height=row.get("result_height"),
    )


def _job(row: dict) -> Job:
    created, updated = _parse(row["created_at"]), _parse(row["updated_at"])
    assert created and updated
    box = (row.get("box_left"), row.get("box_top"), row.get("box_right"), row.get("box_bottom"))
    return Job(
        id=row["id"],
        session_id=row["session_id"],
        status=row["status"],
        error=row.get("error"),
        attempts=row["attempts"],
        provider=row.get("provider"),
        width=row.get("width"),
        height=row.get("height"),
        subject_box=box if box[0] is not None else None,  # type: ignore[arg-type]
        created_at=created,
        updated_at=updated,
    )


class PostgrestTable:
    """Minimal PostgREST client for one table."""

    def __init__(self, client: httpx.Client, table: str):
        self.client = client
        self.path = f"/{table}"

    def _send(self, method: str, params: dict | None = None, json: dict | None = None, prefer: str = "") -> list[dict]:
        headers = {"Prefer": prefer} if prefer else {}
        try:
            response = self.client.request(method, self.path, params=params, json=json, headers=headers)
        except httpx.HTTPError as e:
            raise DatabaseError(f"Supabase could not be reached: {type(e).__name__}") from e
        if response.status_code >= 400:
            raise DatabaseError(f"Supabase answered {response.status_code} for {method} {self.path}")
        return response.json() if response.content else []

    def select(self, **filters: str) -> list[dict]:
        return self._send("GET", params={"select": "*", **filters})

    def insert(self, row: dict, on_conflict: str | None = None) -> list[dict]:
        if on_conflict:
            return self._send(
                "POST",
                params={"on_conflict": on_conflict},
                json=row,
                prefer="resolution=ignore-duplicates,return=representation",
            )
        return self._send("POST", json=row, prefer="return=representation")

    def update(self, values: dict, **filters: str) -> list[dict]:
        return self._send("PATCH", params=filters, json=values, prefer="return=representation")

    def delete(self, **filters: str) -> None:
        self._send("DELETE", params=filters)


def build_client(settings: Settings) -> httpx.Client:
    missing = [name for name in ("supabase_url", "supabase_service_key") if not getattr(settings, name)]
    if missing:
        raise RuntimeError(f"Supabase database selected but not configured: missing {', '.join(missing)}")
    return httpx.Client(
        base_url=f"{settings.supabase_url.rstrip('/')}/rest/v1",
        headers={"apikey": settings.supabase_service_key, "Authorization": f"Bearer {settings.supabase_service_key}"},
        timeout=10,
    )


class SupabaseSessionStore:
    def __init__(self, client: httpx.Client):
        self.table = PostgrestTable(client, "sessions")

    def create(self, template_id: str, ttl: timedelta, now: datetime) -> Session:
        rows = self.table.insert(
            {
                "id": str(uuid.uuid4()),
                "template_id": template_id,
                "status": "active",
                "created_at": _iso(now),
                "expires_at": _iso(now + ttl),
            }
        )
        return _session(rows[0])

    def get(self, session_id: str) -> Session | None:
        try:
            uuid.UUID(session_id)  # the column is a uuid; anything else can never match
        except ValueError:
            return None
        rows = self.table.select(id=f"eq.{session_id}")
        return _session(rows[0]) if rows else None

    def attach_result(self, session_id: str, key: str, width: int, height: int, expires_at: datetime) -> str:
        token = new_token()
        self.table.update(
            {
                "status": "delivered",
                "result_key": key,
                "result_width": width,
                "result_height": height,
                "token_hash": hash_token(token),
                "expires_at": _iso(expires_at),
            },
            id=f"eq.{session_id}",
        )
        return token

    def find_by_token(self, token: str, now: datetime) -> Session | None:
        rows = self.table.select(
            token_hash=f"eq.{hash_token(token)}", expires_at=f"gt.{_iso(now)}", result_key="not.is.null"
        )
        return _session(rows[0]) if rows else None

    def complete(self, session_id: str, now: datetime) -> None:
        self.table.update({"status": "complete", "completed_at": _iso(now)}, id=f"eq.{session_id}")

    def expired(self, now: datetime) -> list[Session]:
        return [_session(row) for row in self.table.select(expires_at=f"lte.{_iso(now)}")]

    def delete(self, session_id: str) -> None:
        self.table.delete(id=f"eq.{session_id}")

    def count(self) -> int:
        return len(self.table._send("GET", params={"select": "id"}))

    def status(self) -> str:
        try:
            self.table._send("GET", params={"select": "id", "limit": "1"})
            return "connected"
        except DatabaseError:
            return "error"


class SupabaseJobStore:
    def __init__(self, client: httpx.Client):
        self.table = PostgrestTable(client, "jobs")

    def get(self, job_id: str) -> Job | None:
        try:
            uuid.UUID(job_id)
        except ValueError:
            return None
        rows = self.table.select(id=f"eq.{job_id}")
        return _job(rows[0]) if rows else None

    def for_session(self, session_id: str) -> Job | None:
        rows = self.table.select(session_id=f"eq.{session_id}")
        return _job(rows[0]) if rows else None

    def start(self, session_id: str, now: datetime) -> tuple[Job, bool]:
        # The unique session_id plus ignore-duplicates makes concurrent starts collapse into one job.
        rows = self.table.insert(
            {
                "id": str(uuid.uuid4()),
                "session_id": session_id,
                "status": "queued",
                "created_at": _iso(now),
                "updated_at": _iso(now),
            },
            on_conflict="session_id",
        )
        if rows:
            return _job(rows[0]), True
        job = self.for_session(session_id)
        assert job is not None
        return job, False

    def retry(self, job_id: str, now: datetime) -> None:
        job = self.get(job_id)
        if job is not None:
            self.table.update(
                {"status": "queued", "error": None, "attempts": job.attempts + 1, "updated_at": _iso(now)},
                id=f"eq.{job_id}",
            )

    def mark(self, job_id: str, status: str, now: datetime, error: str | None = None, **fields) -> None:
        self.table.update({"status": status, "error": error, "updated_at": _iso(now), **fields}, id=f"eq.{job_id}")

    def delete_for_session(self, session_id: str) -> None:
        self.table.delete(session_id=f"eq.{session_id}")
