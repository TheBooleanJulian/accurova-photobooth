# Camera architecture

Location: `apps/kiosk/src/features/camera/`

## Responsibilities

| File | Role |
| --- | --- |
| `CameraManager.ts` | Owns the one preview `MediaStream`. Start, stop, restart, track events. The only code that opens or releases the camera. |
| `CameraCaptureProvider` (`types.ts`) | Contract every capture method implements: `initialize`, `getCapabilities`, `capture`, `dispose`. |
| `ImageCaptureProvider.ts` | Primary. Real still via `ImageCapture.takePhoto()`. |
| `StreamCaptureProvider.ts` | Secondary. One frame of the preview stream via canvas. |
| `NativeCaptureProvider.ts` | Tertiary, diagnostic. OS camera via `<input type="file" capture>`. |
| `SimulatedCaptureProvider.ts` | Tests and hardware-free development. Output tagged `simulated`. |
| `CameraCapabilities.ts` | Runtime environment detection. |
| `CameraDeviceRegistry.ts` | Camera enumeration. |
| `CameraDiagnostics.ts` | Provider selection, quality verdict, resolution probe, capture records. |
| `CameraPreview.tsx` | Displays the stream. Does not capture. |
| `measureImage.ts` | Reads real pixel dimensions from an encoded file. |

Preview and capture are separate concerns: providers borrow the manager's
track; the preview component only renders.

## Rules the code enforces

1. **Selection is by feature detection.** `selectProvider()` takes the
   providers' own capability reports. User agent is displayed as a hint only.
2. **Automatic order:** `imagecapture` → `stream`. `native` is never chosen
   automatically, because a person must operate the system camera; an
   administrator can force it.
3. **No silent downgrade.** If `takePhoto()` fails, the provider throws. It
   does not quietly return a stream frame.
4. **Honest labelling.** Every `CapturedImage` carries `captureMethod`;
   `CaptureRecord.nativeStill` is false for stream frames.
5. **Measured, not requested.** Stream size comes from `video.videoWidth/Height`
   (which also reflects rotation); still size comes from decoding the file.
   In testing, Chrome's fake device reported a 1920×1080 photo maximum and
   then returned a 3840×2160 file, which is exactly why capabilities are not
   trusted.
6. **One owner releases the camera.** `CameraManager.stop()` stops every
   track; a `start()` that resolves after being superseded discards its stream.
7. **The original Blob is returned untouched.** Nothing in this module
   resamples or re-encodes a still.

## Quality policy

`evaluateQuality(width, height, policy)` → `preferred` (longest edge ≥ 3000),
`acceptable` (≥ 2000) or `below-minimum`. Thresholds come from the template
(`capture.quality`), with `belowMinimumPolicy: warn | block` for the kiosk to
apply in M2.

## Interruption handling

`CameraManager.onEvent` forwards `ended`, `mute` and `unmute`. The diagnostics
page restarts the stream when the page becomes visible and the track is no
longer live (Safari stops cameras for background tabs). M2 will move this into
a shared hook for the kiosk flow.

## Known limits

- Stream capture encodes JPEG at quality 0.95 through a canvas; that is the
  first-generation file for that method, not a re-compression.
- Canvas size limits on older iPadOS (about 16.7 million pixels) are above
  any stream size expected today but would matter for very large frames.
- `getCapabilities()` on a track is optional; `maxWidth/maxHeight` may be absent.
- Admin routes are not authenticated yet (M7).
