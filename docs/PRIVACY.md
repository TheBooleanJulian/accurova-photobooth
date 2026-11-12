# Privacy

How the system handles personal data **as built today**, and what remains to
be done before a public deployment. This is an engineering description to
support a PDPA review, not legal advice.

## What is personal data here

A photograph of an identifiable visitor is personal data under Singapore's
PDPA. Nothing else about a visitor is collected: no name, contact, account,
device identifier or location. Session records hold a random id, the template
id, timestamps, image dimensions and a hash of the download token.

## Where a photograph exists, and for how long

| Item | Where | Deleted |
| --- | --- | --- |
| Capture, on the tablet | Browser memory and IndexedDB (to survive a reload) | On retake, on session reset, and whenever the kiosk returns to the welcome screen |
| Original capture, on the server | Object storage, `captures/<session>.jpg` | Immediately after successful segmentation (unless `PHOTOBOOTH_RETAIN_ORIGINALS=true`); otherwise on retake, on delivery, or at session expiry (30 min) |
| Segmented foreground | Object storage, `foregrounds/<job>.png` | When the final photo is delivered, on retake, or at session expiry |
| Final photograph | Object storage, `results/<session>.jpg` | 24 hours after delivery (`PHOTOBOOTH_LINK_EXPIRY_HOURS`), by the retention job; R2 lifecycle rule at 2 days as a backstop |
| Session and job records | Database | With the final photograph, at expiry |
| Diagnostics report | Inside a QR link, decoded on the operator's phone | Never stored or uploaded |

Retention only happens if the cleanup job runs: schedule `python -m app.retention`
(or `POST /api/admin/cleanup`) every 15 minutes, and add the R2 lifecycle rule.

## Access controls in place

- Photographs are in private storage; the only way to one is its download
  link, a 256-bit random token. The server stores only the token's hash.
- Wrong, expired and deleted links are indistinguishable.
- Downloads are sent `no-store` and `noindex`.
- Uploads are validated by content, size-limited and rate-limited.
- Session and job ids are random UUIDs; no sequential identifiers are exposed.
- Supabase tables have row level security enabled with no policies, so only
  the API's service role can read them.

## Third parties that would process photographs

| Party | Role | Status |
| --- | --- | --- |
| Cloudflare | Hosts the kiosk site; R2 would store photographs | Site live; R2 not yet connected |
| Supabase | Session metadata only (no images) | Adapter written; not yet connected |
| GPU inference provider | Receives the capture for segmentation | Not chosen |
| API host | Runs the API that handles all images | Not chosen |

Each needs checking for data location and a data-processing agreement. The
segmentation provider matters most: confirm it does not retain or train on
submitted images.

## Outstanding before a public deployment

1. **Notice and consent at the booth.** The welcome screen states the purpose
   and the 24-hour deletion. Review the wording, add it to signage, and name
   the organisation responsible.
2. **Children.** Decide and state the rule for minors (for example, a parent
   or guardian starts the session).
3. **Contact for requests.** Publish who handles access and deletion requests,
   and add a way to delete a photo early from its download page.
4. **Client and sponsor use.** The system gives photographs only to the
   visitor. Any other use (marketing, galleries) needs separate consent.
5. **Administrator access.** Protect `/admin/*` (see `DEPLOYMENT.md`).
6. **Retention evidence.** Monitor the cleanup job and alert if it stops.
7. **Breach response.** Decide who assesses and notifies under the PDPA's
   data-breach obligation.
8. **Transfer outside Singapore.** Record where each provider stores and
   processes data.
