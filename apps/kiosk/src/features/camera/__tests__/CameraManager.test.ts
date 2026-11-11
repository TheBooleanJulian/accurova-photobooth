import { describe, expect, it, vi } from 'vitest';
import { CameraManager, buildConstraints } from '../CameraManager';
import { FakeTrack, fakeMediaDevices, fakeStream } from './fakes';

const secure = () => true;

describe('buildConstraints', () => {
  it('uses ideal values so the browser can fall back instead of failing', () => {
    expect(buildConstraints({ facingMode: 'user', width: 4032, height: 3024 })).toEqual({
      video: { facingMode: { ideal: 'user' }, width: { ideal: 4032 }, height: { ideal: 3024 } },
      audio: false,
    });
  });

  it('prefers an explicit device over a facing mode', () => {
    const { video } = buildConstraints({ facingMode: 'user', deviceId: 'abc' });
    expect(video).toEqual({ deviceId: { exact: 'abc' } });
  });
});

describe('CameraManager (simulated)', () => {
  it('reports the delivered settings, not the requested ones', async () => {
    const devices = fakeMediaDevices(new FakeTrack({ width: 1920, height: 1080, frameRate: 30 }));
    const manager = new CameraManager(() => devices, secure);
    const info = await manager.start({ facingMode: 'user', width: 4032, height: 3024 });
    expect(info.width).toBe(1920);
    expect(info.height).toBe(1080);
    expect(info.requested.width).toBe(4032);
    expect(info.maxWidth).toBe(1920);
  });

  it('tolerates browsers without getCapabilities', async () => {
    const devices = fakeMediaDevices(new FakeTrack(undefined, 'cam', null));
    const info = await new CameraManager(() => devices, secure).start();
    expect(info.maxWidth).toBeUndefined();
  });

  it('stops every track on stop() and is safe to call twice', async () => {
    const track = new FakeTrack();
    const manager = new CameraManager(() => fakeMediaDevices(track), secure);
    await manager.start();
    manager.stop();
    manager.stop();
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(manager.getStream()).toBeNull();
    expect(manager.isLive()).toBe(false);
  });

  it('releases the previous stream when started again', async () => {
    const first = new FakeTrack();
    const second = new FakeTrack();
    const devices = fakeMediaDevices(first, second);
    const manager = new CameraManager(() => devices, secure);
    await manager.start();
    await manager.start();
    expect(first.stop).toHaveBeenCalled();
    expect(second.stop).not.toHaveBeenCalled();
    expect(manager.getTrack()).toBe(second);
  });

  it('discards a stream that arrives after it was superseded', async () => {
    const late = new FakeTrack();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const getUserMedia = vi
      .fn()
      .mockImplementationOnce(async () => {
        await gate;
        return fakeStream(late);
      })
      .mockImplementationOnce(async () => fakeStream(new FakeTrack()));
    const manager = new CameraManager(() => ({ getUserMedia }), secure);

    const slow = manager.start();
    await manager.start();
    release();
    await expect(slow).rejects.toMatchObject({ code: 'interrupted' });
    expect(late.stop).toHaveBeenCalled();
    expect(manager.isLive()).toBe(true);
  });

  it.each([
    ['NotAllowedError', 'permission-denied'],
    ['NotFoundError', 'not-found'],
    ['NotReadableError', 'in-use'],
    ['OverconstrainedError', 'overconstrained'],
    ['SomethingElse', 'unknown'],
  ])('maps %s to %s', async (name, code) => {
    const getUserMedia = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { name }));
    await expect(new CameraManager(() => ({ getUserMedia }), secure).start()).rejects.toMatchObject({ code });
  });

  it('distinguishes an insecure page from an unsupported browser', async () => {
    await expect(new CameraManager(() => undefined, () => false).start()).rejects.toMatchObject({
      code: 'insecure-context',
    });
    await expect(new CameraManager(() => undefined, secure).start()).rejects.toMatchObject({ code: 'unsupported' });
  });

  it('forwards track events and can restart with the last request', async () => {
    const first = new FakeTrack();
    const second = new FakeTrack();
    const devices = fakeMediaDevices(first, second);
    const manager = new CameraManager(() => devices, secure);
    const events: string[] = [];
    manager.onEvent((e) => events.push(e));

    await manager.start({ facingMode: 'environment', width: 1280 });
    first.readyState = 'ended';
    first.dispatchEvent(new Event('ended'));
    expect(events).toEqual(['ended']);
    expect(manager.isLive()).toBe(false);

    await manager.restart();
    expect(manager.isLive()).toBe(true);
    expect(devices.getUserMedia.mock.calls[1]?.[0]).toEqual(devices.getUserMedia.mock.calls[0]?.[0]);
  });

  it('refuses to restart before a first start', () => {
    expect(() => new CameraManager(() => fakeMediaDevices(), secure).restart()).toThrow(/not been started/);
  });
});
