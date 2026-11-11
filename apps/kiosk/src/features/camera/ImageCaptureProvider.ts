import type { CameraManager } from './CameraManager';
import { measureImage, type ImageMeasurer } from './measureImage';
import { CameraError, type CameraCapabilities, type CameraCaptureProvider, type CapturedImage } from './types';

interface Range {
  min?: number;
  max?: number;
}

/** The subset of the ImageCapture API this provider relies on. */
export interface ImageCaptureLike {
  takePhoto(settings?: { imageWidth?: number; imageHeight?: number }): Promise<Blob>;
  getPhotoCapabilities?(): Promise<{ imageWidth?: Range; imageHeight?: Range }>;
}

export type ImageCaptureConstructor = new (track: MediaStreamTrack) => ImageCaptureLike;

export function getImageCaptureConstructor(): ImageCaptureConstructor | undefined {
  const ctor = (globalThis as { ImageCapture?: unknown }).ImageCapture;
  return typeof ctor === 'function' ? (ctor as ImageCaptureConstructor) : undefined;
}

export interface ImageCaptureOptions {
  ImageCapture?: ImageCaptureConstructor;
  measure?: ImageMeasurer;
}

/**
 * Primary capture path: a real still photograph via ImageCapture.takePhoto().
 * Support is detected at runtime; nothing here assumes a device or browser.
 */
export class ImageCaptureProvider implements CameraCaptureProvider {
  readonly method = 'imagecapture' as const;
  private readonly Ctor: ImageCaptureConstructor | undefined;
  private readonly measure: ImageMeasurer;
  private capturer: ImageCaptureLike | null = null;
  private boundTrack: MediaStreamTrack | null = null;
  private photoMax: { width?: number; height?: number } = {};

  constructor(
    private readonly manager: CameraManager,
    options: ImageCaptureOptions = {},
  ) {
    this.Ctor = options.ImageCapture ?? getImageCaptureConstructor();
    this.measure = options.measure ?? measureImage;
  }

  /** Binds to the manager's current track. Call again after the stream restarts. */
  async initialize(): Promise<void> {
    this.capturer = null;
    this.boundTrack = null;
    this.photoMax = {};
    const track = this.manager.getTrack();
    if (!this.Ctor || !track || track.readyState !== 'live') return;
    this.capturer = new this.Ctor(track);
    this.boundTrack = track;
    try {
      const caps = await this.capturer.getPhotoCapabilities?.();
      this.photoMax = { width: caps?.imageWidth?.max, height: caps?.imageHeight?.max };
    } catch {
      // Photo capabilities are optional; takePhoto() may still work.
    }
  }

  async getCapabilities(): Promise<CameraCapabilities> {
    const base = { method: this.method, automated: true, nativeStill: true } as const;
    if (!this.Ctor) {
      return { ...base, supported: false, note: 'ImageCapture is not available in this browser.' };
    }
    if (this.boundTrack !== this.manager.getTrack()) await this.initialize();
    if (!this.capturer) {
      return { ...base, supported: false, note: 'Start the camera stream first.' };
    }
    return { ...base, supported: true, maxWidth: this.photoMax.width, maxHeight: this.photoMax.height };
  }

  async capture(): Promise<CapturedImage> {
    if (this.boundTrack !== this.manager.getTrack()) await this.initialize();
    if (!this.capturer) {
      throw new CameraError(
        this.Ctor ? 'not-ready' : 'unsupported',
        this.Ctor ? 'The camera stream is not running.' : 'ImageCapture is not available in this browser.',
      );
    }

    const { width, height } = this.photoMax;
    let blob: Blob;
    let requestedMax = false;
    try {
      if (width && height) {
        requestedMax = true;
        blob = await this.capturer.takePhoto({ imageWidth: width, imageHeight: height });
      } else {
        blob = await this.capturer.takePhoto();
      }
    } catch (first) {
      if (!requestedMax) throw new CameraError('unknown', `takePhoto() failed: ${(first as Error).message}`, first);
      // Some implementations reject explicit sizes; retry with browser defaults.
      requestedMax = false;
      try {
        blob = await this.capturer.takePhoto();
      } catch (second) {
        throw new CameraError('unknown', `takePhoto() failed: ${(second as Error).message}`, second);
      }
    }

    const dims = await this.measure(blob);
    return {
      blob,
      width: dims.width,
      height: dims.height,
      mimeType: blob.type || 'application/octet-stream',
      fileSize: blob.size,
      captureMethod: this.method,
      metadata: {
        nativeStill: true,
        requestedMaxPhotoSize: requestedMax,
        reportedMaxWidth: width,
        reportedMaxHeight: height,
        cameraLabel: this.boundTrack?.label,
      },
    };
  }

  async dispose(): Promise<void> {
    this.capturer = null;
    this.boundTrack = null;
  }
}
