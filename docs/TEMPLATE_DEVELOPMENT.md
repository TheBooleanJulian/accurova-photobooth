# Template development

A template is a folder. Creating one needs no code change and no new build
configuration.

```
templates/
  index.json                 registry: id, name, enabled
  <template-id>/
    template.json            everything about the client
    branding/                logo
    backgrounds/             photographs + thumbnails
    frames/                  frame artwork (SVG preferred, or transparent PNG)
    sponsors/                sponsor logos
    locales/<locale>.json    visitor-facing strings
```

## Add a template

1. Copy `templates/little-red-dot-tours` to `templates/<new-id>` (lowercase kebab-case).
2. Set `"id"` in `template.json` to the folder name.
3. Add `{ "id": "<new-id>", "name": "…", "enabled": true }` to `templates/index.json`.
4. Replace assets and edit the config.
5. Run `npm test`. One test validates every template on disk: schema, that
   every referenced asset exists, that locales have identical keys, and that
   frame boxes stay inside the frame.
6. Open `/kiosk/<new-id>`.

## `template.json` reference

The authoritative definition is `packages/template-engine/src/schema.ts`.

| Field | Meaning |
| --- | --- |
| `branding.colors` | `background`, `surface`, `primary`, `text` as `#rrggbb` |
| `capture.facingMode` | `user` (front) or `environment` (rear) |
| `capture.providerOverride` | `auto`, or force `imagecapture` / `stream` / `native` |
| `capture.quality` | `preferredLongestEdge`, `minimumLongestEdge`, `belowMinimumPolicy` (`warn` or `block`) |
| `capture.setup` | Booth guidance for staff: camera height (cm) and subject distance (m) ranges |
| `backgrounds[].composition` | `subjectAnchorX/Y` = where the subject's feet go; `subjectScale` = subject height as a fraction of the background; `horizonY` optional |
| `frames[].photoWindow` | The transparent area of the frame, normalised to the frame |
| `frames[].sponsorSlots[].box` | Box each sponsor logo is fitted into, aspect ratio preserved |
| `output.jpegQuality` | 0.5–1, default 0.93 |
| `delivery.linkExpiryHours` | Default 24 |

All coordinates are normalised 0..1. All asset paths are relative to the
template folder.

## Replacing the placeholder artwork

**Backgrounds.** Put the photograph and a thumbnail in `backgrounds/`, point
`image` and `thumbnail` at them, set `placeholder` to `false` and record the
`licence`. Use real photographs you hold usage rights for. Portrait 9:16,
at least 2160×3840 recommended. The `*-placeholder.svg` files come from
`npm run placeholders`.

**Frame.** Replace `frames/lrdt-standard-frame.svg` (1080×1920 viewBox) or
add a PNG with a transparent window, then update `photoWindow` to match the
transparent area. Sponsor logos are separate files placed into `sponsorSlots`
boxes, so do not draw them into the frame. Outline text or embed fonts: when
the frame is rasterised into the final JPEG (M5), fonts that are not embedded
fall back to system fonts.

**Logo and sponsors.** Replace the files in `branding/` and `sponsors/`. Set a
slot's `enabled` to `false` to hide it.

Until the admin upload UI exists (M7), replacing assets means changing files
in this folder and redeploying the static site.
