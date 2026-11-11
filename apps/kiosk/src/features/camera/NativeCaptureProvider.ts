import { measureImage, type ImageMeasurer } from './measureImage';
import {
  CameraError,
  type CameraCapabilities,
  type CameraCaptureProvider,
  type CapturedImage,
  type FacingMode,
} from './types';

export type FilePicker = (facing: FacingMode) => Promise<File>;

/**
 * Opens the operating system's camera through a file input. Must be called
 * from a user gesture. Resolves with the photo, rejects if the visitor cancels.
 */
export const nativeFilePicker: FilePicker = (facing) =>
  new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.setAttribute('capture', facing);
    input.style.display = 'none';
    document.body.appendChild(input);
    const cleanup = () => input.remove();
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      cleanup();
      if (file) resolve(file);
      else reject(new CameraError('cancelled', 'No photo was taken.'));
    });
    input.addEventListener('cancel', () => {
      cleanup();
      reject(new CameraError('cancelled', 'The native camera was dismissed.'));
    });
    input.click();
  });

export interface NativeCaptureOptions {
  facing?: FacingMode;
  pick?: FilePicker;
  measure?: ImageMeasurer;
}

/**
 * Tertiary, DIAGNOSTIC capture path: the OS camera UI via
 * <input type="file" capture>. It yields the full-resolution native photo but
 * needs a person to press the shutter and confirm, so it is never selected
 * automatically for kiosk sessions.
 */
export class NativeCaptureProvider implements CameraCaptureProvider {
  readonly method = 'native' as const;
  private readonly facing: FacingMode;
  private readonly pick: FilePicker;
  private readonly measure: ImageMeasurer;

  constructor(options: NativeCaptureOptions = {}) {
    this.facing = options.facing ?? 'user';
    this.pick = options.pick ?? nativeFilePicker;
    this.measure = options.measure ?? measureImage;
  }

  async initialize(): Promise<void> {}

  async getCapabilities(): Promise<CameraCapabilities> {
    const supported =
      typeof document !== 'undefined' && 'capture' in (document.createElement('input') as unknown as object);
    return {
      method: this.method,
      supported,
      automated: false,
      nativeStill: true,
      note: supported
        ? 'Opens the system camera; a person must take and confirm the photo. Not usable for unattended sessions.'
        : 'This browser does not support camera capture from a file input.',
    };
  }

  async capture(): Promise<CapturedImage> {
    const file = await this.pick(this.facing);
    const dims = await this.measure(file);
    return {
      blob: file,
      width: dims.width,
      height: dims.height,
      mimeType: file.type || 'application/octet-stream',
      fileSize: file.size,
      captureMethod: this.method,
      metadata: { nativeStill: true, fileName: file.name, requiresUserInteraction: true },
    };
  }

  async dispose(): Promise<void> {}
}
