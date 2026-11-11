# ADR 0002 — Templates are static files loaded at runtime

Date: 2026-11-11 · Status: accepted

## Context
New clients must not need core source changes or separate builds, and the
frontend is hosted statically.

## Decision
- Templates live in `/templates` at the repo root, outside all application code.
- `templates/index.json` registers them; each has one `template.json`
  containing branding, capture policy, backgrounds and frames inline (one fetch).
- The kiosk loads them over HTTP via `TemplateRegistry` and validates with zod.
  A Vite plugin serves the folder in dev and copies it into `dist/templates` on build.
- The base URL is configurable (`VITE_TEMPLATES_BASE_URL`), so templates can
  later be served from R2 or the API with no kiosk change.
- The zod schema is the single source of truth. The API validates structure only.

## Consequences
Adding a client is a content change. While templates ship with the static
site, it still needs a redeploy; moving them to R2/API (M7) removes that.
Invalid templates fail loudly with a list of issues rather than rendering partially.
