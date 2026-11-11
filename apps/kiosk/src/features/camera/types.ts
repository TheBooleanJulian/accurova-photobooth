import type { CaptureMethod } from '@accurova/shared-types';

export type { CaptureMethod };
export type FacingMode = 'user' | 'environment';

/** What the application asks the browser for. Every field is a preference, not a guarantee. */
export interface StreamRequest {
  facingMode?: FacingMode;
  deviceId?: string;
  width?: number;
  height?: number;
}

/** What the browser actually delivered. Always read these, never the request. */
export interface StreamInfo {
  requested: StreamRequest;
  label: string;
  deviceId?: string;
  facingMode?: string;
  width: number;
  height: number;
  frameRate?: number;
  /** Track capability ranges when the browser exposes them. */
  maxWidth?: number;
  maxHeight?: number;
}

export interface CapturedImage {
  blob: Blob;
  width: number;
  height: number;
  mimeType: string;
  fileSize: number;
  captureMethod: CaptureMethod;
  metadata?: Record<string, unknown>;
}

/** Result of asking one provider what it can do on this device, right now. */
export interface CameraCapabilities {
  method: CaptureMethod;
  supported: boolean;
  /** False when capture needs a visitor to operate system UI (native file input). */
  automated: boolean;
  /** True when the output is a real still photograph rather than a video frame. */
  nativeStill: boolean;
  /** Largest image the provider reports it can produce, when known. */
  maxWidth?: number;
  maxHeight?: number;
  /** Why the provider is unsupported, or a caveat worth showing an administrator. */
  note?: string;
}

export interface CameraCaptureProvider {
  readonly method: CaptureMethod;
  initialize(): Promise<void>;
  getCapabilities(): Promise<CameraCapabilities>;
  capture(): Promise<CapturedImage>;
  dispose(): Promise<void>;
}

export interface CameraDeviceInfo {
  deviceId: string;
  label: string;
  /** Best guess from the label; undefined when labels are hidden (before permission). */
  facing?: FacingMode;
}

export type CameraErrorCode =
  | 'insecure-context'
  | 'unsupported'
  | 'permission-denied'
  | 'not-found'
  | 'in-use'
  | 'overconstrained'
  | 'interrupted'
  | 'not-ready'
  | 'cancelled'
  | 'unknown';

export class CameraError extends Error {
  constructor(
    readonly code: CameraErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'CameraError';
  }
}

/** Maps getUserMedia failures to stable codes the UI can act on. */
export function toCameraError(error: unknown): CameraError {
  if (error instanceof CameraError) return error;
  const name = (error as { name?: string } | null)?.name ?? '';
  const message = (error as { message?: string } | null)?.message ?? String(error);
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new CameraError('permission-denied', 'Camera permission was denied.', error);
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return new CameraError('not-found', 'No camera was found.', error);
    case 'NotReadableError':
    case 'TrackStartError':
      return new CameraError('in-use', 'The camera is in use or could not be started.', error);
    case 'OverconstrainedError':
      return new CameraError('overconstrained', 'The camera cannot satisfy the requested settings.', error);
    case 'AbortError':
      return new CameraError('interrupted', 'The camera was interrupted while starting.', error);
    default:
      return new CameraError('unknown', message || 'Unknown camera error.', error);
  }
}
