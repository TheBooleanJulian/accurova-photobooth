# Changelog

## 0.1.0 — 2026-11-11

### Added
- Monorepo foundation (M0): kiosk PWA, template engine, shared types, FastAPI skeleton.
- `little-red-dot-tours` starter template with placeholder artwork.
- Camera subsystem and `/admin/diagnostics` page (M1, pending hardware validation).
- 155 frontend unit tests (simulated cameras, transport and canvas) and 55 API tests.
- Cloudflare Workers deployment config, security headers, GitHub Actions CI, API Dockerfile.
- Delivery backend: sessions, final-image upload with JPEG validation, hashed expiring
  download tokens, retention cleanup, rate limiting, admin token; local and R2 storage adapters.
- Processing backend: capture upload, idempotent segmentation jobs (retry, stall timeout,
  EXIF rotation, subject bounds), provider interface with mock and HTTP adapters.
- Kiosk: typed API client and the visitor download page `/d/<token>`.
- Image engine (`packages/image-engine`): subject placement, compositing, single JPEG export.
- Frame engine: SVG/PNG adapters, safety and geometry validation, sponsor slots, last-good fallback.
- `/admin/compose` preview of the final image for every background and frame.
- Supabase stores for sessions and jobs, so the API can run stateless (with R2).
- Kiosk session infrastructure: state machine, persistent store with resume rules, wake lock,
  idle timer, delivery QR, and the capture-to-delivery pipeline orchestrator.
- `docs/PRIVACY.md`.
- Diagnostics: one-tap full test of both cameras and a QR hand-off of the results to a phone
  (`/admin/report`), for tablets that are signed in to nothing.
- GitHub Actions workflow that builds, smoke-tests and publishes the API image to GHCR.
- `infra/`: Supabase schema, R2 lifecycle rule and setup notes; `docker-compose.yml`.
- Architecture, deployment, API reference, camera, template and testing docs; three ADRs; review of the master prompt.
