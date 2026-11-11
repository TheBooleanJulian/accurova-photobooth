import type { CameraManager } from './CameraManager';
import { CameraError, type CameraCapabilities, type CameraCaptureProvider, type CapturedImage } from './types';

export interface FrameSource {
  videoWidth: number;
  videoHeight: number;
  readyState: number;
}

/** Encodes the current frame of `source` at its full intrinsic size. */
export type FrameEncoder = (source: FrameSource, mimeType: string, quality: number) => Promise<Blob>;

export const canvasFrameEncoder: FrameEncoder = (source, mimeType, quality) =>
  new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = source.videoWidth;
    canvas.height = source.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return reject(new CameraError('unknown', 'Canvas 2D is unavailable.'));
    ctx.drawImage(source as HTMLVideoElement, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        // Release the backing store promptly; iPadOS has a tight canvas memory budget.
        canvas.width = 0;
        canvas.height = 0;
        if (blob) resolve(blob);
        else reject(new CameraError('unknown', 'The frame could not be encoded.'));
      },
      mimeType,
      quality,
    );
  });

export interface StreamCaptureOptions {
  mimeType?: string;
  quality?: number;
  encode?: FrameEncoder;
}

/**
 * Secondary capture path: grabs one frame of the preview stream.
 * The result is a VIDEO FRAME at the stream's resolution. It is always
 * labelled `stream` and must never be presented as a native still photograph.
 */
export class StreamCaptureProvider implements CameraCaptureProvider {
  readonly method = 'stream' as const;
  private readonly mimeType: string;
  private readonly quality: number;
  private readonly encode: FrameEncoder;

  constructor(
    private readonly manager: CameraManager,
    private readonly getVideo: () => FrameSource | null,
    options: StreamCaptureOptions = {},
  ) {
    this.mimeType = options.mimeType ?? 'image/jpeg';
    this.quality = options.quality ?? 0.95;
    this.encode = options.encode ?? canvasFrameEncoder;
  }

  async initialize(): Promise<void> {}

  async getCapabilities(): Promise<CameraCapabilities> {
    const info = this.manager.getInfo();
    const live = this.manager.isLive();
    return {
      method: this.method,
      supported: live,
      automated: true,
      nativeStill: false,
      maxWidth: info?.maxWidth ?? info?.width,
      maxHeight: info?.maxHeight ?? info?.height,
      note: live
        ? 'Video frame at stream resolution, not a native still photograph.'
        : 'Start the camera stream first.',
    };
  }

  async capture(): Promise<CapturedImage> {
    const video = this.getVideo();
    // readyState 2 = HAVE_CURRENT_DATA: a frame is available to draw.
    if (!this.manager.isLive() || !video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      throw new CameraError('not-ready', 'The camera preview has no frame to capture yet.');
    }
    const width = video.videoWidth;
    const height = video.videoHeight;
    const blob = await this.encode(video, this.mimeType, this.quality);
    const info = this.manager.getInfo();
    return {
      blob,
      width,
      height,
      // Browsers silently fall back to PNG for unsupported types: report what we got.
      mimeType: blob.type || this.mimeType,
      fileSize: blob.size,
      captureMethod: this.method,
      metadata: {
        nativeStill: false,
        encoderQuality: this.quality,
        trackWidth: info?.width,
        trackHeight: info?.height,
        frameRate: info?.frameRate,
        cameraLabel: info?.label,
      },
    };
  }

  async dispose(): Promise<void> {}
}
