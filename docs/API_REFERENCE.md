# API reference

Base: the FastAPI service in `services/api`. Interactive docs at `/docs` when running.
Endpoints from the master prompt that are **not built yet**: `/api/capture`,
`/api/process`, `/api/process/{job_id}`, `/api/backgrounds`, `/api/frames`,
`/api/admin/diagnostics`, and the admin upload endpoints.

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

## Delivery

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/download/{token}/info` | `{templateId, width, height, expiresAt, imageUrl}` for the download page |
| GET | `/api/download/{token}` | The JPEG, as an attachment, `Cache-Control: private, no-store` |

Wrong, expired and deleted links all return the same 404. Tokens are 256-bit
random values; only their SHA-256 is stored. Links expire after
`PHOTOBOOTH_LINK_EXPIRY_HOURS` (24).

The QR code will point at a kiosk-site page (`/d/{token}`, M6) that calls
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
