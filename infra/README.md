# Infrastructure definitions

Nothing here is applied automatically. Each needs an account you control.

## Cloudflare R2 (final photographs)

1. Create a **private** bucket, e.g. `accurova-photobooth`, in the APAC region. Do not enable public access.
2. Add a lifecycle rule deleting objects under `results/` after 2 days. This is a
   backstop: the API deletes at 24 hours (`python -m app.retention`), the rule
   catches anything it misses. In the dashboard: bucket → Settings → Object
   lifecycle rules. `r2/lifecycle.json` records the intended rule.
3. Create an R2 API token with **Object Read & Write**, scoped to that bucket only.
4. Give the API these variables:
   `PHOTOBOOTH_STORAGE_BACKEND=r2`, `PHOTOBOOTH_R2_ACCOUNT_ID`,
   `PHOTOBOOTH_R2_ACCESS_KEY_ID`, `PHOTOBOOTH_R2_SECRET_ACCESS_KEY`, `PHOTOBOOTH_R2_BUCKET`.
5. `GET /api/admin/health` then reports `"storage": "connected"` (it runs a real bucket check).

No CORS configuration is needed: browsers never talk to R2, only the API does.

## Segmentation service (GPU inference)

The API talks to any endpoint that honours this contract
(`PHOTOBOOTH_SEGMENTATION_PROVIDER=http`, `PHOTOBOOTH_SEGMENTATION_URL`,
`PHOTOBOOTH_SEGMENTATION_API_KEY`):

- Request: `POST <url>`, body = JPEG bytes, `Content-Type: image/jpeg`,
  `Authorization: Bearer <key>` when a key is set.
- Response: `200` with a PNG. Its alpha channel is the mask (or its grey value
  if it has no alpha). Any size; the API scales it to the photograph.

So whichever provider hosts BiRefNet (or another model), wrap it in an
endpoint of this shape. No inference server is included in this repository
yet, because its form depends on the provider you choose. Target: a mask
back within about 10 seconds, with a warm instance during events.

## Supabase (session metadata)

Create a project in Singapore and keep the URL and service-role key.
`supabase/migrations/0001_sessions.sql` is the schema. The API still uses
SQLite; the Supabase adapter is not written yet.
