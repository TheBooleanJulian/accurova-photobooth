import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Drawable } from '@accurova/image-engine';
import { templateSchema, type FrameConfig } from '@accurova/template-engine';
import type { composeFinal } from '@accurova/image-engine';
import { describe, expect, it, vi } from 'vitest';
import { resolveBackground, selectableBackgrounds, placeholderBackgrounds } from '../../backgrounds/BackgroundLibrary';
import { renderFinalImage, templateOutputSize } from '../../compositing/Compositor';
import { sizeSvgForRaster, type FrameAdapter } from '../adapters/FrameAdapters';
import { FrameEngine, FrameError, FrameRegistry } from '../FrameEngine';
import {
  validateFrameGeometry,
  validatePng,
  validateSvg,
  validateWindowTransparency,
  type PixelReader,
} from '../FrameValidator';

const templateDir = join(dirname(fileURLToPath(import.meta.url)), '../../../../../../templates/little-red-dot-tours');
const template = templateSchema.parse(JSON.parse(readFileSync(join(templateDir, 'template.json'), 'utf8')));
const frame = template.frames[0]!;
const frameSvg = readFileSync(join(templateDir, frame.asset), 'utf8');
const output = { width: 1080, height: 1920 };

const svg = (inner: string, attrs = 'viewBox="0 0 1080 1920"') =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ${attrs}>${inner}</svg>`;

describe('validateSvg', () => {
  it('accepts the shipped placeholder frame and warns about live text', () => {
    const result = validateSvg(frameSvg);
    expect(result.errors).toEqual([]);
    expect(result.size).toEqual({ width: 1080, height: 1920 });
    expect(result.warnings.join()).toMatch(/live text/);
  });

  it.each([
    ['<script>alert(1)</script>', /<script> elements/],
    ['<foreignObject><div/></foreignObject>', /<foreignObject> elements/],
    ['<rect onclick="x()" width="1" height="1"/>', /Event handler attribute "onclick"/],
    ['<image href="https://evil.example/a.png"/>', /External reference/],
    ['<use xlink:href="http://evil.example/x.svg#a"/>', /External reference/],
    ['<a href="javascript:alert(1)"><rect/></a>', /External reference/],
    ['<style>@import url(https://evil.example/x.css);</style>', /Stylesheets may not load/],
    ['<rect style="fill:url(https://evil.example/p)" />', /Inline styles may not load/],
  ])('rejects %s', (inner, message) => {
    const result = validateSvg(svg(inner));
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(message);
  });

  it('allows internal references and embedded images', () => {
    const inner =
      '<defs><pattern id="p" width="4" height="4"><rect width="2" height="2"/></pattern></defs>' +
      '<rect fill="url(#p)" width="10" height="10"/><use href="#p"/><image href="data:image/png;base64,AAAA"/>';
    expect(validateSvg(svg(inner)).errors).toEqual([]);
  });

  it('needs a size and rejects non-SVG input', () => {
    expect(validateSvg(svg('<rect/>', '')).errors.join()).toMatch(/needs a viewBox/);
    expect(validateSvg(svg('<rect/>', 'width="1080" height="1920"')).warnings.join()).toMatch(/no viewBox/);
    expect(validateSvg('<html><body/></html>').errors).toEqual(['The file is not a valid SVG document.']);
    expect(validateSvg('not xml at all <').ok).toBe(false);
  });
});

function png(colourType: number, extraChunk?: string, width = 1080, height = 1920): Uint8Array {
  const chunk = (type: string, data: number[]) => {
    const out = new Uint8Array(12 + data.length);
    new DataView(out.buffer).setUint32(0, data.length);
    out.set([...type].map((c) => c.charCodeAt(0)), 4);
    out.set(data, 8);
    return out;
  };
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = colourType;
  const parts = [
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', [...ihdr]),
    ...(extraChunk ? [chunk(extraChunk, [0])] : []),
    chunk('IDAT', [0]),
  ];
  const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((offset, p) => (bytes.set(p, offset), offset + p.length), 0);
  return bytes;
}

describe('validatePng', () => {
  it('accepts RGBA, grey+alpha and palette-with-transparency PNGs', () => {
    expect(validatePng(png(6))).toMatchObject({ ok: true, size: { width: 1080, height: 1920 } });
    expect(validatePng(png(4)).ok).toBe(true);
    expect(validatePng(png(3, 'tRNS')).ok).toBe(true);
  });

  it('rejects opaque PNGs and non-PNG files', () => {
    expect(validatePng(png(2)).errors.join()).toMatch(/no transparency/);
    expect(validatePng(png(3)).errors.join()).toMatch(/no transparency/);
    expect(validatePng(new Uint8Array(100)).errors).toEqual(['The file is not a PNG image.']);
  });
});

describe('frame geometry and window transparency', () => {
  it('checks the artwork against the configured aspect ratio and boxes', () => {
    expect(validateFrameGeometry(frame, { width: 1080, height: 1920 }).ok).toBe(true);
    expect(validateFrameGeometry(frame, { width: 2160, height: 3840 }).ok).toBe(true);
    expect(validateFrameGeometry(frame, { width: 1920, height: 1080 }).errors.join()).toMatch(/configured as 9:16/);
    const broken: FrameConfig = { ...frame, photoWindow: { x: 0.5, y: 0.5, width: 0.7, height: 0.2 } };
    expect(validateFrameGeometry(broken, output).errors.join()).toMatch(/photo window extends outside/);
  });

  const window = { x: 44, y: 220, width: 992, height: 1430 };
  const reader = (alpha: (x: number, y: number) => number): PixelReader => ({ alphaAt: alpha });
  const inWindow = (x: number, y: number) => x >= 44 && x < 1036 && y >= 220 && y < 1650;

  it('passes when the window is clear and the border is drawn', () => {
    const good = reader((x, y) => (inWindow(x, y) ? 0 : 255));
    expect(validateWindowTransparency(good, window, output)).toEqual({ ok: true, errors: [], warnings: [] });
  });

  it('fails when artwork covers the photo window', () => {
    const shifted = reader((x, y) => (inWindow(x, y - 400) ? 0 : 255)); // window drawn 400px lower than configured
    expect(validateWindowTransparency(shifted, window, output).errors.join()).toMatch(/not transparent across/);
    expect(validateWindowTransparency(reader(() => 255), window, output).ok).toBe(false);
  });

  it('warns about artwork with no border at all', () => {
    expect(validateWindowTransparency(reader(() => 0), window, output).warnings.join()).toMatch(/every corner/);
  });
});

describe('sizeSvgForRaster', () => {
  it('sets output pixel dimensions and keeps the viewBox', () => {
    const sized = sizeSvgForRaster(frameSvg, { width: 2160, height: 3840 });
    expect(sized).toMatch(/width="2160"/);
    expect(sized).toMatch(/height="3840"/);
    expect(sized).toMatch(/viewBox="0 0 1080 1920"/);
  });
});

const drawable = (name: string, width = 1080, height = 1920): Drawable<CanvasImageSource> => ({
  source: name as unknown as CanvasImageSource,
  width,
  height,
});
const clearWindow: PixelReader = {
  alphaAt: (x, y) => (x >= 44 && x < 1036 && y >= 220 && y < 1650 ? 0 : 255),
};
const okAdapter = (format: 'svg' | 'png' = 'svg'): FrameAdapter => ({
  format,
  load: vi.fn(async () => ({ image: drawable('FRAME'), validation: { ok: true, errors: [], warnings: ['live text'] } })),
});

function engine(over: Partial<ConstructorParameters<typeof FrameEngine>[1]> = {}) {
  return new FrameEngine((path) => `/templates/lrdt/${path}`, {
    adapters: [okAdapter()],
    loadSponsor: async (url) => drawable(url, 340, 120),
    readPixels: () => clearWindow,
    ...over,
  });
}

describe('FrameEngine (simulated assets)', () => {
  it('loads the frame, its pixel window and its sponsor slots', async () => {
    const loaded = await engine().load(frame, output);
    expect(loaded.window).toEqual({ x: 44, y: 220, width: 992, height: 1430 });
    expect(loaded.sponsors.map((s) => [s.id, s.align, s.box.x])).toEqual([
      ['sponsor-primary', 'left', 90],
      ['sponsor-secondary', 'right', 650],
    ]);
    expect(loaded.sponsors[0]!.image.source).toBe('/templates/lrdt/sponsors/primary-placeholder.svg');
    expect(loaded.warnings).toEqual(['live text']);
  });

  it('honours disabled slots and showSponsors', async () => {
    const oneOff: FrameConfig = {
      ...frame,
      sponsorSlots: frame.sponsorSlots.map((s, i) => ({ ...s, enabled: i === 0 })),
    };
    expect((await engine().load(oneOff, output)).sponsors.map((s) => s.id)).toEqual(['sponsor-primary']);
    const hidden: FrameConfig = { ...frame, branding: { ...frame.branding, showSponsors: false } };
    expect((await engine().load(hidden, output)).sponsors).toEqual([]);
  });

  it('leaves out a logo that fails to load instead of failing the frame', async () => {
    const loaded = await engine({
      loadSponsor: async (url) => {
        if (url.includes('secondary')) throw new Error('404');
        return drawable(url, 340, 120);
      },
    }).load(frame, output);
    expect(loaded.sponsors.map((s) => s.id)).toEqual(['sponsor-primary']);
    expect(loaded.warnings.join()).toMatch(/"sponsor-secondary" could not be loaded/);
  });

  it('refuses unsafe artwork, wrong geometry, a blocked window and unknown formats', async () => {
    const unsafe: FrameAdapter = {
      format: 'svg',
      load: async () => ({ validation: { ok: false, errors: ['<script> elements are not allowed.'], warnings: [] } }),
    };
    await expect(engine({ adapters: [unsafe] }).load(frame, output)).rejects.toThrow(/<script>/);

    const landscape: FrameAdapter = {
      format: 'svg',
      load: async () => ({ image: drawable('F', 1920, 1080), validation: { ok: true, errors: [], warnings: [] } }),
    };
    await expect(engine({ adapters: [landscape] }).load(frame, output)).rejects.toThrow(/configured as 9:16/);

    await expect(engine({ readPixels: () => ({ alphaAt: () => 255 }) }).load(frame, output)).rejects.toBeInstanceOf(
      FrameError,
    );
    await expect(engine().load({ ...frame, format: 'png' }, output)).rejects.toThrow(/No adapter/);
  });
});

describe('FrameRegistry', () => {
  const second: FrameConfig = { ...frame, id: 'festive-frame', name: 'Festive' };
  const frames = { frames: [frame, second], defaultFrameId: frame.id };

  it('activates the default frame and switches on request', async () => {
    const registry = new FrameRegistry(frames, engine(), output);
    expect(registry.current()).toBeNull();
    expect((await registry.activate()).config.id).toBe(frame.id);
    expect((await registry.activate('festive-frame')).config.id).toBe('festive-frame');
    expect(registry.list()).toHaveLength(2);
  });

  it('keeps the previous working frame when a replacement fails', async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce({ config: frame })
      .mockRejectedValueOnce(new FrameError('festive-frame', { ok: false, errors: ['bad'], warnings: [] }));
    const registry = new FrameRegistry(frames, { load }, output);
    await registry.activate();
    await expect(registry.activate('festive-frame')).rejects.toBeInstanceOf(FrameError);
    expect(registry.current()?.config.id).toBe(frame.id);
    await expect(registry.activate('nope')).rejects.toThrow(/No such frame/);
    expect(registry.current()?.config.id).toBe(frame.id);
  });
});

describe('backgrounds', () => {
  it('offers enabled backgrounds in display order and resolves selections safely', () => {
    const shuffled = {
      backgrounds: [
        { ...template.backgrounds[2]!, displayOrder: 1 },
        { ...template.backgrounds[0]!, displayOrder: 3, enabled: false },
        { ...template.backgrounds[1]!, displayOrder: 0, placeholder: false },
      ],
    };
    expect(selectableBackgrounds(shuffled).map((b) => b.id)).toEqual(['gardens-by-the-bay', 'merlion-marina-bay']);
    expect(resolveBackground(shuffled, 'merlion-marina-bay').id).toBe('merlion-marina-bay');
    expect(resolveBackground(shuffled, 'marina-bay-sands').id).toBe('gardens-by-the-bay'); // disabled -> fallback
    expect(resolveBackground(shuffled, null).id).toBe('gardens-by-the-bay');
    expect(placeholderBackgrounds(shuffled).map((b) => b.id)).toEqual(['merlion-marina-bay']);
    expect(() => resolveBackground({ backgrounds: [] }, 'x')).toThrow(/no enabled background/);
  });
});

describe('renderFinalImage', () => {
  it('feeds the template settings, the chosen background and the frame into the compositor', async () => {
    const loaded = await engine().load(frame, output);
    const compose = vi.fn<typeof composeFinal>(async () => ({
      blob: new Blob(),
      width: 1080,
      height: 1920,
      report: {} as never,
    }));
    const background = template.backgrounds[3]!;
    await renderFinalImage(
      { template, background, frame: loaded, foreground: drawable('FG', 1500, 2000), subjectBox: [1, 2, 3, 4] },
      { assetUrl: (p) => `/t/${p}`, loadBackground: async (url) => drawable(url), compose },
    );
    expect(templateOutputSize(template)).toEqual(output);
    const [input, options] = compose.mock.calls[0]!;
    expect(input).toMatchObject({
      output,
      window: loaded.window,
      composition: background.composition,
      subjectBox: [1, 2, 3, 4],
      shadowOpacity: 0.28,
    });
    expect(input.background.source).toBe(`/t/${background.image}`);
    expect(input.frame.source).toBe('FRAME');
    expect(input.sponsors).toHaveLength(2);
    expect(options).toEqual({ jpegQuality: 0.93 });
  });
});
