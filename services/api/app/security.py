"""Upload validation, rate limiting and admin authentication."""

import hmac
import io
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request
from PIL import Image, UnidentifiedImageError


async def read_limited(request: Request, limit: int) -> bytes:
    """Reads the body, refusing as soon as it exceeds `limit` bytes."""
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > limit:
        raise HTTPException(status_code=413, detail="Image is too large")
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > limit:
            raise HTTPException(status_code=413, detail="Image is too large")
        chunks.append(chunk)
    return b"".join(chunks)


def validate_jpeg(data: bytes, max_edge: int) -> tuple[int, int]:
    """Confirms `data` really is a decodable JPEG and returns (width, height).

    The declared content type is never trusted; the bytes are inspected.
    """
    if not data:
        raise HTTPException(status_code=400, detail="Empty upload")
    try:
        with Image.open(io.BytesIO(data)) as image:
            if image.format != "JPEG":
                raise HTTPException(status_code=415, detail="Only JPEG images are accepted")
            width, height = image.size
            if max(width, height) > max_edge:
                raise HTTPException(status_code=413, detail="Image dimensions are too large")
            image.verify()
    except HTTPException:
        raise
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, SyntaxError, ValueError) as e:
        raise HTTPException(status_code=415, detail="The upload is not a valid JPEG") from e
    return width, height


class RateLimiter:
    """Sliding one-minute window per client, in memory.

    Adequate for one API instance. With several instances, or behind a proxy
    that hides client addresses, move this to the edge (Cloudflare rules).
    """

    def __init__(self, per_minute: int):
        self.per_minute = per_minute
        self.hits: dict[str, deque[float]] = defaultdict(deque)

    def check(self, key: str, now: float | None = None) -> None:
        if self.per_minute <= 0:
            return
        now = time.monotonic() if now is None else now
        window = self.hits[key]
        while window and now - window[0] >= 60:
            window.popleft()
        if len(window) >= self.per_minute:
            raise HTTPException(status_code=429, detail="Too many requests", headers={"Retry-After": "60"})
        window.append(now)


def client_key(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def require_admin(request: Request, admin_token: str) -> None:
    if not admin_token:
        raise HTTPException(status_code=503, detail="Admin access is not configured")
    supplied = request.headers.get("authorization", "")
    if not hmac.compare_digest(supplied, f"Bearer {admin_token}"):
        raise HTTPException(status_code=401, detail="Unauthorized", headers={"WWW-Authenticate": "Bearer"})
