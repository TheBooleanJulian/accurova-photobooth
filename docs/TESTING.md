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

Frontend, 60 tests:
- `CameraManager`: delivered vs requested settings, cleanup, superseded starts,
  error mapping, insecure context, track events, restart.
- Providers: stream frame sizing and labelling, MIME reporting, not-ready
  guards; ImageCapture support detection, max photo size, retry, no silent
  fallback, rebinding after restart; native capture and cancellation.
- Diagnostics: provider selection and override, quality verdicts, capture
  records, resolution probe, device helpers.
- Template engine: every template on disk (schema, assets, locale parity,
  frame geometry), schema rejections, registry loading, caching and errors.

API, 11 tests: health honesty, listing, retrieval, unsafe ids, disabled and
invalid templates, missing directory.

## Not yet covered

Component tests for the pages, the end-to-end visitor flow (M6), and anything
involving segmentation, compositing, frames, storage or delivery.
