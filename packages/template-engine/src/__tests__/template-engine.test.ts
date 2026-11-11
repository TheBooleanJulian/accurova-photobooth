import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { TemplateLoadError, TemplateRegistry, localeSchema, registryIndexSchema, templateSchema } from '../index';

const templatesDir = join(dirname(fileURLToPath(import.meta.url)), '../../../../templates');
const readJson = (...parts: string[]) => JSON.parse(readFileSync(join(templatesDir, ...parts), 'utf8')) as unknown;

/** Serves the real /templates folder to the registry, like the static host does. */
const diskFetcher = async (url: string) => {
  const file = join(templatesDir, url.replace(/^\/templates\//, ''));
  if (!existsSync(file)) throw new TemplateLoadError('not-found', `${url} was not found`);
  return JSON.parse(readFileSync(file, 'utf8')) as unknown;
};

const valid = () => structuredClone(readJson('little-red-dot-tours', 'template.json')) as Record<string, any>;

describe('templates on disk', () => {
  const index = registryIndexSchema.parse(readJson('index.json'));

  it('registers every template folder', () => {
    const folders = readdirSync(templatesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    expect(index.templates.map((t) => t.id).sort()).toEqual(folders.sort());
  });

  it.each(index.templates.map((t) => t.id))('%s is valid and all its assets exist', (id) => {
    const template = templateSchema.parse(readJson(id, 'template.json'));
    expect(template.id).toBe(id);

    const assets = [
      template.branding.logo,
      ...template.backgrounds.flatMap((b) => [b.image, b.thumbnail]),
      ...template.frames.flatMap((f) => [f.asset, ...f.sponsorSlots.map((s) => s.asset)]),
      ...template.locales.map((l) => `locales/${l}.json`),
    ];
    const missing = assets.filter((a) => !existsSync(join(templatesDir, id, a)));
    expect(missing).toEqual([]);

    // Every locale must define the same keys as the default locale.
    const keys = (l: string) => Object.keys(localeSchema.parse(readJson(id, 'locales', `${l}.json`))).sort();
    for (const locale of template.locales) expect(keys(locale)).toEqual(keys(template.defaultLocale));

    // Sponsor boxes and the photo window must stay inside the frame.
    for (const frame of template.frames) {
      for (const box of [frame.photoWindow, ...frame.sponsorSlots.map((s) => s.box)]) {
        expect(box.x + box.width).toBeLessThanOrEqual(1);
        expect(box.y + box.height).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('templateSchema', () => {
  const issues = (data: unknown) => {
    const result = templateSchema.safeParse(data);
    return result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  };

  it('applies defaults', () => {
    const t = valid();
    delete t.frames[0].placeholder;
    delete t.output.jpegQuality;
    const parsed = templateSchema.parse(t);
    expect(parsed.frames[0]?.placeholder).toBe(false);
    expect(parsed.output.jpegQuality).toBe(0.93);
  });

  it.each(['/etc/passwd', '../other/frame.svg', 'https://example.com/a.png', 'a\\b.png'])(
    'rejects asset path %s',
    (path) => {
      const t = valid();
      t.frames[0].asset = path;
      expect(issues(t).join()).toMatch(/frames\.0\.asset/);
    },
  );

  it('rejects duplicate ids, a dangling default frame and an unlisted default locale', () => {
    const t = valid();
    t.backgrounds[1].id = t.backgrounds[0].id;
    t.defaultFrameId = 'missing-frame';
    t.defaultLocale = 'fr';
    const found = issues(t).join('\n');
    expect(found).toMatch(/duplicate background id/);
    expect(found).toMatch(/no frame with id "missing-frame"/);
    expect(found).toMatch(/defaultLocale must be listed/);
  });

  it('rejects out-of-range composition and an impossible quality policy', () => {
    const t = valid();
    t.backgrounds[0].composition.subjectAnchorY = 1.4;
    t.capture.quality.minimumLongestEdge = 5000;
    const found = issues(t).join('\n');
    expect(found).toMatch(/subjectAnchorY/);
    expect(found).toMatch(/minimumLongestEdge exceeds/);
  });

  it('requires at least one enabled background', () => {
    const t = valid();
    t.backgrounds.forEach((b: { enabled: boolean }) => (b.enabled = false));
    expect(issues(t).join()).toMatch(/at least one background must be enabled/);
  });
});

describe('TemplateRegistry', () => {
  const registry = (fetchJson = diskFetcher) => new TemplateRegistry({ baseUrl: '/templates/', fetchJson });

  it('loads a template and its locales at runtime', async () => {
    const r = registry();
    const template = await r.load('little-red-dot-tours');
    expect(template.name).toBe('Little Red Dot Tours');
    expect((await r.loadLocale(template.id, 'zh-CN'))['welcome.start']).toBe('开始');
    expect(r.assetUrl(template.id, template.frames[0]!.asset)).toBe(
      '/templates/little-red-dot-tours/frames/lrdt-standard-frame.svg',
    );
  });

  it('fetches each file once until invalidated', async () => {
    const fetchJson = vi.fn(diskFetcher);
    const r = registry(fetchJson);
    await r.load('little-red-dot-tours');
    await r.load('little-red-dot-tours');
    expect(fetchJson).toHaveBeenCalledTimes(2);
    r.invalidate();
    await r.load('little-red-dot-tours');
    expect(fetchJson).toHaveBeenCalledTimes(4);
  });

  it('adds a new template without any code change', async () => {
    const extra = { ...valid(), id: 'hotel-guest-experience', name: 'Hotel' };
    const r = registry(async (url) => {
      if (url.endsWith('/index.json')) {
        return { schemaVersion: 1, templates: [{ id: 'hotel-guest-experience', name: 'Hotel', enabled: true }] };
      }
      if (url.endsWith('/hotel-guest-experience/template.json')) return extra;
      throw new TemplateLoadError('not-found', url);
    });
    expect((await r.load('hotel-guest-experience')).name).toBe('Hotel');
  });

  it('reports unknown, disabled, invalid and mismatched templates distinctly', async () => {
    await expect(registry().load('nope')).rejects.toMatchObject({ code: 'not-found' });
    await expect(registry().loadLocale('little-red-dot-tours', 'fr')).rejects.toMatchObject({ code: 'not-found' });

    const index = (enabled: boolean) => ({ schemaVersion: 1, templates: [{ id: 'x', name: 'X', enabled }] });
    await expect(registry(async () => index(false)).load('x')).rejects.toMatchObject({ code: 'disabled' });

    const broken = registry(async (url) => (url.endsWith('index.json') ? index(true) : { id: 'x' }));
    const error = await broken.load('x').catch((e: TemplateLoadError) => e);
    expect(error).toMatchObject({ code: 'invalid' });
    expect((error as TemplateLoadError).issues.length).toBeGreaterThan(0);

    const mismatched = registry(async (url) => (url.endsWith('index.json') ? index(true) : valid()));
    await expect(mismatched.load('x')).rejects.toThrow(/declares id "little-red-dot-tours"/);
  });

  it('retries after a failed load instead of caching the failure', async () => {
    let fail = true;
    const r = registry(async (url) => {
      if (fail) throw new TemplateLoadError('network', 'offline');
      return diskFetcher(url);
    });
    await expect(r.load('little-red-dot-tours')).rejects.toMatchObject({ code: 'network' });
    fail = false;
    expect((await r.load('little-red-dot-tours')).id).toBe('little-red-dot-tours');
  });
});
