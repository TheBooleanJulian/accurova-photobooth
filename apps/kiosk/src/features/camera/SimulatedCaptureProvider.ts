import type { CaptureMethod } from '@accurova/shared-types';
import type { CameraCapabilities, CameraCaptureProvider, CapturedImage } from './types';

export interface SimulatedCameraOptions {
  method?: CaptureMethod;
  width?: number;
  height?: number;
  supported?: boolean;
  /** Throw this from capture() to exercise failure paths. */
  failWith?: Error;
}

/**
 * SIMULATED camera for automated tests and development without hardware.
 * Results from this provider say nothing about a physical device and are
 * tagged `simulated: true` so they can never be mistaken for real captures.
 */
export class SimulatedCaptureProvider implements CameraCaptureProvider {
  readonly method: CaptureMethod;
  captures = 0;
  disposed = false;

  constructor(private readonly options: SimulatedCameraOptions = {}) {
    this.method = options.method ?? 'stream';
  }

  async initialize(): Promise<void> {
    this.disposed = false;
  }

  async getCapabilities(): Promise<CameraCapabilities> {
    return {
      method: this.method,
      supported: this.options.supported ?? true,
      automated: this.method !== 'native',
      nativeStill: this.method !== 'stream',
      maxWidth: this.options.width ?? 1920,
      maxHeight: this.options.height ?? 1080,
      note: 'Simulated provider.',
    };
  }

  async capture(): Promise<CapturedImage> {
    if (this.options.failWith) throw this.options.failWith;
    this.captures++;
    const blob = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' });
    return {
      blob,
      width: this.options.width ?? 1920,
      height: this.options.height ?? 1080,
      mimeType: blob.type,
      fileSize: blob.size,
      captureMethod: this.method,
      metadata: { simulated: true },
    };
  }

  async dispose(): Promise<void> {
    this.disposed = true;
  }
}
