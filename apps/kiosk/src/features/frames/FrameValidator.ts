import { parseAspectRatio, type Rect, type Size } from '@accurova/image-engine';
import type { FrameConfig } from '@accurova/template-engine';

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

const result = (errors: string[], warnings: string[] = []): ValidationResult => ({
  ok: errors.length === 0,
  errors,
  warnings,
});

export const MAX_FRAME_BYTES = 4 * 1024 * 1024;

const FORBIDDEN_ELEMENTS = new Set(['script', 'foreignobject', 'iframe', 'object', 'embed', 'audio', 'video', 'animate', 'set']);

/**
 * Checks that an SVG is safe and self-contained before it is ever rendered.
 * Frames are uploaded artwork: scripts, event handlers and external
 * references are refused outright rather than stripped, so a bad file is
 * fixed at the source instead of silently altered.
 */
export function validateSvg(text: string): ValidationResult & { size?: Size } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (new Blob([text]).size > MAX_FRAME_BYTES) errors.push('The SVG is larger than 4 MB.');

  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (doc.querySelector('parsererror') || root?.localName !== 'svg') {
    return result(['The file is not a valid SVG document.']);
  }

  for (const element of [root, ...Array.from(root.querySelectorAll('*'))]) {
    const name = element.localName.toLowerCase();
    if (FORBIDDEN_ELEMENTS.has(name)) errors.push(`<${element.localName}> elements are not allowed.`);
    if (name === 'style' && /@import|url\(\s*['"]?(?!#|data:)/i.test(element.textContent ?? '')) {
      errors.push('Stylesheets may not load external resources.');
    }
    for (const attribute of Array.from(element.attributes)) {
      const attr = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (attr.startsWith('on')) errors.push(`Event handler attribute "${attribute.name}" is not allowed.`);
      if ((attr === 'href' || attr === 'xlink:href') && !(value.startsWith('#') || value.startsWith('data:image/'))) {
        errors.push(`External reference "${value.slice(0, 60)}" is not allowed; embed the asset instead.`);
      }
      if (attr === 'style' && /url\(\s*['"]?(?!#|data:)/i.test(value)) {
        errors.push('Inline styles may not load external resources.');
      }
    }
  }
  if (root.querySelector('text')) {
    warnings.push('The SVG contains live text. It renders with the device’s fonts; convert text to outlines for exact results.');
  }

  let size: Size | undefined;
  const viewBox = root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
  if (viewBox?.length === 4 && viewBox.every(Number.isFinite) && viewBox[2]! > 0 && viewBox[3]! > 0) {
    size = { width: viewBox[2]!, height: viewBox[3]! };
  } else {
    const width = parseFloat(root.getAttribute('width') ?? '');
    const height = parseFloat(root.getAttribute('height') ?? '');
    if (width > 0 && height > 0) {
      size = { width, height };
      warnings.push('The SVG has no viewBox; add one so it scales cleanly.');
    } else {
      errors.push('The SVG needs a viewBox (or width and height).');
    }
  }
  return { ...result([...new Set(errors)], warnings), size };
}

/** Reads a PNG header without decoding: confirms the format, size and an alpha channel. */
export function validatePng(bytes: Uint8Array): ValidationResult & { size?: Size } {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 33 || signature.some((byte, i) => bytes[i] !== byte)) {
    return result(['The file is not a PNG image.']);
  }
  const errors: string[] = [];
  if (bytes.length > MAX_FRAME_BYTES * 4) errors.push('The PNG is larger than 16 MB.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size = { width: view.getUint32(16), height: view.getUint32(20) };
  const colourType = bytes[25]!;
  let hasAlpha = colourType === 4 || colourType === 6;
  if (!hasAlpha && colourType === 3) {
    // Palette images carry transparency in a tRNS chunk before the image data.
    for (let offset = 8; offset + 8 <= bytes.length; ) {
      const length = view.getUint32(offset);
      const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
      if (type === 'tRNS') hasAlpha = true;
      if (type === 'tRNS' || type === 'IDAT') break;
      offset += 12 + length;
    }
  }
  if (!hasAlpha) errors.push('The PNG has no transparency; the photograph could not show through it.');
  return { ...result(errors), size };
}

/** Compares the artwork's shape with what the frame configuration promises. */
export function validateFrameGeometry(frame: FrameConfig, artwork: Size): ValidationResult {
  const errors: string[] = [];
  const expected = parseAspectRatio(frame.targetAspectRatio);
  const actual = artwork.width / artwork.height;
  if (Math.abs(actual - expected) / expected > 0.01) {
    errors.push(
      `The artwork is ${artwork.width}×${artwork.height} but the frame is configured as ${frame.targetAspectRatio}.`,
    );
  }
  const inside = (box: Rect) => box.x + box.width <= 1.0001 && box.y + box.height <= 1.0001;
  if (!inside(frame.photoWindow)) errors.push('The photo window extends outside the frame.');
  for (const slot of frame.sponsorSlots) {
    if (!inside(slot.box)) errors.push(`Sponsor slot "${slot.id}" extends outside the frame.`);
  }
  return result(errors);
}

export interface PixelReader {
  /** Alpha (0-255) of the rendered frame at a canvas pixel. */
  alphaAt(x: number, y: number): number;
}

/**
 * Confirms the rendered frame really is see-through where the configuration
 * says the photograph goes, and opaque somewhere outside it. This is what
 * catches a `photoWindow` that no longer matches replaced artwork.
 */
export function validateWindowTransparency(pixels: PixelReader, window: Rect, canvas: Size): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const inset = 0.12;
  const samples: Array<[number, number]> = [
    [0.5, 0.5],
    [inset, inset],
    [1 - inset, inset],
    [inset, 1 - inset],
    [1 - inset, 1 - inset],
  ];
  const blocked = samples.filter(
    ([u, v]) => pixels.alphaAt(Math.round(window.x + u * window.width), Math.round(window.y + v * window.height)) > 8,
  );
  if (blocked.length > 0) {
    errors.push('The frame is not transparent across its photo window; the artwork and "photoWindow" disagree.');
  }
  const corners: Array<[number, number]> = [
    [2, 2],
    [canvas.width - 3, 2],
    [2, canvas.height - 3],
    [canvas.width - 3, canvas.height - 3],
  ];
  if (corners.every(([x, y]) => pixels.alphaAt(x, y) < 8)) {
    warnings.push('The frame is transparent at every corner; it may not be drawing a border at all.');
  }
  return result(errors, warnings);
}

export function mergeValidation(...parts: ValidationResult[]): ValidationResult {
  return result(
    parts.flatMap((p) => p.errors),
    parts.flatMap((p) => p.warnings),
  );
}
