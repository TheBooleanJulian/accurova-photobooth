import { coverCrop, fitContain, placeSubject, type Composition, type Rect, type Size, type SubjectBox, type SubjectPlacement } from './layout';

/** Anything a 2D canvas can draw, with its intrinsic pixel size. */
export interface Drawable<Source = unknown> extends Size {
  source: Source;
}

/** The subset of CanvasRenderingContext2D the compositor uses. */
export interface Context2D {
  globalAlpha: number;
  fillStyle: unknown;
  save(): void;
  restore(): void;
  beginPath(): void;
  rect(x: number, y: number, w: number, h: number): void;
  clip(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  translate(x: number, y: number): void;
  scale(x: number, y: number): void;
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): {
    addColorStop(offset: number, color: string): void;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  drawImage(image: any, ...args: number[]): void;
}

export interface SponsorLayer {
  id: string;
  image: Drawable;
  /** Slot rectangle in canvas pixels; the logo is fitted inside, aspect ratio preserved. */
  box: Rect;
  align?: 'left' | 'center' | 'right';
}

export interface CompositeInput {
  output: Size;
  /** Transparent area of the frame, in canvas pixels. */
  window: Rect;
  background: Drawable;
  composition: Composition;
  foreground: Drawable;
  subjectBox: SubjectBox;
  frame: Drawable;
  sponsors?: SponsorLayer[];
  /** 0 disables the contact shadow. */
  shadowOpacity?: number;
}

export interface CompositeReport {
  placement: SubjectPlacement;
  /** Order in which layers were drawn, bottom first. */
  layers: string[];
  /** Above 1 the visitor was enlarged beyond the captured pixels. */
  subjectUpscale: number;
}

/**
 * Draws the final image, bottom to top:
 *   1. background (cover-cropped into the frame's window)
 *   2. contact shadow under the feet
 *   3. segmented visitor
 *   4. frame artwork (over the whole canvas)
 *   5. sponsor logos (inside their slots)
 * Layers 1-3 are clipped to the window so nothing bleeds under a translucent frame.
 */
export function drawComposite(ctx: Context2D, input: CompositeInput): CompositeReport {
  const { output, window, background, foreground, frame } = input;
  const layers: string[] = [];
  const placement = placeSubject({
    foreground,
    subjectBox: input.subjectBox,
    background,
    window,
    composition: input.composition,
  });

  ctx.save();
  ctx.beginPath();
  ctx.rect(window.x, window.y, window.width, window.height);
  ctx.clip();

  const crop = coverCrop(background, window);
  ctx.drawImage(background.source, crop.x, crop.y, crop.width, crop.height, window.x, window.y, window.width, window.height);
  layers.push('background');

  const opacity = input.shadowOpacity ?? 0;
  if (opacity > 0) {
    const radius = placement.subject.width * 0.55;
    ctx.save();
    ctx.translate(placement.anchor.x, placement.anchor.y);
    ctx.scale(1, 0.22); // squash a circle into a ground-plane ellipse
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
    gradient.addColorStop(0, `rgba(0, 0, 0, ${opacity})`);
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
    ctx.restore();
    layers.push('shadow');
  }

  const { rect } = placement;
  ctx.drawImage(foreground.source, rect.x, rect.y, rect.width, rect.height);
  layers.push('visitor');
  ctx.restore();

  ctx.drawImage(frame.source, 0, 0, output.width, output.height);
  layers.push('frame');

  for (const sponsor of input.sponsors ?? []) {
    const fitted = fitContain(sponsor.image, sponsor.box, sponsor.align);
    ctx.drawImage(sponsor.image.source, fitted.x, fitted.y, fitted.width, fitted.height);
    layers.push(`sponsor:${sponsor.id}`);
  }

  return { placement, layers, subjectUpscale: placement.scale };
}

export interface CanvasLike {
  width: number;
  height: number;
  getContext(type: '2d'): Context2D | null;
  toBlob(callback: (blob: Blob | null) => void, type?: string, quality?: number): void;
}

export interface ComposeOptions {
  jpegQuality?: number;
  createCanvas?: (size: Size) => CanvasLike;
}

export interface ComposeResult {
  blob: Blob;
  width: number;
  height: number;
  report: CompositeReport;
}

/** Renders the composite and encodes it once, as the final JPEG. */
export async function composeFinal(input: CompositeInput, options: ComposeOptions = {}): Promise<ComposeResult> {
  const createCanvas =
    options.createCanvas ??
    ((size: Size) => {
      const canvas = document.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
      return canvas as unknown as CanvasLike;
    });
  const canvas = createCanvas(input.output);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable');

  // JPEG has no transparency: anything the frame leaves uncovered must be opaque.
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, input.output.width, input.output.height);
  const report = drawComposite(ctx, input);

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error('The final image could not be encoded'))),
      'image/jpeg',
      options.jpegQuality ?? 0.93,
    ),
  );
  const { width, height } = input.output;
  // Release canvas memory promptly; tablets have tight budgets.
  canvas.width = 0;
  canvas.height = 0;
  return { blob, width, height, report };
}
