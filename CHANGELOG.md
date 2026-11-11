# Changelog

## 0.1.0 — 2026-11-11

### Added
- Monorepo foundation (M0): kiosk PWA, template engine, shared types, FastAPI skeleton.
- `little-red-dot-tours` starter template with placeholder artwork.
- Camera subsystem and `/admin/diagnostics` page (M1, pending hardware validation).
- 70 frontend unit tests (simulated cameras and transport) and 50 API tests.
- Cloudflare Workers deployment config, security headers, GitHub Actions CI, API Dockerfile.
- Delivery backend: sessions, final-image upload with JPEG validation, hashed expiring
  download tokens, retention cleanup, rate limiting, admin token; local and R2 storage adapters.
- Processing backend: capture upload, idempotent segmentation jobs (retry, stall timeout,
  EXIF rotation, subject bounds), provider interface with mock and HTTP adapters.
- Kiosk: typed API client and the visitor download page `/d/<token>`.
- GitHub Actions workflow that builds, smoke-tests and publishes the API image to GHCR.
- `infra/`: Supabase schema, R2 lifecycle rule and setup notes; `docker-compose.yml`.
- Architecture, deployment, API reference, camera, template and testing docs; three ADRs; review of the master prompt.
