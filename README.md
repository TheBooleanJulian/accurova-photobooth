# Accurova Photobooth

A reusable, self-service AI photo-booth platform. The core handles camera
capture, segmentation, background compositing, branded frames and QR delivery;
**templates** define the client, backgrounds, frame, sponsors and copy.
Little Red Dot Tours is the first template, not the application's identity.

**Status: M0 (foundation) and M1 (camera proof of concept) are built. M1 still
needs validating on the physical iPad.** See [ROADMAP.md](ROADMAP.md).

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # unit tests (simulated cameras)
npm run build        # type-check + production build to apps/kiosk/dist
```

| Route | What it is |
| --- | --- |
| `/` | Operator start page |
| `/admin/diagnostics` | Camera diagnostics (M1) |
| `/kiosk/little-red-dot-tours` | Template-driven welcome screen |

API (optional so far, serves templates and health only):

```bash
cd services/api
pip install -r requirements.txt
uvicorn app.main:app --reload
python -m pytest
```

## Testing the camera on a tablet

Browsers only expose cameras over HTTPS. Two ways:

1. **Deploy** to Cloudflare Workers. `wrangler.jsonc` is ready; see
   [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Then open `/admin/diagnostics` on the tablet.
2. **Same Wi-Fi:** `npm run dev:lan`, then open `https://<your-computer-ip>:5173/admin/diagnostics`
   and accept the self-signed certificate warning.

Then follow the protocol in [docs/CAMERA_COMPATIBILITY.md](docs/CAMERA_COMPATIBILITY.md)
and use **Download report** to save the results.

## Layout

```
apps/kiosk/              React + Vite PWA (visitor kiosk and admin tools)
  src/features/camera/   Device-agnostic camera subsystem
packages/template-engine Template schema (zod) and runtime registry
packages/shared-types    Contracts shared by kiosk and API
services/api/            FastAPI service
templates/               One folder per client; loaded at runtime
docs/                    Architecture, camera notes, ADRs
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Camera architecture](docs/CAMERA_ARCHITECTURE.md) and [compatibility log](docs/CAMERA_COMPATIBILITY.md)
- [Template development](docs/TEMPLATE_DEVELOPMENT.md)
- [Testing](docs/TESTING.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Review of the master prompt](docs/PROMPT_REVIEW.md)
- [Decisions](docs/decisions/)
