# Accurova Photobooth --- Claude Code Master Prompt

You are Claude Code acting as a senior software architect, full-stack
engineer, computer-vision engineer and UI/UX designer. Build **Accurova
Photobooth**, a reusable, self-service AI photo-booth platform. Do not
stop at planning or scaffolding: inspect the repository, implement
working features incrementally, run tests, and maintain documentation.

## 1. Product definition

-   **Project/repository:** `accurova-photobooth`
-   **Platform:** Responsive Progressive Web App (PWA), primarily iPadOS
    Safari; future support for Android tablets and other compatible
    browsers.
-   **Reference device:** Apple iPad Pro 10.5-inch (2017). This is a
    test device, NOT a hardcoded hardware requirement.
-   **First template:** `little-red-dot-tours`
-   **Capture:** Full-body portrait, highest practical still-image
    resolution supported by the device/browser.
-   **Processing:** Hybrid local and cloud AI.
-   **Output:** Digital souvenir/social-media JPEG, with selectable
    real-photo backgrounds and a branded graphic frame.
-   **Operation:** Self-service kiosk; no staff intervention during
    normal sessions.

Visitor flow: welcome → instructions → camera preview/positioning →
countdown → still-photo capture → review/retake → choose tourism
background → AI segmentation/compositing → apply branded frame → show
final image and QR code → download → automatic session reset.

The platform core must remain independent of any particular
client/template. Little Red Dot Tours is the first deployment, not the
identity of the whole application.

## 2. Non-negotiable architecture principles

1.  Device-agnostic: detect capabilities at runtime; never assume all
    iPads or tablets have identical cameras or APIs.
2.  Still-photo first: do not use a video-stream screenshot when a
    better still-capture method is available.
3.  Never silently downgrade image quality or misrepresent a stream
    frame as a native still photograph.
4.  Preserve the original capture; never overwrite it during processing.
5.  Separate camera, segmentation, background, compositing, frame,
    template, storage and delivery modules.
6.  Template-driven branding and assets; new templates must not require
    core source changes or separate builds.
7.  Replaceable camera and AI providers.
8.  Resilient to network interruptions, Safari reloads, camera failures
    and abandoned sessions.
9.  Privacy-first, minimal personal data, automatic deletion.
10. Maintain detailed documentation and architectural decision records
    for future AI coding agents.

## 3. Preferred technology stack

**Frontend:** React, TypeScript, Vite, Tailwind CSS, React Router,
Zustand, `vite-plugin-pwa`, IndexedDB, HTML Canvas. Use Web Workers
where beneficial.

**Camera:** MediaDevices API, MediaStreamTrack, ImageCapture API where
supported, HTML video preview, Canvas fallback, optional native
file-input capture.

**Computer vision:** MediaPipe or equivalent for local
preview/segmentation; BiRefNet or another suitable high-quality human
segmentation model for cloud processing. Keep providers replaceable.

**Backend:** Python 3.12+, FastAPI, Pydantic, Pillow, OpenCV,
asynchronous processing jobs.

**Infrastructure:** Cloudflare Pages for frontend, Cloudflare R2 for
object storage, Supabase for session metadata/admin data, and a suitable
managed GPU inference provider. Avoid unnecessary paid services and
infrastructure in the MVP.

Inspect the repository before selecting or changing dependencies.
Preserve useful existing code.

## 4. Device-agnostic camera subsystem

Create a dedicated camera module, for example:

``` text
features/camera/
  CameraManager.ts
  CameraCapabilities.ts
  CameraDiagnostics.ts
  CameraDeviceRegistry.ts
  CameraCaptureProvider.ts
  ImageCaptureProvider.ts
  StreamCaptureProvider.ts
  NativeCaptureProvider.ts
  CameraPreview.tsx
  CameraPositioningGuide.tsx
  types.ts
```

Define a common provider contract:

``` typescript
interface CameraCaptureProvider {
  initialize(): Promise<void>;
  getCapabilities(): Promise<CameraCapabilities>;
  capture(): Promise<CapturedImage>;
  dispose(): Promise<void>;
}

interface CapturedImage {
  blob: Blob;
  width: number;
  height: number;
  mimeType: string;
  fileSize: number;
  captureMethod: "imagecapture" | "stream" | "native";
  metadata?: Record<string, unknown>;
}
```

### Capture strategy

**Primary --- ImageCapture API:** Where supported, initialise
`ImageCapture` from the active camera track and use `takePhoto()`.
Inspect photo capabilities and actual output dimensions. Do not assume
support on the reference iPad.

**Secondary --- stream capture:** If still capture is unavailable,
request the highest practical stream resolution, inspect actual
settings, and capture via Canvas. Label the method as `stream` and
disclose its actual resolution.

**Tertiary --- native capture:** Provide an optional diagnostic fallback
using `<input type="file" accept="image/*" capture="user">`. This may
interrupt kiosk automation and must not be treated as a guaranteed
automated capture method.

Select the best available provider based on runtime feature detection.
Allow administrator override. Never use user-agent detection as the sole
source of truth.

Inspect: - Available camera devices and front-camera availability. -
Permission state. - Stream dimensions and actual settings. - Still-photo
API support and photo dimensions. - Supported MIME types. - Capture
method, file size and latency. - Browser and operating-system
information where detectable.

Initial quality targets (not hardware guarantees): - Preferred longest
image edge: 3000 px or higher. - Minimum acceptable longest edge: 2000
px. - JPEG preferred. - Preserve original aspect ratio. - Capture
latency target: under 3 seconds.

If the device cannot meet the minimum, warn the administrator, show the
actual dimensions, and allow continuation only according to configured
policy. Never claim unsupported quality.

### Camera UI and positioning

Provide live preview, full-body silhouette, head/foot guides, distance
instructions, countdown, capture confirmation and retake. The preview
stream and still capture must be separate concerns.

Initial physical setup assumptions: tablet on adjustable tripod,
approximately 100--120 cm camera height and 2.5--3 m subject distance.
Make these settings configurable; do not hardcode them.

Always clean up camera streams and recover from camera disconnection,
permission denial, orientation changes and browser interruption.

## 5. Lighting and calibration

The physical booth uses multiple large, diffused LED arrays around the
tablet for frontal surround illumination. Assume: - CRI 95+ preferred. -
Approximately 5000K consistent colour temperature. - Flicker-free
operation. - Diffusion and adjustable brightness. - Independent lighting
power supply.

Create an administrator calibration workflow: display preview, capture a
test photo, inspect exposure/colour/full-body illumination, and save a
lighting profile. Avoid aggressive skin-tone alteration. Support
optional foreground/background colour matching.

Document that the iPad and LED arrays require separate power
arrangements. Do not assume the tablet can power the lights.

## 6. Segmentation and image-processing pipeline

Keep local and cloud segmentation behind a common provider interface.

**Local:** MediaPipe or equivalent for preview assistance, subject
detection, positioning feedback and basic quality checks. Load
asynchronously; use workers where appropriate. Do not block the UI.

**Cloud:** BiRefNet or an equivalent replaceable model for final
high-quality human segmentation. Validate image uploads, generate/refine
alpha masks, preserve hair and clothing detail, and return a transparent
foreground or stored processing result.

Pipeline:

``` text
Original still capture
  → validation and orientation normalisation
  → high-quality segmentation
  → alpha-mask refinement
  → foreground extraction
  → selected background composition
  → optional colour/shadow treatment
  → branded frame overlay
  → final JPEG export
  → QR delivery
```

Pay particular attention to hair, hands, shoes, clothing edges, gaps
between arms and torso, and fine details. Avoid halos, missing body
parts and unnatural edges.

Preserve the original Blob and dimensions. Do not downscale before
segmentation unless technically necessary. Use lossless intermediate
formats where practical. Avoid repeated resampling and unnecessary JPEG
recompression. Initial final JPEG quality: 92--95, configurable.

## 7. Background library and selection

Each background should have: - Unique ID, name, category and
description. - Original image and thumbnail. - Aspect ratio and
availability. - Composition metadata and display order.

Example:

``` json
{
  "id": "marina-bay",
  "name": "Marina Bay",
  "category": "landmark",
  "image": "backgrounds/marina-bay.jpg",
  "thumbnail": "backgrounds/marina-bay-thumb.jpg",
  "composition": {
    "subjectAnchorX": 0.5,
    "subjectAnchorY": 0.85,
    "subjectScale": 0.75,
    "horizonY": 0.6
  },
  "enabled": true
}
```

Use normalised coordinates. Provide a thumbnail grid, large preview,
selection confirmation and ability to change the selection before
finalisation. Use genuine photographs with appropriate usage rights.
Create placeholders until licensed assets are supplied.

Little Red Dot Tours starter backgrounds: 1. Marina Bay Sands. 2.
Gardens by the Bay. 3. Merlion / Marina Bay. 4. Peranakan shophouse
street. 5. Chinatown heritage street. 6. Singapore heritage
architecture.

## 8. Branded frame overlay system --- required feature

The final image must contain three independent visual layers:

1.  Selected tourism background.
2.  Segmented visitor.
3.  Designed branded border frame.

The frame is a graphic asset composited into the final downloadable
JPEG, not merely a CSS border around the preview.

Create an independent frame engine, for example:

``` text
features/frames/
  FrameEngine.ts
  FrameRegistry.ts
  FrameRenderer.ts
  FrameValidator.ts
  FramePreview.tsx
  FrameSelector.tsx
  frame-types.ts
  adapters/
    SvgFrameAdapter.ts
    PngFrameAdapter.ts
    CanvasFrameAdapter.ts
```

Prefer SVG for scalable editable artwork; also support transparent PNG.
Preserve transparency and aspect ratio. Support portrait/landscape
variants where configured, safe areas, margins, opacity, sponsor
alignment, logo sizing and optional text.

A template may define one or multiple frames. Frame rendering must be
independent of camera, segmentation and background selection.

### Initial Little Red Dot Tours placeholder frame

Create a complete, presentable placeholder frame that can later be
replaced without code changes.

Visual direction: - Warm cream border. - Deep red accents. - Subtle
Peranakan-inspired geometric details. - Little Red Dot Tours branding. -
Tagline: "YOUR SINGAPORE STORY". - Primary and secondary sponsor logo
placeholders. - Small Accurova photography credit. - Optional
date/campaign label.

Conceptual layout:

``` text
┌──────────────────────────────┐
│       LITTLE RED DOT TOURS   │
│       YOUR SINGAPORE STORY   │
├──────────────────────────────┤
│                              │
│       FINAL COMPOSITE        │
│                              │
│                              │
├──────────────────────────────┤
│  [SPONSOR A]     [SPONSOR B] │
│       ACCUROVA PHOTOGRAPHY   │
└──────────────────────────────┘
```

Create: - Placeholder SVG. - Placeholder sponsor assets. - Frame
configuration JSON. - Preview image. - Asset replacement documentation.

The placeholder must look intentional, not like a debug overlay.

### Frame configuration example

``` json
{
  "id": "lrt-standard-frame",
  "name": "Little Red Dot Tours Standard Frame",
  "version": "1.0.0",
  "asset": "frames/lrt-standard-frame.svg",
  "format": "svg",
  "targetAspectRatio": "9:16",
  "branding": {
    "brandName": "Little Red Dot Tours",
    "showBrandLogo": true,
    "showSponsors": true
  },
  "sponsorSlots": [
    {
      "id": "sponsor-primary",
      "position": "bottom-left",
      "asset": "sponsors/primary-placeholder.svg"
    },
    {
      "id": "sponsor-secondary",
      "position": "bottom-right",
      "asset": "sponsors/secondary-placeholder.svg"
    }
  ]
}
```

Refine and validate the schema as needed.

The administrator must be able to replace the placeholder by uploading
SVG or transparent PNG, preview it, configure sponsor slots, and
activate it. No camera, segmentation or compositing source changes
should be required. Validate new assets and preserve the previous
working frame if replacement fails.

### Final layer order

``` text
1. Tourism background
2. Segmented visitor
3. Optional shadow / colour treatment
4. Branded frame overlay
5. Final export
```

The frame must be physically incorporated into the exported image. It
must never obscure important parts of the photograph unnecessarily.
Preserve sponsor logo aspect ratios.

## 9. Multi-template platform

The core platform owns: - Camera and capture. - Session management. -
Segmentation. - Background compositing. - Frame engine. - Storage. - QR
delivery. - Kiosk operation.

Each template owns: - Branding and logos. - Backgrounds. - Frames and
sponsor assets. - Languages and visitor copy. - Instructions and
campaign configuration.

First template: `little-red-dot-tours`.

Possible future templates (do not implement yet): -
`accurova-corporate-events` - `hotel-guest-experience` -
`festival-photo-booth`

Implement a template registry and dynamic loading. Example routes:

``` text
/kiosk/little-red-dot-tours
/admin
/admin/templates
/admin/diagnostics
```

A new template should not require a separate application build.

## 10. Little Red Dot Tours template

Brand context: Singapore cultural tourism, Peranakan tours, kueh-making
workshops, batik costume experiences and customised tourism photographs.

Visual direction: - Minimalistic, premium tourism aesthetic. - Warm
cream and deep red. - Subtle Peranakan-inspired geometric details. -
Modern typography. - Avoid excessive tourist clichés.

Create logo placeholders, welcome-screen branding, the placeholder
frame, sponsor placeholders and Accurova photography credit.

Languages: English and Simplified Chinese. Externalise all
visitor-facing strings into locale files.

SG Culture Pass payment integration is outside the photo-booth MVP.

## 11. Visitor kiosk screens

Implement: 1. Welcome --- branding, tagline, start, language selector
and privacy notice. 2. Instructions --- full-body positioning and
distance guidance. 3. Camera --- live preview, positioning guide and
countdown. 4. Photograph review --- actual captured still, retake and
confirm. 5. Background selection --- selectable tourism thumbnails and
preview. 6. Processing --- branded progress animation and
visitor-friendly status. 7. Final result --- completed photograph
including frame and QR code. 8. Completion --- download instructions and
automatic reset.

Design for tablet portrait and landscape. Use large touch targets,
minimal text and no visitor keyboard/account requirements. Visitors must
not access administrator features.

## 12. QR delivery

1.  Upload final JPEG to object storage.
2.  Generate a random, unguessable download token.
3.  Create a QR code pointing to a mobile-friendly download page.
4.  Display QR on kiosk.
5.  Support mobile download and native sharing where available.
6.  Expire links after 24 hours by default.
7.  Delete expired images.

Do not expose internal storage paths or sequential session identifiers.

## 13. Administrator mode

Protect a separate admin interface with authentication.

Prioritise: - Template selection. - Camera diagnostics. - Background
management. - Frame management. - Sponsor asset management. - Kiosk
reset. - System health.

Frame management must support viewing, previewing, selecting,
uploading/replacing SVG or PNG, configuring sponsor slots,
enabling/disabling slots and validating assets before activation.

Camera diagnostics must show device/browser details where available,
permissions, camera devices, stream resolution, still-photo resolution,
file size, capture method, MIME type, capture latency and ImageCapture
support. Provide a diagnostic capture and original-image download.

## 14. Backend and API

Use FastAPI, Pydantic, Pillow/OpenCV and asynchronous jobs. Use
Cloudflare R2 for image storage and Supabase for session metadata/admin
data.

Suggested endpoints:

``` text
POST   /api/session/create
GET    /api/templates
GET    /api/templates/{template_id}
GET    /api/backgrounds
GET    /api/frames

POST   /api/capture
POST   /api/process
GET    /api/process/{job_id}

GET    /api/session/{session_id}/result
GET    /api/download/{token}
POST   /api/session/{session_id}/complete

GET    /api/admin/health
GET    /api/admin/diagnostics
POST   /api/admin/frames/upload
POST   /api/admin/backgrounds/upload
```

Use idempotency and prevent duplicate processing jobs. Provide retry
handling and meaningful job status.

## 15. Power, sleep and kiosk resilience

The reference iPad currently requires external power to turn on. Indoor
operation will use continuous power; outdoor deployments may use
appropriately rated power banks. Lighting has a separate power supply.

The application must: - Handle browser visibility changes. - Recover
camera streams after interruptions. - Recover from Safari reloads. -
Persist session state safely. - Avoid unnecessary background CPU use. -
Implement Wake Lock API where supported, with graceful fallback. - Never
promise that a web app can override iPadOS sleep or battery policies.

## 16. Privacy and security

Implement: - Visitor-facing privacy notice. - No visitor accounts or
unnecessary personal data. - HTTPS and secure uploads. - File type and
size validation. - Random download tokens. - Session isolation. - API
rate limiting. - Separate administrator authentication. - Automatic
image deletion.

Default retention: - Original captures: delete after successful
processing unless retention is explicitly authorised. - Intermediate
masks: delete after processing. - Final photographs: delete after 24
hours. - Session metadata: retain only what is operationally necessary.

Document Singapore PDPA considerations and outstanding compliance work.

## 17. Error handling

Handle camera permission denial, unsupported ImageCapture, low
resolution, camera disconnection, Safari reload, tablet sleep, network
loss, backend failure, segmentation failure, storage failure, missing
background/frame assets, QR failure, timeout and visitor abandonment.

Never leave a visitor indefinitely on a processing screen. Implement
appropriate retries, administrator recovery, session cleanup and safe
fallback assets.

## 18. Testing and acceptance

Create automated tests for: - Camera capability detection and provider
selection. - ImageCapture and fallback paths. - Resolution and Blob
validation. - Camera cleanup and recovery. - Template loading and schema
validation. - Background selection and composition metadata. - SVG/PNG
frame loading and transparency. - Sponsor placement and aspect ratio. -
Frame replacement and validation. - Layer ordering and final export. -
Session lifecycle, QR delivery and expiry. - API validation and
security.

Create simulated camera providers for automated tests. Clearly
distinguish simulated tests from physical hardware tests.

End-to-end test: start session → initialise camera → capture still →
review/retake → select background → segment → composite → apply frame →
generate QR → download → reset.

## 19. Suggested repository structure

``` text
accurova-photobooth/
├── apps/
│   ├── kiosk/
│   │   └── src/
│   │       ├── app/
│   │       ├── components/
│   │       ├── features/
│   │       │   ├── camera/
│   │       │   ├── capture/
│   │       │   ├── segmentation/
│   │       │   ├── backgrounds/
│   │       │   ├── compositing/
│   │       │   ├── frames/
│   │       │   ├── delivery/
│   │       │   └── session/
│   │       ├── services/
│   │       ├── stores/
│   │       └── utils/
│   └── admin/
├── services/
│   └── api/
│       ├── app/
│       │   ├── api/
│       │   ├── core/
│       │   ├── models/
│       │   └── services/
│       └── tests/
├── packages/
│   ├── shared-types/
│   ├── template-engine/
│   └── image-engine/
├── templates/
│   └── little-red-dot-tours/
│       ├── template.json
│       ├── branding/
│       ├── backgrounds/
│       ├── frames/
│       ├── sponsors/
│       └── locales/
├── docs/
├── .env.example
├── docker-compose.yml
├── package.json
├── README.md
└── ROADMAP.md
```

Refine as necessary while maintaining clear module boundaries.

## 20. Development milestones

**M0 --- Foundation** - Inspect repository and preserve useful code. -
Set up monorepo, frontend, backend and shared types. - Implement
template registry and Little Red Dot Tours configuration.

**M1 --- Camera proof of concept (first critical deliverable)** - Build
standalone camera diagnostics page. - Detect actual device/browser
capabilities. - Test ImageCapture and fallback methods. - Capture and
download an original still image. - Record actual dimensions, file size
and capture method. - Test on the 10.5-inch iPad Pro Safari. - Document
limitations.

Do not proceed with extensive UI work until the camera proof of concept
is validated.

**M2 --- Capture workflow** - Preview, positioning, countdown, still
capture, review and retake.

**M3 --- Segmentation** - Local preview segmentation, cloud
segmentation, high-quality masks and edge refinement.

**M4 --- Background compositing** - Background library, selection,
composition metadata, colour matching and export.

**M5 --- Frame engine** - SVG/PNG adapters, placeholder Little Red Dot
Tours frame, sponsor slots, preview, final rendering and asset
replacement.

**M6 --- Visitor application** - Complete kiosk workflow, branding,
English/Chinese, QR delivery and reset.

**M7 --- Administration** - Diagnostics, frame/background management,
health checks and session monitoring.

**M8 --- Deployment and validation** - Hosting, storage, privacy,
physical hardware testing and reliability testing.

## 21. Documentation requirements

Documentation is a first-class deliverable. Maintain:

``` text
docs/
  ARCHITECTURE.md
  CAMERA_ARCHITECTURE.md
  CAMERA_COMPATIBILITY.md
  CAMERA_SETUP.md
  IMAGE_PROCESSING.md
  SEGMENTATION.md
  COMPOSITING.md
  FRAME_SYSTEM.md
  TEMPLATE_DEVELOPMENT.md
  BRAND_ASSET_GUIDE.md
  API_REFERENCE.md
  DATABASE_SCHEMA.md
  DEPLOYMENT.md
  PRIVACY.md
  TESTING.md
  decisions/
```

Also maintain README.md, ROADMAP.md, CHANGELOG.md, CONTRIBUTING.md and
`.env.example`.

Record significant architectural decisions as ADRs. Explain module
responsibilities, interfaces, configuration, limitations and operational
procedures so another AI coding agent can continue work without
rediscovering decisions.

## 22. First execution instructions

Begin by inspecting the current repository. Do not assume it is empty.

Then: 1. Establish the architecture and monorepo. 2. Create shared types
and template registry. 3. Create Little Red Dot Tours starter template.
4. Build the standalone camera diagnostics page. 5. Validate capture on
the reference iPad. 6. Implement the still-photo workflow. 7. Implement
segmentation and background compositing. 8. Implement the frame engine
and placeholder frame. 9. Complete visitor flow and QR delivery. 10.
Implement administrator tools. 11. Run tests and document deployment.

Work incrementally. Do not attempt to implement everything in one
enormous pass. If a service or credential is unavailable, create a mock
adapter and continue. Never invent credentials or claim an external
service is connected when it is not.

After each milestone report: - Files created or modified. - Features
implemented. - Tests executed and actual results. - Outstanding issues
and limitations. - Next milestone.

Update ROADMAP.md continuously.

## Final product objective

Accurova Photobooth must become a reusable photography experience
platform.

The core engine handles camera capture, AI segmentation, background
replacement, image compositing, branded frames, sponsor integration and
digital delivery.

Templates define the client, campaign, backgrounds, branding, sponsors
and visitor experience.

**Little Red Dot Tours is the first deployment, not the application's
identity.**

A future client should be onboarded primarily by creating a template
configuration and supplying its backgrounds, frame artwork, logos and
sponsor assets---not by rebuilding the application.
