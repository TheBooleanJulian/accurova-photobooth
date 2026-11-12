export type WakeLockStatus = 'idle' | 'active' | 'unsupported' | 'failed';

interface SentinelLike {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}

interface WakeLockEnvironment {
  request?: (type: 'screen') => Promise<SentinelLike>;
  document: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;
}

const browserEnvironment = (): WakeLockEnvironment => ({
  request: 'wakeLock' in navigator ? (type) => navigator.wakeLock.request(type) as Promise<SentinelLike> : undefined,
  document,
});

/**
 * Keeps the screen awake where the browser allows it.
 *
 * This is best-effort by design. A web page cannot override iPadOS sleep,
 * Low Power Mode or battery policy; the system may release the lock at any
 * time (it always does when the page is hidden). The dependable setup for a
 * booth is external power plus Auto-Lock: Never plus Guided Access; this
 * class only adds to that and reports honestly when it cannot help.
 */
export class WakeLockController {
  private sentinel: SentinelLike | null = null;
  private wanted = false;
  private current: WakeLockStatus = 'idle';
  private readonly listeners = new Set<(status: WakeLockStatus) => void>();
  private readonly env: WakeLockEnvironment;

  constructor(env: WakeLockEnvironment = browserEnvironment()) {
    this.env = env;
  }

  get status(): WakeLockStatus {
    return this.current;
  }

  onChange(listener: (status: WakeLockStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setStatus(status: WakeLockStatus) {
    if (status === this.current) return;
    this.current = status;
    this.listeners.forEach((listener) => listener(status));
  }

  private readonly onVisibility = () => {
    // The system drops the lock whenever the page is hidden; take it again on return.
    if (this.wanted && this.env.document.visibilityState === 'visible') void this.acquire();
  };

  private async acquire(): Promise<WakeLockStatus> {
    if (!this.env.request) {
      this.setStatus('unsupported');
      return this.current;
    }
    if (this.sentinel && !this.sentinel.released) return this.current;
    try {
      const sentinel = await this.env.request('screen');
      if (!this.wanted) {
        await sentinel.release();
        return this.current;
      }
      this.sentinel = sentinel;
      sentinel.addEventListener('release', () => {
        if (this.sentinel === sentinel) this.sentinel = null;
        if (this.wanted) this.setStatus('idle');
      });
      this.setStatus('active');
    } catch {
      // Refused: low battery, power saving, or the page is not visible.
      this.setStatus('failed');
    }
    return this.current;
  }

  /** Requests the lock and keeps re-requesting it whenever the page becomes visible again. */
  async enable(): Promise<WakeLockStatus> {
    if (!this.wanted) {
      this.wanted = true;
      this.env.document.addEventListener('visibilitychange', this.onVisibility);
    }
    return this.acquire();
  }

  async disable(): Promise<void> {
    this.wanted = false;
    this.env.document.removeEventListener('visibilitychange', this.onVisibility);
    const sentinel = this.sentinel;
    this.sentinel = null;
    if (sentinel && !sentinel.released) await sentinel.release().catch(() => undefined);
    if (this.current !== 'unsupported') this.setStatus('idle');
  }
}
