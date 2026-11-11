/**
 * Contracts shared between the kiosk, the admin tools and the API.
 * Template/background/frame types live in @accurova/template-engine, where
 * they are inferred from the validation schemas.
 */

export type CaptureMethod = 'imagecapture' | 'stream' | 'native';

/** Serializable description of a capture (the Blob itself never leaves the camera module by reference in reports). */
export interface CaptureRecord {
  captureMethod: CaptureMethod;
  width: number;
  height: number;
  megapixels: number;
  mimeType: string;
  fileSize: number;
  latencyMs: number;
  capturedAt: string;
  /** True only for `imagecapture` and `native`: a `stream` capture is a video frame, never a native still. */
  nativeStill: boolean;
}

export type QualityVerdict = 'preferred' | 'acceptable' | 'below-minimum';

export type SessionStage =
  | 'welcome'
  | 'instructions'
  | 'camera'
  | 'review'
  | 'background'
  | 'processing'
  | 'result'
  | 'complete';

/** Processing job states the API will report from M3 onwards. */
export type JobStatus = 'queued' | 'segmenting' | 'compositing' | 'uploading' | 'done' | 'failed';

export interface ApiHealth {
  status: 'ok';
  version: string;
  templates: number;
  /** External services and whether they are really connected. Mock adapters report `mock`. */
  services: Record<string, 'connected' | 'mock' | 'not-configured'>;
}
