interface Scheduler {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const browserScheduler: Scheduler = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as number),
};

/**
 * Resets an abandoned kiosk. Call `touch()` on any visitor activity; if none
 * arrives for `timeoutMs`, `onIdle` fires once. While `pause()`d (the booth
 * is busy on the visitor's behalf, e.g. processing) the timer does not run.
 */
export class IdleTimer {
  private handle: unknown = null;
  private running = false;
  private paused = false;

  constructor(
    private readonly timeoutMs: number,
    private readonly onIdle: () => void,
    private readonly scheduler: Scheduler = browserScheduler,
  ) {}

  private arm() {
    this.cancel();
    if (!this.running || this.paused) return;
    this.handle = this.scheduler.setTimeout(() => {
      this.handle = null;
      this.running = false;
      this.onIdle();
    }, this.timeoutMs);
  }

  private cancel() {
    if (this.handle !== null) this.scheduler.clearTimeout(this.handle);
    this.handle = null;
  }

  start(): void {
    this.running = true;
    this.arm();
  }

  stop(): void {
    this.running = false;
    this.cancel();
  }

  /** Visitor activity: restart the countdown. */
  touch(): void {
    if (this.running) this.arm();
  }

  pause(): void {
    this.paused = true;
    this.cancel();
  }

  resume(): void {
    this.paused = false;
    this.arm();
  }

  get active(): boolean {
    return this.running && !this.paused;
  }
}

const ACTIVITY_EVENTS = ['pointerdown', 'touchstart', 'keydown'] as const;

/** Feeds visitor activity into the timer. Returns a function that detaches the listeners. */
export function watchActivity(target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>, timer: IdleTimer) {
  const touch = () => timer.touch();
  ACTIVITY_EVENTS.forEach((type) => target.addEventListener(type, touch, { passive: true }));
  return () => ACTIVITY_EVENTS.forEach((type) => target.removeEventListener(type, touch));
}
