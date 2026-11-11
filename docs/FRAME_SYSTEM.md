# Frame system

Location: `apps/kiosk/src/features/frames`. Independent of camera,
segmentation and background selection: it turns a frame configuration into
validated, decoded artwork plus pixel geometry.

| File | Role |
| --- | --- |
| `FrameValidator.ts` | Safety and geometry checks |
| `adapters/FrameAdapters.ts` | `SvgFrameAdapter`, `PngFrameAdapter`, `loadDrawable` |
| `FrameEngine.ts` | `FrameEngine.load()` and `FrameRegistry` (active frame, last-good fallback) |

## What a frame is

`frames[]` in `template.json`: an SVG (preferred) or transparent PNG covering
the whole output, a normalised `photoWindow` where the photograph shows
through, and `sponsorSlots` with normalised boxes. Sponsor logos are separate
files composited into their slots, so they can change without touching the frame.

## Validation (all must pass before a frame is used)

1. **SVG safety.** Refused outright: `<script>`, `<foreignObject>`, embedded
   media, event-handler attributes, external `href`s (only `#id` and
   `data:image/` are allowed), and styles that load external resources.
   Unsafe files are rejected, not silently cleaned.
2. **PNG transparency.** The header must declare an alpha channel (or a
   palette with transparency).
3. **Geometry.** Artwork aspect ratio within 1% of `targetAspectRatio`;
   window and sponsor boxes inside the frame.
4. **Window transparency.** The rendered artwork is sampled: it must be
   transparent across `photoWindow`. This catches a window that no longer
   matches replaced artwork.

Warnings (not blocking): live `<text>` in an SVG (rendered with the device's
fonts; convert to outlines for exact results), an SVG without a `viewBox`,
artwork with no border at the corners, a sponsor logo that failed to load
(the logo is left out; the photograph is still produced).

## Replacing a frame safely

`FrameRegistry.activate(frameId)` loads and validates the new frame. If
anything fails, it throws a `FrameError` listing the reasons and **the
previously active frame stays in use**. Check a replacement in
`/admin/compose` before an event.

To replace the placeholder: put the new file in the template's `frames/`
folder, update `asset`, `format` and `photoWindow` in `template.json`, set
`placeholder` to false, and redeploy. Uploading through an admin screen is M7.

## Rendering notes

SVGs are given explicit pixel dimensions before decoding so they rasterise at
output size (some browsers otherwise scale up a small bitmap). External fonts
never load inside an SVG used as an image, which is why outlining text is
recommended.
