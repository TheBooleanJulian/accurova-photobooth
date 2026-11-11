import { describe, expect, it, vi } from 'vitest';
import { CameraManager } from '../CameraManager';
import { ImageCaptureProvider, type ImageCaptureLike } from '../ImageCaptureProvider';
import { NativeCaptureProvider } from '../NativeCaptureProvider';
import { SimulatedCaptureProvider } from '../SimulatedCaptureProvider';
import { StreamCaptureProvider } from '../StreamCaptureProvider';
import { CameraError } from '../types';
import { FakeTrack, fakeMediaDevices, jpeg } from './fakes';

async function liveManager(...tracks: FakeTrack[]) {
  const devices = fakeMediaDevices(...(tracks.length ? tracks : [new FakeTrack()]));
  const manager = new CameraManager(
    () => devices,
    () => true,
  );
  await manager.start();
  return manager;
}

describe('StreamCaptureProvider (simulated)', () => {
  it('captures at the video frame size and never claims to be a native still', async () => {
    const manager = await liveManager();
    const encode = vi.fn(async () => jpeg(1234));
    // Portrait frame from a landscape track: the <video> is the source of truth.
    const video = { videoWidth: 1080, videoHeight: 1920, readyState: 4 };
    const provider = new StreamCaptureProvider(manager, () => video, { encode });

    const image = await provider.capture();
    expect(image).toMatchObject({
      width: 1080,
      height: 1920,
      captureMethod: 'stream',
      mimeType: 'image/jpeg',
      fileSize: 1234,
    });
    expect(image.metadata?.nativeStill).toBe(false);
    expect(encode).toHaveBeenCalledWith(video, 'image/jpeg', 0.95);

    const caps = await provider.getCapabilities();
    expect(caps).toMatchObject({ supported: true, automated: true, nativeStill: false });
  });

  it('reports the type the browser actually produced', async () => {
    const manager = await liveManager();
    const png = new Blob(['x'], { type: 'image/png' });
    const provider = new StreamCaptureProvider(manager, () => ({ videoWidth: 2, videoHeight: 2, readyState: 4 }), {
      mimeType: 'image/webp',
      encode: async () => png,
    });
    expect((await provider.capture()).mimeType).toBe('image/png');
  });

  it('refuses to capture without a live stream or a decoded frame', async () => {
    const manager = await liveManager();
    const encode = vi.fn();
    const noFrame = new StreamCaptureProvider(manager, () => ({ videoWidth: 0, videoHeight: 0, readyState: 1 }), {
      encode,
    });
    await expect(noFrame.capture()).rejects.toMatchObject({ code: 'not-ready' });

    manager.stop();
    const stopped = new StreamCaptureProvider(manager, () => ({ videoWidth: 10, videoHeight: 10, readyState: 4 }), {
      encode,
    });
    await expect(stopped.capture()).rejects.toMatchObject({ code: 'not-ready' });
    expect((await stopped.getCapabilities()).supported).toBe(false);
    expect(encode).not.toHaveBeenCalled();
  });
});

describe('ImageCaptureProvider (simulated)', () => {
  const measure = async () => ({ width: 3088, height: 2316 });

  function fakeImageCapture(impl: Partial<ImageCaptureLike> = {}) {
    const takePhoto = vi.fn(impl.takePhoto ?? (async () => jpeg(9000)));
    const instances: MediaStreamTrack[] = [];
    class Fake implements ImageCaptureLike {
      constructor(track: MediaStreamTrack) {
        instances.push(track);
      }
      takePhoto = takePhoto;
      getPhotoCapabilities =
        impl.getPhotoCapabilities ?? (async () => ({ imageWidth: { max: 3088 }, imageHeight: { max: 2316 } }));
    }
    return { Fake, takePhoto, instances };
  }

  it('is unsupported when the browser has no ImageCapture', async () => {
    const provider = new ImageCaptureProvider(await liveManager(), { ImageCapture: undefined, measure });
    await provider.initialize();
    expect(await provider.getCapabilities()).toMatchObject({ supported: false, nativeStill: true });
    await expect(provider.capture()).rejects.toMatchObject({ code: 'unsupported' });
  });

  it('takes a still at the largest reported photo size and measures the real file', async () => {
    const { Fake, takePhoto } = fakeImageCapture();
    const provider = new ImageCaptureProvider(await liveManager(), { ImageCapture: Fake, measure });
    await provider.initialize();

    expect(await provider.getCapabilities()).toMatchObject({ supported: true, maxWidth: 3088, maxHeight: 2316 });
    const image = await provider.capture();
    expect(takePhoto).toHaveBeenCalledWith({ imageWidth: 3088, imageHeight: 2316 });
    expect(image).toMatchObject({ width: 3088, height: 2316, captureMethod: 'imagecapture', fileSize: 9000 });
    expect(image.metadata?.nativeStill).toBe(true);
  });

  it('retries with browser defaults when explicit photo sizes are rejected', async () => {
    const takePhoto = vi.fn().mockRejectedValueOnce(new Error('bad settings')).mockResolvedValueOnce(jpeg());
    const { Fake } = fakeImageCapture({ takePhoto });
    const provider = new ImageCaptureProvider(await liveManager(), { ImageCapture: Fake, measure });
    const image = await provider.capture();
    expect(takePhoto).toHaveBeenCalledTimes(2);
    expect(takePhoto.mock.calls[1]).toEqual([]);
    expect(image.metadata?.requestedMaxPhotoSize).toBe(false);
  });

  it('surfaces a failure instead of silently falling back to a stream frame', async () => {
    const { Fake } = fakeImageCapture({
      takePhoto: async () => {
        throw new Error('camera busy');
      },
      getPhotoCapabilities: async () => ({}),
    });
    const provider = new ImageCaptureProvider(await liveManager(), { ImageCapture: Fake, measure });
    await expect(provider.capture()).rejects.toThrow(/takePhoto\(\) failed: camera busy/);
  });

  it('rebinds to the new track after the stream restarts', async () => {
    const first = new FakeTrack();
    const second = new FakeTrack();
    const manager = await liveManager(first, second);
    const { Fake, instances } = fakeImageCapture();
    const provider = new ImageCaptureProvider(manager, { ImageCapture: Fake, measure });
    await provider.initialize();
    await manager.restart();
    await provider.capture();
    expect(instances).toEqual([first, second]);
  });
});

describe('NativeCaptureProvider (simulated)', () => {
  it('returns the picked file untouched and is never automated', async () => {
    const file = new File([new Uint8Array(5000)], 'IMG_0001.jpg', { type: 'image/jpeg' });
    const pick = vi.fn(async () => file);
    const provider = new NativeCaptureProvider({
      facing: 'user',
      pick,
      measure: async () => ({ width: 2316, height: 3088 }),
    });
    const image = await provider.capture();
    expect(pick).toHaveBeenCalledWith('user');
    expect(image.blob).toBe(file);
    expect(image).toMatchObject({ width: 2316, height: 3088, captureMethod: 'native', fileSize: 5000 });
    expect((await provider.getCapabilities()).automated).toBe(false);
  });

  it('propagates cancellation', async () => {
    const provider = new NativeCaptureProvider({
      pick: async () => {
        throw new CameraError('cancelled', 'dismissed');
      },
    });
    await expect(provider.capture()).rejects.toMatchObject({ code: 'cancelled' });
  });
});

describe('SimulatedCaptureProvider', () => {
  it('tags its output as simulated', async () => {
    const provider = new SimulatedCaptureProvider({ width: 3000, height: 4000 });
    const image = await provider.capture();
    expect(image.metadata).toEqual({ simulated: true });
    expect(image.width).toBe(3000);
    await provider.dispose();
    expect(provider.disposed).toBe(true);
  });
});
