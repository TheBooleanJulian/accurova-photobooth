import { describe, expect, it } from 'vitest';
import {
  composeFinal,
  coverCrop,
  denormalize,
  drawComposite,
  fitContain,
  outputSize,
  parseAspectRatio,
  placeSubject,
  type CanvasLike,
  type CompositeInput,
  type Context2D,
} from '../index';

describe('sizes', () => {
  it('parses aspect ratios and rejects nonsense', () => {
    expect(parseAspectRatio('9:16')).toBeCloseTo(0.5625);
    expect(() => parseAspectRatio('9x16')).toThrow();
    expect(() => parseAspectRatio('0:16')).toThrow();
  });

  it('derives the output size from the longest edge', () => {
    expect(outputSize('9:16', 1920)).toEqual({ width: 1080, height: 1920 });
    expect(outputSize('16:9', 1920)).toEqual({ width: 1920, height: 1080 });
    expect(outputSize('1:1', 2000)).toEqual({ width: 2000, height: 2000 });
  });

  it('turns normalised boxes into whole pixels without gaps', () => {
    const window = denormalize({ x: 0.0407, y: 0.1146, width: 0.9185, height: 0.7448 }, { width: 1080, height: 1920 });
    expect(window).toEqual({ x: 44, y: 220, width: 992, height: 1430 });
  });
});

describe('coverCrop / fitContain', () => {
  it('crops the sides of a wide source and the top/bottom of a tall one', () => {
    expect(coverCrop({ width: 4000, height: 2000 }, { width: 500, height: 1000 })).toEqual({
      x: 1500,
      y: 0,
      width: 1000,
      height: 2000,
    });
    expect(coverCrop({ width: 1000, height: 4000 }, { width: 1000, height: 1000 })).toEqual({
      x: 0,
      y: 1500,
      width: 1000,
      height: 1000,
    });
  });

  it('keeps logo aspect ratios inside a sponsor slot', () => {
    const slot = { x: 100, y: 50, width: 300, height: 100 };
    expect(fitContain({ width: 600, height: 100 }, slot)).toEqual({ x: 100, y: 75, width: 300, height: 50 });
    expect(fitContain({ width: 100, height: 100 }, slot)).toEqual({ x: 200, y: 50, width: 100, height: 100 });
    expect(fitContain({ width: 100, height: 100 }, slot, 'left').x).toBe(100);
    expect(fitContain({ width: 100, height: 100 }, slot, 'right').x).toBe(300);
  });
});

describe('placeSubject', () => {
  const window = { x: 44, y: 220, width: 992, height: 1430 };
  // Background with the same aspect as the window: no cropping, k = 0.5.
  const background = { width: 1984, height: 2860 };
  const base = {
    foreground: { width: 3000, height: 4000 },
    subjectBox: [1000, 500, 2000, 3500] as const,
    background,
    window,
    composition: { subjectAnchorX: 0.5, subjectAnchorY: 0.9, subjectScale: 0.7 },
  };

  it('puts the feet on the anchor and sizes the person from the background', () => {
    const p = placeSubject(base);
    expect(p.clamped).toBe(false);
    expect(p.anchor).toEqual({ x: 44 + 496, y: 220 + 1287 });
    expect(p.subject.height).toBeCloseTo(0.7 * 1430);
    expect(p.subject.y + p.subject.height).toBeCloseTo(p.anchor.y);
    expect(p.subject.x + p.subject.width / 2).toBeCloseTo(p.anchor.x);
    // The whole foreground image is drawn so that the box lands on `subject`.
    expect(p.rect.x + 1000 * p.scale).toBeCloseTo(p.subject.x);
    expect(p.rect.y + 500 * p.scale).toBeCloseTo(p.subject.y);
    expect(p.rect.width).toBeCloseTo(3000 * p.scale);
  });

  it('follows the background through its cover crop', () => {
    // A landscape background: only its central strip is visible in the window.
    const wide = { width: 4000, height: 2860 };
    const p = placeSubject({ ...base, background: wide, composition: { ...base.composition, subjectAnchorX: 0.6 } });
    const crop = coverCrop(wide, window);
    const k = window.width / crop.width;
    expect(p.anchor.x).toBeCloseTo(window.x + (0.6 * 4000 - crop.x) * k);
    expect(p.subject.height).toBeCloseTo(0.7 * 2860 * k);
  });

  it('shrinks a subject that would be wider than the window', () => {
    const p = placeSubject({ ...base, subjectBox: [0, 500, 3000, 3500] });
    expect(p.clamped).toBe(true);
    expect(p.subject.width).toBeCloseTo(0.92 * window.width);
  });

  it('keeps headroom above the head', () => {
    const p = placeSubject({ ...base, composition: { subjectAnchorX: 0.5, subjectAnchorY: 0.9, subjectScale: 1.4 } });
    expect(p.clamped).toBe(true);
    expect(p.subject.y).toBeCloseTo(window.y + 0.03 * window.height);
  });

  it('rejects an empty subject box', () => {
    expect(() => placeSubject({ ...base, subjectBox: [10, 10, 10, 50] })).toThrow(/empty/);
  });
});

/** Records every call so layer order and clipping can be asserted without a real canvas. */
function recordingContext() {
  const calls: Array<[string, ...unknown[]]> = [];
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
    };
  const ctx = {
    globalAlpha: 1,
    fillStyle: '' as unknown,
    save: record('save'),
    restore: record('restore'),
    beginPath: record('beginPath'),
    rect: record('rect'),
    clip: record('clip'),
    fillRect: record('fillRect'),
    translate: record('translate'),
    scale: record('scale'),
    drawImage: record('drawImage'),
    createRadialGradient: (...args: number[]) => {
      calls.push(['createRadialGradient', ...args]);
      return { addColorStop: record('addColorStop') };
    },
  } satisfies Context2D;
  return { ctx, calls };
}

const input = (over: Partial<CompositeInput> = {}): CompositeInput => ({
  output: { width: 1080, height: 1920 },
  window: { x: 44, y: 220, width: 992, height: 1430 },
  background: { source: 'BG', width: 1080, height: 1920 },
  composition: { subjectAnchorX: 0.5, subjectAnchorY: 0.88, subjectScale: 0.72 },
  foreground: { source: 'FG', width: 1500, height: 2000 },
  subjectBox: [500, 200, 1000, 1900],
  frame: { source: 'FRAME', width: 1080, height: 1920 },
  sponsors: [
    { id: 'sponsor-primary', image: { source: 'S1', width: 340, height: 120 }, box: { x: 90, y: 1690, width: 340, height: 120 } },
    { id: 'sponsor-secondary', image: { source: 'S2', width: 200, height: 200 }, box: { x: 650, y: 1690, width: 340, height: 120 } },
  ],
  shadowOpacity: 0.28,
  ...over,
});

describe('drawComposite', () => {
  it('draws background, shadow, visitor, frame, sponsors in that order', () => {
    const { ctx, calls } = recordingContext();
    const report = drawComposite(ctx, input());
    expect(report.layers).toEqual(['background', 'shadow', 'visitor', 'frame', 'sponsor:sponsor-primary', 'sponsor:sponsor-secondary']);
    expect(calls.filter(([name]) => name === 'drawImage').map(([, source]) => source)).toEqual(['BG', 'FG', 'FRAME', 'S1', 'S2']);
  });

  it('clips the photograph to the window and draws the frame over the full canvas', () => {
    const { ctx, calls } = recordingContext();
    drawComposite(ctx, input());
    const names = calls.map(([name]) => name);
    const clip = names.indexOf('clip');
    const frame = calls.findIndex(([name, source]) => name === 'drawImage' && source === 'FRAME');
    expect(calls[names.indexOf('rect')]).toEqual(['rect', 44, 220, 992, 1430]);
    expect(clip).toBeGreaterThan(-1);
    // The clip is lifted (restore) before the frame is drawn.
    expect(names.lastIndexOf('restore')).toBeLessThan(frame);
    expect(calls[frame]).toEqual(['drawImage', 'FRAME', 0, 0, 1080, 1920]);
  });

  it('skips the shadow when disabled and preserves sponsor aspect ratios', () => {
    const { ctx, calls } = recordingContext();
    const report = drawComposite(ctx, input({ shadowOpacity: 0 }));
    expect(report.layers).not.toContain('shadow');
    expect(calls.find(([name, source]) => name === 'drawImage' && source === 'S2')).toEqual(['drawImage', 'S2', 760, 1690, 120, 120]);
  });

  it('reports when the visitor is enlarged beyond the captured pixels', () => {
    const { ctx } = recordingContext();
    const small = drawComposite(ctx, input({ foreground: { source: 'FG', width: 300, height: 400 }, subjectBox: [100, 40, 200, 380] }));
    expect(small.subjectUpscale).toBeGreaterThan(1);
    expect(drawComposite(ctx, input()).subjectUpscale).toBeLessThan(1);
  });
});

describe('composeFinal', () => {
  it('fills an opaque base, encodes one JPEG at the configured quality and frees the canvas', async () => {
    const { ctx, calls } = recordingContext();
    const encoded: Array<[string | undefined, number | undefined]> = [];
    const canvas: CanvasLike = {
      width: 0,
      height: 0,
      getContext: () => ctx,
      toBlob: (callback, type, quality) => {
        encoded.push([type, quality]);
        callback(new Blob(['jpeg'], { type: 'image/jpeg' }));
      },
    };
    const result = await composeFinal(input(), {
      jpegQuality: 0.95,
      createCanvas: (size) => Object.assign(canvas, size),
    });
    expect(calls[0]).toEqual(['fillRect', 0, 0, 1080, 1920]);
    expect(encoded).toEqual([['image/jpeg', 0.95]]);
    expect(result).toMatchObject({ width: 1080, height: 1920 });
    expect(result.blob.type).toBe('image/jpeg');
    expect(canvas.width).toBe(0);
  });

  it('fails loudly when encoding fails', async () => {
    const { ctx } = recordingContext();
    const canvas: CanvasLike = { width: 0, height: 0, getContext: () => ctx, toBlob: (callback) => callback(null) };
    await expect(composeFinal(input(), { createCanvas: () => canvas })).rejects.toThrow(/could not be encoded/);
  });
});
