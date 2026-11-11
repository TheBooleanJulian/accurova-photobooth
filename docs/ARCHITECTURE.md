# Architecture

## Shape

```
          templates/  (static JSON + assets, one folder per client)
               │  fetched at runtime
               ▼
┌──────────────────────────────┐        ┌───────────────────────────┐
│ apps/kiosk (React PWA)       │  HTTP  │ services/api (FastAPI)    │
│  features/camera             │ ─────▶ │  templates, health  (M0)  │
│  features/templates          │        │  capture/process/…  (M3+) │
│  pages: kiosk, admin         │        └───────────────────────────┘
└──────────────────────────────┘
   uses packages/template-engine, packages/shared-types
```

## Core vs template

| Core owns | Template owns |
| --- | --- |
| Camera, capture, session, segmentation, compositing, frame engine, storage, delivery, kiosk operation | Branding, colours, logo, backgrounds, frames, sponsor assets, locales, capture/quality policy, expiry |

A template is `templates/<id>/template.json` plus assets, registered in
`templates/index.json`. The kiosk never imports template files; it fetches
them through `TemplateRegistry` and validates them with the zod schema. Adding
a client is therefore a content change, not a code change or a new build
(see ADR 0002).

## Modules today

- **`packages/template-engine`** — `schema.ts` is the single source of truth
  for template, background, frame and sponsor-slot shapes (types are inferred
  from it). `registry.ts` loads, validates and caches at runtime and reports
  failures with a code (`not-found`, `disabled`, `invalid`, `network`).
- **`packages/shared-types`** — contracts used on both sides of the API.
- **`apps/kiosk/src/features/camera`** — see `CAMERA_ARCHITECTURE.md`.
- **`services/api`** — reads the same `templates/` folder. It checks structure
  only; full validation lives in the TypeScript schema to avoid two diverging
  definitions.

## Processing split

The API segments; the kiosk composites. The kiosk uploads the original
capture, the API returns a lossless RGBA foreground plus the subject's pixel
bounds, the kiosk draws background + foreground + frame on a canvas and
uploads the finished JPEG, which the API stores and serves through an
expiring token. See `API_REFERENCE.md`.

## Planned modules (not built)

`features/capture`, `segmentation`, `backgrounds`, `compositing`, `frames`,
`delivery`, `session`, and `packages/image-engine`. Each will sit behind an
interface with a mock adapter first, as the camera providers do.

## Conventions

- Feature-detect; never branch on user agent.
- Read back what the platform delivered; never trust what was requested.
- External services that are not connected report `not-configured` or `mock`.
- Normalised (0..1) coordinates for all layout metadata.
- Asset paths are relative to the template folder; absolute paths, URLs and `..` are rejected.
