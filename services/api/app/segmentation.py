"""Human segmentation behind a replaceable provider interface.

A provider turns a photograph into an alpha mask (mode "L", same size as the
input, 255 = person). Everything else (orientation, foreground extraction,
storage, job state) lives in jobs.py and never depends on which provider runs.

Providers:
- none  : default. Processing is refused with 503; nothing is faked.
- mock  : a synthetic silhouette, for development and tests ONLY.
- http  : any inference endpoint that honours the contract in HttpSegmentation.
"""

import io
from typing import Protocol

import httpx
from PIL import Image, ImageDraw, ImageFilter

from .config import Settings


class SegmentationError(Exception):
    """The provider could not produce a usable mask. Safe to show as a job error code."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class SegmentationProvider(Protocol):
    name: str

    def segment(self, image: Image.Image) -> Image.Image: ...
    def status(self) -> str:
        """'mock' or 'configured' for the health endpoint."""
        ...


class MockSegmentation:
    """NOT a real model. Draws a soft, centred, person-shaped silhouette so the
    rest of the pipeline can be built and tested without a GPU service."""

    name = "mock"

    def segment(self, image: Image.Image) -> Image.Image:
        w, h = image.size
        mask = Image.new("L", (w, h), 0)
        draw = ImageDraw.Draw(mask)
        cx = w / 2
        head_r = h * 0.07
        draw.ellipse((cx - head_r, h * 0.10, cx + head_r, h * 0.10 + 2 * head_r), fill=255)
        draw.rounded_rectangle((cx - w * 0.16, h * 0.25, cx + w * 0.16, h * 0.62), radius=w * 0.06, fill=255)
        draw.rectangle((cx - w * 0.13, h * 0.60, cx - w * 0.02, h * 0.93), fill=255)
        draw.rectangle((cx + w * 0.02, h * 0.60, cx + w * 0.13, h * 0.93), fill=255)
        return mask.filter(ImageFilter.GaussianBlur(max(1, min(w, h) / 300)))

    def status(self) -> str:
        return "mock"


class HttpSegmentation:
    """Calls a remote inference endpoint (for example a hosted BiRefNet).

    Contract the endpoint must honour:
      request : POST <url>, body = JPEG bytes, Content-Type: image/jpeg,
                Authorization: Bearer <key> when a key is configured
      response: 200 with a PNG whose alpha channel (or grey value, if it has
                no alpha) is the mask. Any size; it is resized to the input.
    """

    name = "http"

    def __init__(self, url: str, api_key: str = "", timeout: float = 60, client: httpx.Client | None = None):
        self.url = url
        self.api_key = api_key
        self.client = client or httpx.Client(timeout=timeout)

    def segment(self, image: Image.Image) -> Image.Image:
        buffer = io.BytesIO()
        # Transport copy only. The original capture is never replaced by this.
        image.convert("RGB").save(buffer, "JPEG", quality=95)
        headers = {"Content-Type": "image/jpeg"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        try:
            response = self.client.post(self.url, content=buffer.getvalue(), headers=headers)
        except httpx.TimeoutException as e:
            raise SegmentationError("timeout", "The segmentation service timed out") from e
        except httpx.HTTPError as e:
            raise SegmentationError("provider-unreachable", "The segmentation service could not be reached") from e
        if response.status_code != 200:
            raise SegmentationError("provider-error", f"The segmentation service answered {response.status_code}")
        try:
            result = Image.open(io.BytesIO(response.content))
            result.load()
        except Exception as e:
            raise SegmentationError("provider-error", "The segmentation service returned an unreadable mask") from e
        return result.getchannel("A") if "A" in result.getbands() else result.convert("L")

    def status(self) -> str:
        # Configured, but not verified until a job runs: there is no health contract.
        return "configured"


def build_segmentation(settings: Settings) -> SegmentationProvider | None:
    if settings.segmentation_provider == "mock":
        return MockSegmentation()
    if settings.segmentation_provider == "http":
        if not settings.segmentation_url:
            raise RuntimeError("HTTP segmentation selected but PHOTOBOOTH_SEGMENTATION_URL is empty")
        return HttpSegmentation(
            settings.segmentation_url, settings.segmentation_api_key, settings.segmentation_timeout_seconds
        )
    return None
