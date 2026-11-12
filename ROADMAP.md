# Roadmap

Legend: ✅ done · 🟡 built, awaiting validation · ⬜ not started

## M0 — Foundation ✅
- ✅ Repository inspected (it was empty; nothing to preserve)
- ✅ npm-workspaces monorepo: `apps/kiosk`, `packages/*`, `services/api`, `templates/`
- ✅ Template schema + runtime registry (`packages/template-engine`)
- ✅ `little-red-dot-tours` template: config, EN + zh-CN locales, 6 placeholder
  backgrounds, placeholder frame, sponsor and logo placeholders
- ✅ FastAPI skeleton: health + read-only template endpoints
- ✅ Infra: Cloudflare Workers config (`wrangler.jsonc`), GitHub Actions CI, API Dockerfile, `docs/DEPLOYMENT.md`

## M1 — Camera proof of concept 🟡
- ✅ Camera subsystem: manager, ImageCapture / stream / native providers, simulated provider
- ✅ Runtime capability detection, provider selection with admin override
- ✅ Diagnostics page: stream probe, capture tests, original download, JSON report
- ✅ Verified in desktop Chrome with a fake camera device (not real hardware)
- 🟡 **Validate on the iPad Pro 10.5" (2017) in Safari** — first run (2026-11-12) confirmed
  stream capture is the method; the measured resolutions are still needed
- ⬜ Record results and decide the capture strategy (see open question below)

**Gate:** no further visitor UI until M1 is validated on hardware.

### Open question M1 must answer
The reference iPad cannot run iPadOS 18, and Safari only gained ImageCapture in
18.4, so this device is expected to use **stream frames**. Whether its front
camera stream reaches the 2000 px minimum is unknown until measured. If it does
not, choose one of: lower the minimum for this template, use the rear camera
with an external preview, or use a newer tablet. See `docs/PROMPT_REVIEW.md`.

## M2 — Capture workflow 🟡
- ✅ Session state machine, persistent session store (Zustand + IndexedDB), resume-after-reload rules
- ✅ Wake Lock controller, idle timer for abandoned sessions
- ⬜ Screens: preview, positioning guide, countdown, capture, review/retake

## M3 — Segmentation ⬜
- ✅ Built early (backend): capture upload, idempotent segmentation jobs with
  retry and stall timeout, provider interface with `mock` and generic `http` adapters
- ⬜ Real model behind the `http` contract (needs a GPU provider), mask edge refinement
- ⬜ Local MediaPipe preview checks in the kiosk
- ⬜ Choose GPU provider and API host (ADR needed)

## M4 — Background compositing 🟡
- ✅ Image engine: placement from composition metadata, cover crop, contact shadow, single JPEG export
- ✅ Background library (enabled, ordered, safe fallback) and `/admin/compose` preview tool
- ⬜ Visitor background selection screen, colour matching

## M5 — Frame engine 🟡
- ✅ SVG and PNG adapters, sponsor slots, frame baked into the exported JPEG
- ✅ Validation: unsafe SVG refused, PNG transparency, geometry, photo-window transparency
- ✅ Last-good fallback when a replacement frame fails
- ⬜ Final artwork from the client (placeholder still in use), text outlined
- ⬜ Admin upload and activation UI (M7)

## M6 — Visitor application ⬜
Full kiosk flow, EN/中文, QR code + download page, auto reset.
- ✅ Built early: sessions, final-image upload, expiring download tokens,
  retention cleanup, rate limiting, local + R2 storage adapters, typed API
  client, visitor download page `/d/<token>` (EN/中文, save and share)
- ✅ API container published to GHCR by GitHub Actions
- ✅ Supabase adapter (stateless API option), processing pipeline orchestrator, delivery QR
- ⬜ Supabase and R2 verified against real services; visitor screens

## M7 — Administration ⬜
Admin authentication, frame/background/sponsor management, lighting
calibration, health, kiosk reset.

## M8 — Deployment and validation ⬜
Hosting, retention jobs, PDPA review, physical reliability testing.

## Documentation still to write (with their milestones)
CAMERA_SETUP (M2), SEGMENTATION + IMAGE_PROCESSING (M3), BRAND_ASSET_GUIDE (M5),
DATABASE_SCHEMA (M6). DEPLOYMENT exists and grows with each milestone.
