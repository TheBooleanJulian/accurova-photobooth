import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  MAX_QR_LINK_LENGTH,
  decodeReport,
  describeReport,
  distinctProbes,
  encodeForQr,
  encodeReport,
  type Codec,
  type CompactReport,
} from '../compactReport';

// The browser uses CompressionStream; tests use zlib, which produces the same raw-deflate format.
const zlib: Codec = {
  compress: async (bytes) => new Uint8Array(deflateRawSync(bytes)),
  decompress: async (bytes) => new Uint8Array(inflateRawSync(bytes)),
};
const none: Codec = { compress: async () => null };

const sizes: Array<[number, number]> = [
  [4032, 3024],
  [3840, 2160],
  [3264, 2448],
  [3088, 2316],
  [2560, 1440],
  [1920, 1440],
  [1920, 1080],
  [1280, 720],
];

const report = (over: Partial<CompactReport> = {}): CompactReport => ({
  v: 1,
  at: '2026-11-12T05:30:00Z',
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
  deviceHint: 'iPad (heuristic), Safari 17.6',
  secure: true,
  imageCapture: false,
  nativeInput: true,
  wakeLock: true,
  standalone: false,
  permission: 'granted',
  screen: [834, 1112, 2],
  orientation: 'portrait-primary',
  encoders: ['jpeg', 'png'],
  cameras: ['Front Camera', 'Back Camera'],
  use: 'stream',
  streams: [
    { facing: 'user', label: 'Front Camera', track: [1920, 1080], frame: [1080, 1920], fps: 30, max: [1920, 1080] },
    { facing: 'environment', label: 'Back Camera', track: [3840, 2160], frame: [2160, 3840], fps: 30, max: null },
  ],
  probes: (['user', 'environment'] as const).flatMap((facing) =>
    sizes.map((requested) => ({
      facing,
      requested,
      delivered: (facing === 'user' ? [1920, 1080] : [3840, 2160]) as [number, number],
      fps: 30,
    })),
  ),
  captures: [
    { facing: 'user', method: 'stream', size: [1080, 1920], bytes: 412345, ms: 88, mime: 'jpeg', verdict: 'below-minimum' },
    { facing: 'environment', method: 'stream', size: [2160, 3840], bytes: 1512345, ms: 140, mime: 'jpeg', verdict: 'preferred' },
  ],
  events: Array.from({ length: 12 }, (_, i) => `05:29:${10 + i} Track event: unmute`),
  ...over,
});

describe('compact diagnostics report', () => {
  it('round-trips compressed and uncompressed', async () => {
    const compressed = await encodeReport(report(), zlib);
    expect(compressed[0]).toBe('z');
    expect(compressed).toMatch(/^[A-Za-z0-9_-]+$/); // safe in a URL fragment
    expect(await decodeReport(compressed, zlib)).toEqual(report());

    const plain = await encodeReport(report(), none);
    expect(plain[0]).toBe('j');
    expect(await decodeReport(plain, none)).toEqual(report());
    expect(compressed.length).toBeLessThan(plain.length / 2);
  });

  it('keeps non-ASCII text intact', async () => {
    const withLabel = report({ cameras: ['前置相机', 'Caméra arrière'] });
    expect((await decodeReport(await encodeReport(withLabel, zlib), zlib)).cameras).toEqual(withLabel.cameras);
  });

  it('fits a realistic two-camera report in a QR code', async () => {
    const link = await encodeForQr(report(), 'https://photobooth.accurova.com/admin/report', zlib);
    expect(link.startsWith('https://photobooth.accurova.com/admin/report#z')).toBe(true);
    expect(link.length).toBeLessThanOrEqual(MAX_QR_LINK_LENGTH);
    console.log('QR link length', link.length);
    const decoded = await decodeReport(link.split('#')[1]!, zlib);
    expect(decoded.captures).toHaveLength(2); // the numbers that matter are never dropped
    expect(decoded.streams).toHaveLength(2);
    // Lean form: one probe row per camera here, because every request delivered the same size.
    expect(decoded.probes.map((p) => [p.facing, p.requested[0], p.delivered[0]])).toEqual([
      ['user', 4032, 1920],
      ['environment', 4032, 3840],
    ]);
    expect(decoded.events).toEqual([]);
    expect(decoded.cameras).toEqual([]);
  });

  it('keeps the probe rows where the delivered size changes, and errors', () => {
    const rows = [
      { facing: 'user', requested: [4032, 3024], delivered: [1920, 1440], fps: 30 },
      { facing: 'user', requested: [3840, 2160], delivered: [1920, 1080], fps: 30 },
      { facing: 'user', requested: [3264, 2448], delivered: [1920, 1080], fps: 30 },
      { facing: 'user', requested: [1280, 720], delivered: [1280, 720], fps: 30 },
      { facing: 'environment', requested: [4032, 3024], delivered: [1280, 720], fps: 30 },
      { facing: 'environment', requested: [3840, 2160], delivered: [0, 0], fps: null, error: 'in-use' },
      { facing: 'environment', requested: [3264, 2448], delivered: [1280, 720], fps: 30 },
    ] as CompactReport['probes'];
    expect(distinctProbes(rows).map((p) => p.requested[0])).toEqual([4032, 3840, 1280, 4032, 3840, 3264]);
  });

  it('drops the probe, never streams or captures, when compression is unavailable', async () => {
    const link = await encodeForQr(report(), 'https://photobooth.accurova.com/admin/report', none);
    const decoded = await decodeReport(link.split('#')[1]!, none);
    expect(decoded.probes).toEqual([]);
    expect(decoded.captures).toHaveLength(2);
    expect(decoded.streams).toHaveLength(2);
  });

  it('rejects links that are not reports, are damaged, or are from another version', async () => {
    await expect(decodeReport('hello')).rejects.toThrow(/not a diagnostics report/);
    await expect(decodeReport('z!!!', zlib)).rejects.toThrow(/damaged/);
    const good = await encodeReport(report(), zlib);
    await expect(decodeReport(good.slice(0, 40), zlib)).rejects.toThrow(/damaged/);
    const future = await encodeReport({ ...report(), v: 2 } as unknown as CompactReport, none);
    await expect(decodeReport(future, none)).rejects.toThrow(/different version/);
  });

  it('describes the report in plain text for pasting', () => {
    const text = describeReport(report());
    expect(text).toContain('Kiosk would use: stream');
    expect(text).toContain('ImageCapture: no');
    expect(text).toContain('Front (Front Camera): track 1920×1080, frame 1080×1920, 30 fps, max 1920×1080');
    expect(text).toContain('Rear stream: 2160×3840, 1477 KB, 140 ms, jpeg, preferred');
    expect(text).toContain('Front 4032×3024 → 1920×1080 @30fps');
    expect(describeReport(report({ probes: [{ facing: 'user', requested: [4032, 3024], delivered: [0, 0], fps: null, error: 'not-found' }] }))).toContain(
      'Front 4032×3024 → not-found',
    );
  });
});
