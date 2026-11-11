"""Processing jobs: original capture -> segmented, transparent foreground.

One job per session. Starting a job twice returns the same job (idempotent);
a failed job can be retried a limited number of times; a job that stops
making progress is failed with `timeout` so a visitor is never left waiting.

Storage keys are derived from the session id, never from request input:
    captures/<session>.jpg   original capture, untouched
    foregrounds/<job>.png    lossless RGBA foreground (per job, so a retake can
                             never be overwritten by a slower, older job)
"""

import io
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

from PIL import Image, ImageOps

from .segmentation import SegmentationError, SegmentationProvider
from .sessions import _iso, _parse
from .storage import ObjectNotFound, ObjectStorage

SCHEMA = """
create table if not exists jobs (
    id          text primary key,
    session_id  text not null unique,
    status      text not null check (status in ('queued', 'segmenting', 'done', 'failed')),
    error       text,
    attempts    integer not null default 1,
    provider    text,
    width       integer,
    height      integer,
    box_left    integer,
    box_top     integer,
    box_right   integer,
    box_bottom  integer,
    created_at  text not null,
    updated_at  text not null
);
"""

# Alpha above this counts as "person" when measuring the subject.
SUBJECT_THRESHOLD = 128
# A mask covering less than this share of the frame means nobody was found.
MIN_COVERAGE = 0.01


def capture_key(session_id: str) -> str:
    return f"captures/{session_id}.jpg"


def foreground_key(job_id: str) -> str:
    return f"foregrounds/{job_id}.png"


@dataclass(frozen=True)
class Job:
    id: str
    session_id: str
    status: str
    error: str | None
    attempts: int
    provider: str | None
    width: int | None
    height: int | None
    subject_box: tuple[int, int, int, int] | None
    created_at: datetime
    updated_at: datetime

    @property
    def active(self) -> bool:
        return self.status in ("queued", "segmenting")


def _row(row: sqlite3.Row) -> Job:
    box = (row["box_left"], row["box_top"], row["box_right"], row["box_bottom"])
    return Job(
        id=row["id"],
        session_id=row["session_id"],
        status=row["status"],
        error=row["error"],
        attempts=row["attempts"],
        provider=row["provider"],
        width=row["width"],
        height=row["height"],
        subject_box=box if row["box_left"] is not None else None,
        created_at=_parse(row["created_at"]),
        updated_at=_parse(row["updated_at"]),
    )


class JobStore:
    def __init__(self, path: Path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as db:
            db.executescript(SCHEMA)

    def _connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        return db

    def get(self, job_id: str) -> Job | None:
        with self._connect() as db:
            row = db.execute("select * from jobs where id = ?", (job_id,)).fetchone()
        return _row(row) if row else None

    def for_session(self, session_id: str) -> Job | None:
        with self._connect() as db:
            row = db.execute("select * from jobs where session_id = ?", (session_id,)).fetchone()
        return _row(row) if row else None

    def start(self, session_id: str, now: datetime) -> tuple[Job, bool]:
        """Returns (job, created). The unique session_id makes concurrent starts collapse into one job."""
        with self._connect() as db:
            cursor = db.execute(
                "insert or ignore into jobs (id, session_id, status, created_at, updated_at) values (?, ?, 'queued', ?, ?)",
                (str(uuid.uuid4()), session_id, _iso(now), _iso(now)),
            )
            created = cursor.rowcount == 1
        job = self.for_session(session_id)
        assert job is not None
        return job, created

    def retry(self, job_id: str, now: datetime) -> None:
        with self._connect() as db:
            db.execute(
                "update jobs set status = 'queued', error = null, attempts = attempts + 1, updated_at = ? where id = ?",
                (_iso(now), job_id),
            )

    def mark(self, job_id: str, status: str, now: datetime, error: str | None = None, **fields) -> None:
        columns = {"status": status, "error": error, "updated_at": _iso(now), **fields}
        assignments = ", ".join(f"{name} = ?" for name in columns)
        with self._connect() as db:
            db.execute(f"update jobs set {assignments} where id = ?", (*columns.values(), job_id))

    def delete_for_session(self, session_id: str) -> None:
        with self._connect() as db:
            db.execute("delete from jobs where session_id = ?", (session_id,))


def fail_if_stalled(jobs: JobStore, job: Job, now: datetime, timeout: timedelta) -> Job:
    """A worker that died mid-job would otherwise leave the kiosk polling forever."""
    if job.active and now - job.updated_at > timeout:
        jobs.mark(job.id, "failed", now, error="timeout")
        return jobs.get(job.id) or job
    return job


def extract_foreground(original: bytes, provider: SegmentationProvider) -> tuple[bytes, tuple[int, int], tuple]:
    """Returns (RGBA PNG bytes, (width, height), subject box). Raises SegmentationError."""
    with Image.open(io.BytesIO(original)) as opened:
        # Apply EXIF rotation so pixels are upright; the stored original is not modified.
        image = ImageOps.exif_transpose(opened).convert("RGB")

    mask = provider.segment(image).convert("L")
    if mask.size != image.size:
        # Models work at a fixed resolution; bring the mask back to full size.
        mask = mask.resize(image.size, Image.Resampling.LANCZOS)

    solid = mask.point(lambda value: 255 if value >= SUBJECT_THRESHOLD else 0)
    box = solid.getbbox()
    coverage = (solid.histogram()[255] / (image.width * image.height)) if box else 0
    if not box or coverage < MIN_COVERAGE:
        raise SegmentationError("no-subject", "No person was found in the photograph")

    foreground = image.copy()
    foreground.putalpha(mask)
    buffer = io.BytesIO()
    foreground.save(buffer, "PNG")  # lossless intermediate
    return buffer.getvalue(), image.size, box


def run_job(
    job_id: str,
    jobs: JobStore,
    storage: ObjectStorage,
    provider: SegmentationProvider,
    clock,
    retain_original: bool = False,
) -> None:
    job = jobs.get(job_id)
    if job is None or job.status != "queued":
        return  # already running, finished, or deleted by a retake
    jobs.mark(job.id, "segmenting", clock(), provider=provider.name)
    try:
        original = storage.get(capture_key(job.session_id))
        png, (width, height), box = extract_foreground(original, provider)
        storage.put(foreground_key(job.id), png, "image/png")
    except ObjectNotFound:
        jobs.mark(job.id, "failed", clock(), error="capture-missing")
        return
    except SegmentationError as e:
        jobs.mark(job.id, "failed", clock(), error=e.code)
        return
    except Exception:
        jobs.mark(job.id, "failed", clock(), error="internal-error")
        return

    if jobs.get(job.id) is None:
        # The visitor retook the photo while this ran: discard the stale result.
        storage.delete(foreground_key(job.id))
        return
    jobs.mark(
        job.id,
        "done",
        clock(),
        width=width,
        height=height,
        box_left=box[0],
        box_top=box[1],
        box_right=box[2],
        box_bottom=box[3],
    )
    if not retain_original:
        storage.delete(capture_key(job.session_id))


def delete_intermediates(session_id: str, jobs: JobStore, storage: ObjectStorage) -> None:
    """Removes the original capture, the foreground and the job for a session."""
    storage.delete(capture_key(session_id))
    job = jobs.for_session(session_id)
    if job is not None:
        storage.delete(foreground_key(job.id))
        jobs.delete_for_session(session_id)
