"""Automatic deletion of expired sessions and their photographs.

Run on a schedule (every 15 minutes is plenty):

    python -m app.retention

or call POST /api/admin/cleanup. An R2 lifecycle rule (infra/r2) is the
backstop in case this job ever stops running.
"""

from dataclasses import asdict, dataclass
from datetime import datetime

from .sessions import SessionStore, utcnow
from .storage import ObjectStorage


@dataclass
class CleanupReport:
    sessions_deleted: int = 0
    images_deleted: int = 0
    errors: int = 0


def cleanup_expired(sessions: SessionStore, storage: ObjectStorage, now: datetime) -> CleanupReport:
    report = CleanupReport()
    for session in sessions.expired(now):
        try:
            if session.result_key:
                storage.delete(session.result_key)
                report.images_deleted += 1
            # The row goes only after the image is gone, so a failed delete is retried.
            sessions.delete(session.id)
            report.sessions_deleted += 1
        except Exception:
            report.errors += 1
    return report


if __name__ == "__main__":
    from .config import Settings
    from .storage import build_storage

    settings = Settings()
    print(asdict(cleanup_expired(SessionStore(settings.database_path), build_storage(settings), utcnow())))
