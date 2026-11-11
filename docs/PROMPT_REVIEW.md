# Review of the master prompt (2026-11-11)

The prompt (`MASTER_PROMPT.md`) is well structured: clear module boundaries,
honest-capture rules, a hardware gate at M1 and mock-first external services.
These are the points worth resolving, most important first.

## 1. The reference iPad will not use the "primary" capture path

Safari gained ImageCapture in 18.4. The iPad Pro 10.5" (2017) stops at
iPadOS 17. So on the reference device the kiosk is expected to run on stream
frames, and the still-photo path only applies to newer tablets.

**Consequence:** the 2000 px minimum may not be reachable on this iPad's front
camera through a video stream. M1 measures this. If it falls short, the
options are:
- accept a lower minimum for this deployment (a 1080×1920 social JPEG does not need 3000 px);
- use the rear camera (higher stream resolution) with the screen facing away, plus an external preview;
- use a tablet on iPadOS 18.4 or later.

Decide after the measurement, not before.

## 2. Kiosk behaviour the web cannot guarantee on iPadOS 17

- Screen Wake Lock exists in Safari 16.4+, but was reported unreliable for
  Home Screen web apps until 18.4. Plan on **Guided Access + Auto-Lock: Never**
  as the real kiosk lock, with Wake Lock as a bonus. To be confirmed in M1 step 9.
- Camera permission can be re-prompted in installed mode. Test both modes.

## 3. Two requirements conflict as written

"New templates must not require separate builds" versus static hosting on
Cloudflare Pages. Resolved here by loading templates at runtime from
`/templates` (ADR 0002): no code change or build *configuration* per client,
but adding files still means a redeploy until templates move to R2 or the API (M7).

## 4. Unspecified infrastructure

- **Where FastAPI runs.** Cloudflare Pages cannot host it. Needs a decision before M3.
- **GPU inference provider.** Cold starts of tens of seconds are common on
  serverless GPU; this collides with "never leave a visitor on a processing
  screen". Budget a warm instance during events or a timeout with a local fallback.
- **Full-resolution segmentation.** BiRefNet runs at a fixed working
  resolution; the mask must be upscaled and refined against the original.
  "Do not downscale before segmentation" should read "never replace the
  original; refine the mask at full resolution".

## 5. Security gaps to write into the plan

- Uploaded **SVG frames can carry scripts**. Sanitise on upload and rasterise
  server-side or in an isolated context (M5/M7).
- Admin routes need authentication before any deployment that is reachable by
  visitors; the diagnostics page is currently open.

## 6. Privacy

Photos of identifiable people are personal data under the PDPA. Beyond the
24-hour deletion: a consent notice at the booth, a rule for minors, a named
contact for deletion requests, and R2 lifecycle rules as a backstop to
application-level deletion.

## 7. Smaller points

- The frame is 9:16 but captures are likely 3:4 or 9:16 frames; because the
  subject is segmented and re-placed this is fine, but the frame's photo
  window is not 9:16, so backgrounds are cropped to the window. `photoWindow`
  was added to the frame schema for this.
- The example frame id `lrt-standard-frame` was renamed `lrdt-standard-frame`.
- Sponsor slots gained a normalised `box`; `position` alone cannot place a logo.
- Section 21 lists 15 documents. Empty stubs were not created; each is
  scheduled with its milestone in `ROADMAP.md`.
- Scope: this is several weeks of work. The M1 gate is the right place to stop and look.

## Sources
- ImageCapture support: https://caniuse.com/mdn-api_imagecapture_takephoto
