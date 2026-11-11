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

export type JobStatus = 'queued' | 'segmenting' | 'done' | 'failed';

/** Why a job failed. Stable codes the kiosk can map to visitor-friendly messages. */
export type JobErrorCode =
  | 'timeout'
  | 'no-subject'
  | 'capture-missing'
  | 'provider-error'
  | 'provider-unreachable'
  | 'internal-error';

export interface SessionView {
  sessionId: string;
  templateId: string;
  status: 'active' | 'delivered' | 'complete';
  hasResult: boolean;
  expiresAt: string;
}

export interface CaptureReceipt {
  sessionId: string;
  width: number;
  height: number;
  bytes: number;
}

export interface JobView {
  jobId: string;
  sessionId: string;
  status: JobStatus;
  error: JobErrorCode | null;
  attempts: number;
  provider: string | null;
  width: number | null;
  height: number | null;
  /** Pixel bounds of the person in the foreground: [left, top, right, bottom]. */
  subjectBox: [number, number, number, number] | null;
  foregroundUrl: string | null;
}

export interface DeliveryResult {
  sessionId: string;
  token: string;
  imageUrl: string;
  infoUrl: string;
  width: number;
  height: number;
  expiresAt: string;
}

export interface DownloadInfo {
  templateId: string;
  width: number;
  height: number;
  expiresAt: string;
  imageUrl: string;
}

export interface ApiHealth {
  status: 'ok';
  version: string;
  templates: number;
  /**
   * Backing services and their real state. `local` = on-disk adapter,
   * `connected` = remote service verified, `error` = configured but unreachable.
   */
  services: Record<string, 'connected' | 'configured' | 'local' | 'mock' | 'not-configured' | 'error'>;
}
