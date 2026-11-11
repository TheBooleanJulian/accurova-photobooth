# ADR 0003 — Capture provider selection

Date: 2026-11-11 · Status: accepted (revisit after M1 hardware results)

## Context
Three ways to get a picture in a browser, with different quality and
automation trade-offs, and support that varies by device and OS version.

## Decision
- All methods implement `CameraCaptureProvider`.
- Automatic selection order: `imagecapture`, then `stream`.
- `native` (file input) is never selected automatically: it needs a person to
  press the system shutter and confirm, which breaks unattended operation. It
  stays available for diagnostics and as an explicit administrator override.
- Selection uses each provider's runtime capability report. User agent is
  never an input.
- A failing still capture throws; it does not fall back to a stream frame
  within the same capture. Falling back is a selection-time decision, visible
  to the administrator.
- An administrator override that is unsupported on the device is ignored,
  with the reason reported.

## Consequences
On Safari before 18.4 the kiosk uses stream frames and says so. Whether that
meets the quality minimum on a given tablet is a measured fact recorded in
`CAMERA_COMPATIBILITY.md`, and the template's `belowMinimumPolicy` decides
what happens if it does not.
