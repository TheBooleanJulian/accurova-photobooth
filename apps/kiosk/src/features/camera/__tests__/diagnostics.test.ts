import { describe, expect, it } from 'vitest';
import { deviceHint } from '../CameraCapabilities';
import { guessFacing, listCameras } from '../CameraDeviceRegistry';
import { evaluateQuality, probeStreamResolutions, selectProvider, toCaptureRecord } from '../CameraDiagnostics';
import { CameraManager } from '../CameraManager';
import type { CameraCapabilities } from '../types';
import { FakeTrack, fakeMediaDevices, jpeg } from './fakes';

const caps = (over: Partial<Record<'imagecapture' | 'stream' | 'native', boolean>>): CameraCapabilities[] => [
  { method: 'imagecapture', supported: over.imagecapture ?? false, automated: true, nativeStill: true },
  { method: 'stream', supported: over.stream ?? false, automated: true, nativeStill: false },
  { method: 'native', supported: over.native ?? false, automated: false, nativeStill: true },
];

describe('selectProvider', () => {
  it('prefers a real still photo when ImageCapture is supported', () => {
    expect(selectProvider(caps({ imagecapture: true, stream: true, native: true })).method).toBe('imagecapture');
  });

  it('falls back to stream frames and says so', () => {
    const selection = selectProvider(caps({ stream: true, native: true }));
    expect(selection.method).toBe('stream');
    expect(selection.reason).toMatch(/not native stills/);
  });

  it('never picks manual native capture automatically', () => {
    expect(selectProvider(caps({ native: true }))).toMatchObject({ method: null, overridden: false });
  });

  it('honours an administrator override when that provider works', () => {
    expect(selectProvider(caps({ imagecapture: true, stream: true }), 'stream')).toMatchObject({
      method: 'stream',
      overridden: true,
    });
    expect(selectProvider(caps({ stream: true, native: true }), 'native').method).toBe('native');
  });

  it('ignores an override that cannot work here and explains why', () => {
    const selection = selectProvider(caps({ stream: true }), 'imagecapture');
    expect(selection).toMatchObject({ method: 'stream', overridden: false });
    expect(selection.reason).toMatch(/Override "imagecapture" is not supported/);
  });
});

describe('evaluateQuality', () => {
  it.each([
    [4032, 3024, 'preferred'],
    [2250, 3000, 'preferred'],
    [2316, 3088, 'preferred'],
    [2592, 1944, 'acceptable'],
    [2000, 1500, 'acceptable'],
    [1920, 1080, 'below-minimum'],
    [1080, 1920, 'below-minimum'],
  ] as const)('%i×%i is %s', (w, h, verdict) => {
    expect(evaluateQuality(w, h)).toBe(verdict);
  });

  it('uses the configured policy', () => {
    expect(evaluateQuality(1920, 1080, { preferredLongestEdge: 1920, minimumLongestEdge: 1280 })).toBe('preferred');
  });
});

describe('toCaptureRecord', () => {
  it('marks only stream captures as non-native', () => {
    const base = { blob: jpeg(), width: 1920, height: 1080, mimeType: 'image/jpeg', fileSize: 4 };
    const stream = toCaptureRecord({ ...base, captureMethod: 'stream' }, 41.6, new Date(0));
    expect(stream).toEqual({
      captureMethod: 'stream',
      width: 1920,
      height: 1080,
      megapixels: 2.07,
      mimeType: 'image/jpeg',
      fileSize: 4,
      latencyMs: 42,
      capturedAt: '1970-01-01T00:00:00.000Z',
      nativeStill: false,
    });
    expect(toCaptureRecord({ ...base, captureMethod: 'imagecapture' }, 1).nativeStill).toBe(true);
  });
});

describe('probeStreamResolutions (simulated)', () => {
  it('records what each request really delivered and releases the camera', async () => {
    const tracks = [new FakeTrack({ width: 1920, height: 1440 }), new FakeTrack({ width: 1280, height: 720 })];
    const devices = fakeMediaDevices(...tracks);
    const manager = new CameraManager(
      () => devices,
      () => true,
    );
    const presets = [
      { label: 'big', width: 4032, height: 3024 },
      { label: 'small', width: 1280, height: 720 },
    ];
    const results = await probeStreamResolutions(manager, { facingMode: 'user' }, presets);
    expect(results).toEqual([
      { requested: 'big', width: 1920, height: 1440, frameRate: undefined },
      { requested: 'small', width: 1280, height: 720, frameRate: undefined },
    ]);
    expect(tracks.every((t) => t.stop.mock.calls.length === 1)).toBe(true);
    expect(manager.isLive()).toBe(false);
  });

  it('stops probing when there is no camera to probe', async () => {
    const manager = new CameraManager(
      () => fakeMediaDevices(),
      () => true,
    );
    const results = await probeStreamResolutions(manager, {});
    expect(results).toHaveLength(1);
    expect(results[0]?.error).toMatch(/^not-found/);
  });
});

describe('device helpers', () => {
  it('guesses facing from labels only as a hint', () => {
    expect(guessFacing('Front Camera')).toBe('user');
    expect(guessFacing('Back Dual Wide Camera')).toBe('environment');
    expect(guessFacing('')).toBeUndefined();
  });

  it('lists only video inputs and survives hidden labels', async () => {
    const enumerateDevices = async () =>
      [
        { kind: 'audioinput', deviceId: 'mic', label: 'Mic' },
        { kind: 'videoinput', deviceId: 'a', label: '' },
        { kind: 'videoinput', deviceId: 'b', label: 'Back Camera' },
      ] as MediaDeviceInfo[];
    const cameras = await listCameras({ enumerateDevices });
    expect(cameras.map((c) => c.deviceId)).toEqual(['a', 'b']);
    expect(cameras[0]?.label).toMatch(/hidden until permission/);
    expect(cameras[1]?.facing).toBe('environment');
    expect(await listCameras(undefined)).toEqual([]);
  });

  it('recognises iPadOS reporting itself as a Mac', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.6 Safari/605.1.15';
    expect(deviceHint(ua, 'MacIntel', 5)).toBe('iPad (heuristic), Safari 17.6');
    expect(deviceHint(ua, 'MacIntel', 0)).toMatch(/Desktop/);
  });
});
