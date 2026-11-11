# API reference

Base: the FastAPI service in `services/api`. Interactive docs at `/docs` when running.
Not built yet: `/api/admin/diagnostics` and the admin upload endpoints.
`/api/backgrounds` and `/api/frames` are covered by `/api/templates/{id}`,
which returns both. Capture and processing are scoped to a session
(`/api/session/{id}/capture`, `/api/session/{id}/process`) rather than the
flat paths the prompt suggested, so every upload belongs to exactly one session.

Typed client for the kiosk: `apps/kiosk/src/services/api.ts`.

## Health and templates

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/admin/health` | `services` reports real state: `local`, `connected`, `error`, `not-configured` |
| GET | `/api/templates` | Enabled templates |
| GET | `/api/templates/{template_id}` | Full template; 404 for unknown, disabled or unsafe ids |

## Sessions

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/session/create` | Body `{"templateId": "…"}` → 201 `{sessionId, templateId, status, hasResult, expiresAt}`. Session lives 30 minutes until a result is attached. |
| GET | `/api/session/{id}/result` | Session state. Never returns the token. |
| PUT | `/api/session/{id}/result` | Raw JPEG body. Returns `{token, imageUrl, infoUrl, width, height, expiresAt}`. Retrying replaces the image and revokes the previous token. |
| POST | `/api/session/{id}/complete` | Marks the kiosk session finished. The download link keeps working. |

Upload rules: bytes are inspected, not the content type. 400 empty, 415 not a
valid JPEG, 413 over `PHOTOBOOTH_MAX_UPLOAD_MB` or over the maximum edge.

## Capture and processing

| Method | Path | Notes |
| --- | --- | --- |
| PUT | `/api/session/{id}/capture` | Raw JPEG body: the original capture, stored byte for byte. A second upload is a retake and discards the previous job and foreground. 409 once the session has its final photo. |
| POST | `/api/session/{id}/process` | 202 with the job. Idempotent: the same job is returned while it runs or after it finishes. A failed job is retried, up to `PHOTOBOOTH_MAX_JOB_ATTEMPTS` (3). 503 when no segmentation provider is configured, 409 without a capture. |
| GET | `/api/process/{job_id}` | `{jobId, status, error, attempts, provider, width, height, subjectBox, foregroundUrl}` |
| GET | `/api/process/{job_id}/foreground` | Lossless RGBA PNG at the photograph's full size, EXIF rotation applied. 409 until done. |

Job status: `queued` → `segmenting` → `done` or `failed`.
Error codes: `timeout`, `no-subject`, `capture-missing`, `provider-error`,
`provider-unreachable`, `internal-error`. A job with no progress for
`PHOTOBOOTH_JOB_TIMEOUT_SECONDS` (120) is failed with `timeout` when next read.

`subjectBox` is `[left, top, right, bottom]` in pixels: the kiosk uses it with
the background's composition metadata to place and scale the visitor.

Lifecycle of files: the original is deleted after successful processing
(unless `PHOTOBOOTH_RETAIN_ORIGINALS=true`); the foreground and job are deleted
when the final photo is uploaded, on retake, or when the session expires.

The pipeline division: the API segments; the kiosk composites background,
foreground and frame on a canvas and uploads the finished JPEG.

## Delivery

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/download/{token}/info` | `{templateId, width, height, expiresAt, imageUrl}` for the download page |
| GET | `/api/download/{token}` | The JPEG, as an attachment, `Cache-Control: private, no-store` |

Wrong, expired and deleted links all return the same 404. Tokens are 256-bit
random values; only their SHA-256 is stored. Links expire after
`PHOTOBOOTH_LINK_EXPIRY_HOURS` (24).

The QR code points at the kiosk-site page `/d/{token}` (built), which calls
these two endpoints; storage paths and session ids are never exposed.

## Administration

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/admin/cleanup` | `Authorization: Bearer <PHOTOBOOTH_ADMIN_TOKEN>`. Deletes expired sessions and their images. 503 while no token is configured. |

## Limits

Session creation, uploads and downloads share a per-client limit of
`PHOTOBOOTH_RATE_LIMIT_PER_MINUTE` (30), held in memory per instance. A booth
tablet is one client; raise the limit or move limiting to the edge if several
booths share an address.
