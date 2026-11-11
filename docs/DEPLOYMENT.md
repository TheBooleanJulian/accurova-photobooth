# Deployment

Status as of 2026-11-11. Only the kiosk frontend is deployable today; the
rest is listed so accounts and decisions can be prepared ahead of the code.

## 1. Kiosk frontend — Cloudflare Workers (static assets) ✅ configured

Configuration lives in `wrangler.jsonc` at the repo root.

| Setting (Cloudflare dashboard → Worker → Settings → Build) | Value |
| --- | --- |
| Git repository | `TheBooleanJulian/accurova-photobooth`, branch `main` |
| Root directory | `/` |
| Build command | leave empty (wrangler runs the build itself) |
| Deploy command | `npx wrangler deploy` |

- `"name"` in `wrangler.jsonc` must equal the Worker's name in the dashboard
  (currently `accurova-photobooth`). Change one to match the other.
- The build is `npm install && npm run build`, declared in `wrangler.jsonc`,
  output `apps/kiosk/dist`. Verified with `npx wrangler deploy --dry-run`.
- Unknown paths fall back to `index.html` (`not_found_handling`), so
  `/admin/diagnostics` and `/kiosk/<id>` work on reload.
- `apps/kiosk/public/_headers` sets `Permissions-Policy: camera=(self)` and
  keeps template JSON and the service worker uncached.
- Templates are deployed with the site at `/templates`.

Addresses:
- Production: `https://photobooth.accurova.com` (custom domain declared in
  `wrangler.jsonc`; Cloudflare creates the DNS record and certificate on deploy).
- Testing: `https://accurova-photobooth.juliancheung.workers.dev` (kept on via `workers_dev`).

If a deploy fails on the custom domain, either `accurova.com` is in a different
Cloudflare account from the Worker, or a DNS record named `photobooth` already
exists and must be deleted first.

Manual deploy from a computer: `npx wrangler login && npx wrangler deploy`.

## 2. CI — GitHub Actions ✅ configured

`.github/workflows/ci.yml` runs frontend tests + build and API tests on every
push and pull request. No secrets required.

## 3. API — container, host not chosen ⬜

`services/api/Dockerfile` builds a self-contained image (templates included):

```bash
docker build -f services/api/Dockerfile -t accurova-photobooth-api .
docker run -p 8000:8000 -e PHOTOBOOTH_CORS_ORIGINS=https://<kiosk-origin> accurova-photobooth-api
```

Or `docker compose up` for a local instance with a persistent volume.

Any container host works (it listens on `$PORT`). It needs a persistent
volume at `/srv/services/api/data` while it uses SQLite and local storage.
The kiosk does not call the API yet, so nothing needs hosting until M3.
**Decision needed before M3:** which host. Record it as an ADR.

Set `PHOTOBOOTH_ADMIN_TOKEN` and schedule retention every 15 minutes:
`python -m app.retention`, or `POST /api/admin/cleanup` with the bearer token.

## 4. To prepare in your own accounts

Step-by-step for R2 and Supabase: `infra/README.md`. The R2 adapter exists and
switches on with environment variables; Supabase is schema-only so far.

| Service | What to create | Needed from |
| --- | --- | --- |
| Cloudflare R2 | Bucket `accurova-photobooth` (private). Lifecycle rule: delete objects after 2 days as a backstop to the app's 24-hour deletion. An API token scoped to that bucket. | M6 |
| Supabase | A project in the Singapore region. Keep the URL and service-role key. Schema arrives with M6. | M6 |
| GPU inference | An account with a provider that can host BiRefNet or an equivalent. Check cold-start time and whether an instance can be kept warm during events. | M3 |
| Domain | Optional subdomain for the kiosk and one for download links. | M6 |

Credentials go in the host's secret store and in a local `.env` (see
`.env.example`), never in the repository.

## 5. Tablet setup for a booth (to verify in M1/M8)

- Settings → Display & Brightness → Auto-Lock → Never, while on external power.
- Settings → Accessibility → Guided Access, to pin Safari or the Home Screen app.
- Allow camera access for the site once; test in the mode the booth will use.
