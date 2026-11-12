import { describe, expect, it, vi } from 'vitest';
import { deliveryLink, deliveryQrSvg } from '../../delivery/qr';
import { IdleTimer, watchActivity } from '../IdleTimer';
import { WakeLockController } from '../WakeLock';

function fakeScheduler() {
  let pending: { callback: () => void; ms: number } | null = null;
  return {
    setTimeout: vi.fn((callback: () => void, ms: number) => (pending = { callback, ms })),
    clearTimeout: vi.fn(() => (pending = null)),
    fire: () => {
      const due = pending;
      pending = null;
      due?.callback();
    },
    get armed() {
      return pending !== null;
    },
  };
}

describe('IdleTimer', () => {
  it('fires once after the timeout and restarts on activity', () => {
    const scheduler = fakeScheduler();
    const onIdle = vi.fn();
    const timer = new IdleTimer(60_000, onIdle, scheduler);
    timer.start();
    expect(scheduler.setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 60_000);
    timer.touch();
    expect(scheduler.setTimeout).toHaveBeenCalledTimes(2);
    scheduler.fire();
    expect(onIdle).toHaveBeenCalledTimes(1);
    expect(timer.active).toBe(false);
    timer.touch(); // no longer running: activity does not re-arm it
    expect(scheduler.armed).toBe(false);
  });

  it('does not count down while paused or stopped', () => {
    const scheduler = fakeScheduler();
    const timer = new IdleTimer(1000, vi.fn(), scheduler);
    timer.start();
    timer.pause();
    expect(scheduler.armed).toBe(false);
    timer.touch();
    expect(scheduler.armed).toBe(false);
    timer.resume();
    expect(scheduler.armed).toBe(true);
    timer.stop();
    expect(scheduler.armed).toBe(false);
  });

  it('treats touches, pointer presses and keys as activity', () => {
    const scheduler = fakeScheduler();
    const timer = new IdleTimer(1000, vi.fn(), scheduler);
    timer.start();
    const target = new EventTarget();
    const detach = watchActivity(target, timer);
    target.dispatchEvent(new Event('pointerdown'));
    target.dispatchEvent(new Event('keydown'));
    expect(scheduler.setTimeout).toHaveBeenCalledTimes(3);
    detach();
    target.dispatchEvent(new Event('touchstart'));
    expect(scheduler.setTimeout).toHaveBeenCalledTimes(3);
  });
});

function fakeWakeLock() {
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
  const sentinels: Array<{ released: boolean; release: () => Promise<void>; fireRelease: () => void }> = [];
  const request = vi.fn(async () => {
    let onRelease = () => {};
    const sentinel = {
      released: false,
      release: vi.fn(async () => {
        sentinel.released = true;
        onRelease();
      }),
      addEventListener: (_type: 'release', listener: () => void) => {
        onRelease = listener;
      },
      fireRelease: () => {
        sentinel.released = true;
        onRelease();
      },
    };
    sentinels.push(sentinel);
    return sentinel;
  });
  return { doc, request, sentinels };
}

describe('WakeLockController (simulated)', () => {
  it('reports unsupported browsers instead of pretending', async () => {
    const { doc } = fakeWakeLock();
    const lock = new WakeLockController({ document: doc as unknown as Document });
    expect(await lock.enable()).toBe('unsupported');
  });

  it('acquires the lock and takes it again when the page returns', async () => {
    const { doc, request, sentinels } = fakeWakeLock();
    const lock = new WakeLockController({ request, document: doc as unknown as Document });
    const seen: string[] = [];
    lock.onChange((status) => seen.push(status));

    expect(await lock.enable()).toBe('active');
    expect(await lock.enable()).toBe('active'); // idempotent
    expect(request).toHaveBeenCalledTimes(1);

    // The system releases the lock when the tab is hidden.
    doc.visibilityState = 'hidden';
    sentinels[0]!.fireRelease();
    expect(lock.status).toBe('idle');
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(lock.status).toBe('active'));
    expect(request).toHaveBeenCalledTimes(2);
    expect(seen).toEqual(['active', 'idle', 'active']);
  });

  it('reports a refusal and stops trying once disabled', async () => {
    const { doc } = fakeWakeLock();
    const request = vi.fn().mockRejectedValue(new DOMException('low battery', 'NotAllowedError'));
    const lock = new WakeLockController({ request, document: doc as unknown as Document });
    expect(await lock.enable()).toBe('failed');
    await lock.disable();
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(request).toHaveBeenCalledTimes(1);
    expect(lock.status).toBe('idle');
  });

  it('releases the lock on disable', async () => {
    const { doc, request, sentinels } = fakeWakeLock();
    const lock = new WakeLockController({ request, document: doc as unknown as Document });
    await lock.enable();
    await lock.disable();
    expect(sentinels[0]!.release).toHaveBeenCalled();
    expect(lock.status).toBe('idle');
  });
});

describe('delivery QR', () => {
  it('links to the download page with only the token', () => {
    expect(deliveryLink('AbC_123-x', 'https://photobooth.accurova.com')).toBe('https://photobooth.accurova.com/d/AbC_123-x');
  });

  it('renders the link as an SVG QR code in the requested colours', async () => {
    const svg = await deliveryQrSvg('https://photobooth.accurova.com/d/AbC_123-x', { dark: '#8E1B1B', light: '#FFFBF3' });
    expect(svg).toMatch(/^<svg/);
    expect(svg).toContain('#8E1B1B');
    expect(svg).toContain('#FFFBF3');
  });
});
