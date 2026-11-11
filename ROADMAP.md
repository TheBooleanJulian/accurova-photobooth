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
- ⬜ **Validate on the iPad Pro 10.5" (2017) in Safari** — protocol in `docs/CAMERA_COMPATIBILITY.md`
- ⬜ Record results and decide the capture strategy (see open question below)

**Gate:** no further visitor UI until M1 is validated on hardware.

### Open question M1 must answer
The reference iPad cannot run iPadOS 18, and Safari only gained ImageCapture in
18.4, so this device is expected to use **stream frames**. Whether its front
camera stream reaches the 2000 px minimum is unknown until measured. If it does
not, choose one of: lower the minimum for this template, use the rear camera
with an external preview, or use a newer tablet. See `docs/PROMPT_REVIEW.md`.

## M2 — Capture workflow ⬜
Preview, positioning guide, countdown, still capture, review/retake; session
store (Zustand + IndexedDB); Wake Lock; recovery from reload and tab suspension.

## M3 — Segmentation ⬜
Local MediaPipe preview checks; cloud segmentation behind a provider interface
(mock adapter first); choose GPU provider and API host (ADR needed).

## M4 — Background compositing ⬜
Background selection UI, composition metadata, colour matching, export.

## M5 — Frame engine ⬜
SVG/PNG adapters, sponsor slots, final rendering, validated asset replacement
(including SVG sanitising and font embedding).

## M6 — Visitor application ⬜
Full kiosk flow, EN/中文, QR code + download page, auto reset.
- ✅ Built early (backend only): sessions, final-image upload, expiring download
  tokens, retention cleanup, rate limiting, local + R2 storage adapters
- ⬜ Supabase adapter (schema ready in `infra/supabase`), R2 verified against a real bucket

## M7 — Administration ⬜
Admin authentication, frame/background/sponsor management, lighting
calibration, health, kiosk reset.

## M8 — Deployment and validation ⬜
Hosting, retention jobs, PDPA review, physical reliability testing.

## Documentation still to write (with their milestones)
CAMERA_SETUP (M2), SEGMENTATION + IMAGE_PROCESSING (M3), COMPOSITING (M4),
FRAME_SYSTEM + BRAND_ASSET_GUIDE (M5), API_REFERENCE + DATABASE_SCHEMA (M6),
PRIVACY (M8). DEPLOYMENT exists and grows with each milestone.
