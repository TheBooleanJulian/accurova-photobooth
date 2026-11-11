import type { Drawable, Size } from '@accurova/image-engine';
import { validatePng, validateSvg, type ValidationResult } from '../FrameValidator';

export interface LoadedArtwork {
  image: Drawable<CanvasImageSource>;
  validation: ValidationResult;
}

/** Turns one kind of frame asset into something a canvas can draw. */
export interface FrameAdapter {
  readonly format: 'svg' | 'png';
  /** Validates first; when validation fails, `image` is absent and nothing was rendered. */
  load(url: string, target: Size): Promise<{ image?: Drawable<CanvasImageSource>; validation: ValidationResult }>;
}

export async function decodeImage(src: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = 'async';
  image.src = src;
  await image.decode();
  return image;
}

async function fetchOk(url: string): Promise<Response> {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`${url} responded ${response.status}`);
  return response;
}

/**
 * Sets explicit pixel dimensions on the SVG root so browsers rasterise it at
 * the output size instead of scaling up a small bitmap (Safari does the latter).
 */
export function sizeSvgForRaster(text: string, target: Size): string {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  doc.documentElement.setAttribute('width', String(target.width));
  doc.documentElement.setAttribute('height', String(target.height));
  return new XMLSerializer().serializeToString(doc);
}

export class SvgFrameAdapter implements FrameAdapter {
  readonly format = 'svg' as const;

  async load(url: string, target: Size) {
    const text = await (await fetchOk(url)).text();
    const validation = validateSvg(text);
    if (!validation.ok || !validation.size) return { validation };
    // The scale keeps the artwork's own aspect ratio; geometry is checked by the engine.
    const blob = new Blob([sizeSvgForRaster(text, target)], { type: 'image/svg+xml' });
    const objectUrl = URL.createObjectURL(blob);
    try {
      const element = await decodeImage(objectUrl);
      return { image: { source: element, ...validation.size }, validation };
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }
}

export class PngFrameAdapter implements FrameAdapter {
  readonly format = 'png' as const;

  async load(url: string) {
    const bytes = new Uint8Array(await (await fetchOk(url)).arrayBuffer());
    const validation = validatePng(bytes);
    if (!validation.ok || !validation.size) return { validation };
    const objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
    try {
      const element = await decodeImage(objectUrl);
      return { image: { source: element, ...validation.size }, validation };
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }
}

/** Loads any raster or vector asset (logos, backgrounds) as a drawable. */
export async function loadDrawable(url: string, fallbackSize?: Size): Promise<Drawable<CanvasImageSource>> {
  const element = await decodeImage(url);
  // SVGs without intrinsic dimensions report 0; fall back to the size we will draw at.
  const width = element.naturalWidth || fallbackSize?.width || 0;
  const height = element.naturalHeight || fallbackSize?.height || 0;
  if (!width || !height) throw new Error(`${url} has no usable dimensions`);
  return { source: element, width, height };
}
