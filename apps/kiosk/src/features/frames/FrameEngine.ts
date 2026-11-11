import { denormalize, type Drawable, type Rect, type Size, type SponsorLayer } from '@accurova/image-engine';
import type { FrameConfig, TemplateConfig } from '@accurova/template-engine';
import { PngFrameAdapter, SvgFrameAdapter, loadDrawable, type FrameAdapter } from './adapters/FrameAdapters';
import {
  mergeValidation,
  validateFrameGeometry,
  validateWindowTransparency,
  type PixelReader,
  type ValidationResult,
} from './FrameValidator';

/** A frame that has been validated and decoded, ready to composite. */
export interface LoadedFrame {
  config: FrameConfig;
  image: Drawable<CanvasImageSource>;
  /** The photo window in canvas pixels. */
  window: Rect;
  sponsors: SponsorLayer[];
  warnings: string[];
}

export class FrameError extends Error {
  constructor(
    readonly frameId: string,
    readonly validation: ValidationResult,
  ) {
    super(`Frame "${frameId}" is not usable: ${validation.errors.join(' ')}`);
    this.name = 'FrameError';
  }
}

export interface FrameEngineDeps {
  adapters?: FrameAdapter[];
  loadSponsor?: (url: string, size: Size) => Promise<Drawable<CanvasImageSource>>;
  /** Renders the frame at output size and exposes its alpha, for the window check. */
  readPixels?: (image: Drawable<CanvasImageSource>, size: Size) => PixelReader;
}

function canvasPixelReader(image: Drawable<CanvasImageSource>, size: Size): PixelReader {
  const canvas = document.createElement('canvas');
  // A reduced copy is plenty for sampling and keeps memory low on tablets.
  const scale = Math.min(1, 540 / Math.max(size.width, size.height));
  canvas.width = Math.round(size.width * scale);
  canvas.height = Math.round(size.height * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D is unavailable');
  ctx.drawImage(image.source, 0, 0, canvas.width, canvas.height);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  return {
    alphaAt: (x, y) => {
      const px = Math.min(canvas.width - 1, Math.max(0, Math.round(x * scale)));
      const py = Math.min(canvas.height - 1, Math.max(0, Math.round(y * scale)));
      return data[(py * canvas.width + px) * 4 + 3] ?? 0;
    },
  };
}

/**
 * Loads and validates frame artwork and its sponsor logos. Knows nothing about
 * cameras, segmentation or backgrounds: it turns a frame configuration into
 * drawables plus pixel geometry, and refuses artwork that fails validation.
 */
export class FrameEngine {
  private readonly adapters: Map<string, FrameAdapter>;
  private readonly loadSponsor: NonNullable<FrameEngineDeps['loadSponsor']>;
  private readonly readPixels: NonNullable<FrameEngineDeps['readPixels']>;

  constructor(
    private readonly assetUrl: (relativePath: string) => string,
    deps: FrameEngineDeps = {},
  ) {
    const adapters = deps.adapters ?? [new SvgFrameAdapter(), new PngFrameAdapter()];
    this.adapters = new Map(adapters.map((a) => [a.format, a]));
    this.loadSponsor = deps.loadSponsor ?? loadDrawable;
    this.readPixels = deps.readPixels ?? canvasPixelReader;
  }

  async load(frame: FrameConfig, output: Size): Promise<LoadedFrame> {
    const adapter = this.adapters.get(frame.format);
    if (!adapter) {
      throw new FrameError(frame.id, { ok: false, errors: [`No adapter for format "${frame.format}".`], warnings: [] });
    }
    const { image, validation: asset } = await adapter.load(this.assetUrl(frame.asset), output);
    if (!image) throw new FrameError(frame.id, asset);

    const window = denormalize(frame.photoWindow, output);
    const validation = mergeValidation(
      asset,
      validateFrameGeometry(frame, image),
      validateWindowTransparency(this.readPixels(image, output), window, output),
    );
    if (!validation.ok) throw new FrameError(frame.id, validation);

    const warnings = [...validation.warnings];
    const sponsors: SponsorLayer[] = [];
    if (frame.branding.showSponsors) {
      for (const slot of frame.sponsorSlots.filter((s) => s.enabled)) {
        const box = denormalize(slot.box, output);
        try {
          sponsors.push({
            id: slot.id,
            image: await this.loadSponsor(this.assetUrl(slot.asset), box),
            box,
            align: slot.position.endsWith('left') ? 'left' : slot.position.endsWith('right') ? 'right' : 'center',
          });
        } catch {
          // A missing logo must not cost the visitor their photograph.
          warnings.push(`Sponsor logo "${slot.id}" could not be loaded and was left out.`);
        }
      }
    }
    return { config: frame, image, window, sponsors, warnings };
  }
}

/**
 * Tracks which frame a template uses and keeps the last frame that loaded
 * successfully, so a broken replacement never takes the booth down.
 */
export class FrameRegistry {
  private active: LoadedFrame | null = null;

  constructor(
    private readonly template: Pick<TemplateConfig, 'frames' | 'defaultFrameId'>,
    private readonly engine: Pick<FrameEngine, 'load'>,
    private readonly output: Size,
  ) {}

  list(): FrameConfig[] {
    return this.template.frames;
  }

  current(): LoadedFrame | null {
    return this.active;
  }

  /**
   * Makes `frameId` (default: the template's default) the active frame.
   * On failure the previous working frame stays active and the error is thrown.
   */
  async activate(frameId: string = this.template.defaultFrameId): Promise<LoadedFrame> {
    const config = this.template.frames.find((f) => f.id === frameId);
    if (!config) {
      throw new FrameError(frameId, { ok: false, errors: ['No such frame in this template.'], warnings: [] });
    }
    const loaded = await this.engine.load(config, this.output); // throws without touching `active`
    this.active = loaded;
    return loaded;
  }
}
