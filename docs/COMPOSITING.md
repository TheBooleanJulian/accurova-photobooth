# Compositing

Location: `packages/image-engine` (pure engine) and
`apps/kiosk/src/features/compositing` (wires it to templates).

The kiosk composites; the API only segments. The final JPEG is rendered once
on a canvas and uploaded as-is.

## Layer order

```
1. background    cover-cropped into the frame's photo window
2. contact shadow soft ellipse under the feet (template: output.shadowOpacity, 0 = off)
3. visitor       the RGBA foreground from the segmentation job
   -- layers 1-3 are clipped to the photo window --
4. frame         artwork over the whole canvas
5. sponsor logos fitted inside their slots, aspect ratio preserved
6. export        one JPEG encode at output.jpegQuality
```

`drawComposite()` returns the order it actually drew, which the tests assert.

## Placement

`placeSubject()` in `layout.ts` is pure maths. A background's `composition` is
expressed against the background photograph:

- `subjectAnchorX/Y`: where the centre of the visitor's feet goes.
- `subjectScale`: visitor height as a fraction of the background's height.

The background is cover-cropped into the window, so the anchor and size are
carried through the same crop. The person's bounds come from the API's
`subjectBox`. Two safety limits apply, and `placement.clamped` reports when
either reduced the size: the visitor is at most 92% of the window width, and
at least 3% of the window height stays clear above the head.

`report.subjectUpscale` above 1 means the visitor was enlarged beyond the
captured pixels: a signal that the capture resolution is too low for the
output size.

## Output

`template.output`: `aspectRatio`, `longestEdge` (default 1920, giving
1080×1920 at 9:16), `jpegQuality` (0.93), `shadowOpacity` (0.28).

## Preview tool

`/admin/compose` renders the real pipeline with a drawn stand-in figure or an
uploaded transparent PNG cut-out, for every background and frame of a
template, and shows size, render time, layers and placement. It never uses a
live capture.

## Not built yet

Colour matching between visitor and background, mask edge refinement, and
the visitor-facing background selection screen.
