import type { CaptureMethod, CaptureRecord, QualityVerdict } from '@accurova/shared-types';
import type { CameraManager } from './CameraManager';
import { toCameraError, type CameraCapabilities, type CapturedImage, type StreamRequest } from './types';

export interface QualityPolicy {
  preferredLongestEdge: number;
  minimumLongestEdge: number;
}

export const DEFAULT_QUALITY_POLICY: QualityPolicy = { preferredLongestEdge: 3000, minimumLongestEdge: 2000 };

/** Judges ACTUAL output dimensions against the configured targets. */
export function evaluateQuality(width: number, height: number, policy: QualityPolicy = DEFAULT_QUALITY_POLICY): QualityVerdict {
  const longest = Math.max(width, height);
  if (longest >= policy.preferredLongestEdge) return 'preferred';
  if (longest >= policy.minimumLongestEdge) return 'acceptable';
  return 'below-minimum';
}

export type ProviderOverride = CaptureMethod | 'auto';

export interface ProviderSelection {
  method: CaptureMethod | null;
  overridden: boolean;
  reason: string;
}

const AUTO_ORDER: CaptureMethod[] = ['imagecapture', 'stream'];

/**
 * Chooses a capture provider from runtime capabilities.
 * Automatic order: real still photo (ImageCapture) first, stream frame second.
 * Native capture is never chosen automatically because it needs a person to
 * operate the system camera; an administrator can still select it explicitly.
 */
export function selectProvider(capabilities: CameraCapabilities[], override: ProviderOverride = 'auto'): ProviderSelection {
  const byMethod = new Map(capabilities.map((c) => [c.method, c]));
  if (override !== 'auto') {
    const chosen = byMethod.get(override);
    if (chosen?.supported) {
      return { method: override, overridden: true, reason: `Administrator override: ${override}.` };
    }
    const auto = selectProvider(capabilities, 'auto');
    return {
      ...auto,
      reason: `Override "${override}" is not supported here (${chosen?.note ?? 'unavailable'}). ${auto.reason}`,
    };
  }
  for (const method of AUTO_ORDER) {
    if (byMethod.get(method)?.supported) {
      return {
        method,
        overridden: false,
        reason:
          method === 'imagecapture'
            ? 'ImageCapture is supported: using real still photographs.'
            : 'ImageCapture is unavailable: using stream frames at the stream resolution (not native stills).',
      };
    }
  }
  return { method: null, overridden: false, reason: 'No automated capture method is available on this device.' };
}

export function toCaptureRecord(image: CapturedImage, latencyMs: number, capturedAt = new Date()): CaptureRecord {
  return {
    captureMethod: image.captureMethod,
    width: image.width,
    height: image.height,
    megapixels: Math.round((image.width * image.height) / 10_000) / 100,
    mimeType: image.mimeType,
    fileSize: image.fileSize,
    latencyMs: Math.round(latencyMs),
    capturedAt: capturedAt.toISOString(),
    nativeStill: image.captureMethod !== 'stream',
  };
}

/** Resolutions worth asking for, largest first. 4:3 modes suit full-body portraits best. */
export const RESOLUTION_PRESETS: Array<{ label: string; width: number; height: number }> = [
  { label: '4032 × 3024 (12 MP, 4:3)', width: 4032, height: 3024 },
  { label: '3840 × 2160 (4K, 16:9)', width: 3840, height: 2160 },
  { label: '3264 × 2448 (8 MP, 4:3)', width: 3264, height: 2448 },
  { label: '3088 × 2316 (7 MP, 4:3)', width: 3088, height: 2316 },
  { label: '2560 × 1440 (QHD, 16:9)', width: 2560, height: 1440 },
  { label: '1920 × 1440 (4:3)', width: 1920, height: 1440 },
  { label: '1920 × 1080 (Full HD)', width: 1920, height: 1080 },
  { label: '1280 × 720 (HD)', width: 1280, height: 720 },
];

export interface ProbeResult {
  requested: string;
  width: number;
  height: number;
  frameRate?: number;
  error?: string;
}

/**
 * Asks for each preset in turn and records what the browser really delivers.
 * This is the only trustworthy way to learn a device's stream ceiling.
 * Leaves the camera stopped; the caller restarts its preferred stream.
 */
export async function probeStreamResolutions(
  manager: CameraManager,
  base: StreamRequest,
  presets = RESOLUTION_PRESETS,
  onProgress?: (done: number, total: number) => void,
): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];
  for (const [i, preset] of presets.entries()) {
    try {
      const info = await manager.start({ ...base, width: preset.width, height: preset.height });
      results.push({ requested: preset.label, width: info.width, height: info.height, frameRate: info.frameRate });
    } catch (error) {
      const e = toCameraError(error);
      results.push({ requested: preset.label, width: 0, height: 0, error: `${e.code}: ${e.message}` });
      if (e.code === 'permission-denied' || e.code === 'not-found') break;
    }
    onProgress?.(i + 1, presets.length);
  }
  manager.stop();
  return results;
}

/** Which image types the browser's canvas can really encode. */
export async function detectCanvasMimeTypes(candidates = ['image/jpeg', 'image/png', 'image/webp']): Promise<string[]> {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 2;
  if (!canvas.getContext('2d')) return [];
  const supported: string[] = [];
  for (const type of candidates) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9));
    if (blob?.type === type) supported.push(type);
  }
  return supported;
}
