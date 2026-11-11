"""Session metadata.

Deliberately minimal: no names, contacts or device identifiers. A session is
a random id, a template, timestamps and (once delivered) where the final
image is and a hash of its download token. Rows are deleted at expiry.
"""

import hashlib
import secrets
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

SCHEMA = """
create table if not exists sessions (
    id            text primary key,
    template_id   text not null,
    status        text not null check (status in ('active', 'delivered', 'complete')),
    created_at    text not null,
    expires_at    text not null,
    completed_at  text,
    result_key    text,
    result_width  integer,
    result_height integer,
    token_hash    text unique
);
create index if not exists sessions_expires_at on sessions (expires_at);
"""


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    # Fixed-width UTC text sorts chronologically, so SQLite can compare it.
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _parse(value: str) -> datetime:
    return datetime.strptime(value, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def new_token() -> str:
    """256 bits of randomness, URL-safe. Only its hash is ever stored."""
    return secrets.token_urlsafe(32)


@dataclass(frozen=True)
class Session:
    id: str
    template_id: str
    status: str
    created_at: datetime
    expires_at: datetime
    completed_at: datetime | None
    result_key: str | None
    result_width: int | None
    result_height: int | None

    @property
    def has_result(self) -> bool:
        return self.result_key is not None


def _row(row: sqlite3.Row) -> Session:
    return Session(
        id=row["id"],
        template_id=row["template_id"],
        status=row["status"],
        created_at=_parse(row["created_at"]),
        expires_at=_parse(row["expires_at"]),
        completed_at=_parse(row["completed_at"]) if row["completed_at"] else None,
        result_key=row["result_key"],
        result_width=row["result_width"],
        result_height=row["result_height"],
    )


class SessionStore:
    def __init__(self, path: Path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as db:
            db.executescript(SCHEMA)

    def _connect(self) -> sqlite3.Connection:
        # One short-lived connection per operation keeps this safe across threads.
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        return db

    def create(self, template_id: str, ttl: timedelta, now: datetime) -> Session:
        session_id = str(uuid.uuid4())  # random, never sequential
        with self._connect() as db:
            db.execute(
                "insert into sessions (id, template_id, status, created_at, expires_at) values (?, ?, 'active', ?, ?)",
                (session_id, template_id, _iso(now), _iso(now + ttl)),
            )
        session = self.get(session_id)
        assert session is not None
        return session

    def get(self, session_id: str) -> Session | None:
        with self._connect() as db:
            row = db.execute("select * from sessions where id = ?", (session_id,)).fetchone()
        return _row(row) if row else None

    def attach_result(self, session_id: str, key: str, width: int, height: int, expires_at: datetime) -> str:
        """Records the final image and issues a fresh download token.

        Calling again (a kiosk retry) replaces the token, so the previous
        link stops working and exactly one link is ever valid.
        """
        token = new_token()
        with self._connect() as db:
            db.execute(
                """update sessions
                   set status = 'delivered', result_key = ?, result_width = ?, result_height = ?,
                       token_hash = ?, expires_at = ?
                   where id = ?""",
                (key, width, height, hash_token(token), _iso(expires_at), session_id),
            )
        return token

    def find_by_token(self, token: str, now: datetime) -> Session | None:
        with self._connect() as db:
            row = db.execute(
                "select * from sessions where token_hash = ? and expires_at > ? and result_key is not null",
                (hash_token(token), _iso(now)),
            ).fetchone()
        return _row(row) if row else None

    def complete(self, session_id: str, now: datetime) -> None:
        with self._connect() as db:
            db.execute(
                "update sessions set status = 'complete', completed_at = ? where id = ?",
                (_iso(now), session_id),
            )

    def expired(self, now: datetime) -> list[Session]:
        with self._connect() as db:
            rows = db.execute("select * from sessions where expires_at <= ?", (_iso(now),)).fetchall()
        return [_row(r) for r in rows]

    def delete(self, session_id: str) -> None:
        with self._connect() as db:
            db.execute("delete from sessions where id = ?", (session_id,))

    def count(self) -> int:
        with self._connect() as db:
            return db.execute("select count(*) from sessions").fetchone()[0]
