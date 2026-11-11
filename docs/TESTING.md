# Testing

## Three kinds of evidence, kept separate

| Kind | Where | What it proves |
| --- | --- | --- |
| **Simulated unit tests** | `*.test.ts`, run by `npm test` | Logic: provider selection, fallbacks, cleanup, schema rules. Uses fake tracks and injected encoders. Says nothing about real cameras. |
| **Browser smoke test** | Manual, Chrome with `--use-fake-device-for-media-stream` | The built page works end to end against real browser APIs with a synthetic camera. |
| **Physical hardware** | `docs/CAMERA_COMPATIBILITY.md` | What a real device delivers. The only evidence that counts for image quality. |

## Commands

```bash
npm test                 # vitest, jsdom
npm run typecheck
npm run build
cd services/api && python -m pytest
```

## Current coverage

Frontend, 70 tests:
- `CameraManager`: delivered vs requested settings, cleanup, superseded starts,
  error mapping, insecure context, track events, restart.
- Providers: stream frame sizing and labelling, MIME reporting, not-ready
  guards; ImageCapture support detection, max photo size, retry, no silent
  fallback, rebinding after restart; native capture and cancellation.
- Diagnostics: provider selection and override, quality verdicts, capture
  records, resolution probe, device helpers.
- API client: request shapes, error mapping, job polling, timeout and abort.
- Template engine: every template on disk (schema, assets, locale parity,
  frame geometry), schema rejections, registry loading, caching and errors.

API, 50 tests: health honesty, template listing/retrieval, unsafe ids, disabled
and invalid templates; the full delivery flow, byte-for-byte download, token
randomness and hashing, upload rejection (empty, non-image, PNG, truncated,
oversized), retry revoking the old link, session and link expiry, cleanup and
its retry on storage failure, admin auth, rate limiting, storage confinement,
and the R2 adapter against a fake client (not a real bucket); processing:
refusal when unconfigured, the full job flow with the mock provider,
idempotent start, retake, bounded retries, empty masks, mask rescaling, EXIF
rotation, stall timeout, original retention, intermediate deletion, and the
HTTP provider against a simulated transport (not a real inference service).

## Not yet covered

Component tests for the pages, the end-to-end visitor flow (M6), and anything
involving compositing or frames. No real segmentation model has been run. R2 and Supabase have not been
exercised against real services.
