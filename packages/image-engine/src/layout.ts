/**
 * Pure layout maths for the final composite. No canvas, no DOM: every function
 * maps numbers to numbers, so the geometry is testable and identical wherever
 * it runs.
 *
 * Coordinate spaces used below:
 *   canvas      pixels of the final image
 *   background  pixels of the background photograph
 *   foreground  pixels of the segmented visitor image
 *   normalised  0..1 fractions, as stored in template.json
 */

export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Size {
  x: number;
  y: number;
}

/** [left, top, right, bottom] in foreground pixels, as reported by the API. */
export type SubjectBox = readonly [number, number, number, number];

export interface Composition {
  subjectAnchorX: number;
  subjectAnchorY: number;
  subjectScale: number;
}

/** "9:16" -> 0.5625 (width / height). */
export function parseAspectRatio(value: string): number {
  const match = /^(\d+):(\d+)$/.exec(value);
  const w = Number(match?.[1]);
  const h = Number(match?.[2]);
  if (!match || !(w > 0) || !(h > 0)) throw new Error(`Invalid aspect ratio "${value}"`);
  return w / h;
}

/** Pixel size of the final image for an aspect ratio and a longest edge. */
export function outputSize(aspectRatio: string, longestEdge: number): Size {
  const ratio = parseAspectRatio(aspectRatio);
  return ratio >= 1
    ? { width: longestEdge, height: Math.round(longestEdge / ratio) }
    : { width: Math.round(longestEdge * ratio), height: longestEdge };
}

/** Normalised rectangle -> pixels of `size`, snapped to whole pixels. */
export function denormalize(box: Rect, size: Size): Rect {
  const x = Math.round(box.x * size.width);
  const y = Math.round(box.y * size.height);
  return {
    x,
    y,
    width: Math.round((box.x + box.width) * size.width) - x,
    height: Math.round((box.y + box.height) * size.height) - y,
  };
}

/**
 * The centred region of `source` that fills `target` exactly when scaled
 * uniformly (CSS `object-fit: cover`). Returned in source pixels.
 */
export function coverCrop(source: Size, target: Size): Rect {
  const scale = Math.max(target.width / source.width, target.height / source.height);
  const width = target.width / scale;
  const height = target.height / scale;
  return { x: (source.width - width) / 2, y: (source.height - height) / 2, width, height };
}

/** Fits `source` inside `box` without distortion (CSS `object-fit: contain`). */
export function fitContain(source: Size, box: Rect, align: 'left' | 'center' | 'right' = 'center'): Rect {
  const scale = Math.min(box.width / source.width, box.height / source.height);
  const width = source.width * scale;
  const height = source.height * scale;
  const free = box.width - width;
  const x = box.x + (align === 'left' ? 0 : align === 'right' ? free : free / 2);
  return { x, y: box.y + (box.height - height) / 2, width, height };
}

export interface SubjectPlacementInput {
  foreground: Size;
  subjectBox: SubjectBox;
  background: Size;
  /** Where the photograph shows through the frame, in canvas pixels. */
  window: Rect;
  composition: Composition;
  /** The subject may not be wider than this share of the window. */
  maxWidthFraction?: number;
  /** Minimum clear space above the subject's head, as a share of the window height. */
  minHeadroomFraction?: number;
}

export interface SubjectPlacement {
  /** Where to draw the WHOLE foreground image, in canvas pixels. */
  rect: Rect;
  /** Where the person ends up, in canvas pixels. */
  subject: Rect;
  /** Canvas pixels per foreground pixel. Above 1 means the visitor is enlarged. */
  scale: number;
  /** Centre of the feet, in canvas pixels. */
  anchor: { x: number; y: number };
  /** True when the template's requested size had to be reduced to fit. */
  clamped: boolean;
}

/**
 * Places the visitor on the background.
 *
 * The template's composition is expressed against the background photograph
 * (feet at subjectAnchor, height = subjectScale × background height). The
 * background is cover-cropped into the frame's window, so anchor and size are
 * carried through that same crop to land on the right spot of the canvas.
 */
export function placeSubject(input: SubjectPlacementInput): SubjectPlacement {
  const { foreground, subjectBox, background, window, composition } = input;
  const maxWidth = (input.maxWidthFraction ?? 0.92) * window.width;
  const headroom = (input.minHeadroomFraction ?? 0.03) * window.height;

  const [left, top, right, bottom] = subjectBox;
  const boxWidth = right - left;
  const boxHeight = bottom - top;
  if (!(boxWidth > 0) || !(boxHeight > 0)) throw new Error('The subject box is empty');

  const crop = coverCrop(background, window);
  const k = window.width / crop.width; // canvas pixels per background pixel
  const anchor = {
    x: window.x + (composition.subjectAnchorX * background.width - crop.x) * k,
    y: window.y + (composition.subjectAnchorY * background.height - crop.y) * k,
  };

  let scale = (composition.subjectScale * background.height * k) / boxHeight;
  let clamped = false;
  const limits = [maxWidth / boxWidth, (anchor.y - window.y - headroom) / boxHeight];
  for (const limit of limits) {
    if (limit > 0 && scale > limit) {
      scale = limit;
      clamped = true;
    }
  }

  const subject: Rect = {
    x: anchor.x - (boxWidth * scale) / 2,
    y: anchor.y - boxHeight * scale,
    width: boxWidth * scale,
    height: boxHeight * scale,
  };
  return {
    rect: {
      x: subject.x - left * scale,
      y: subject.y - top * scale,
      width: foreground.width * scale,
      height: foreground.height * scale,
    },
    subject,
    scale,
    anchor,
    clamped,
  };
}
