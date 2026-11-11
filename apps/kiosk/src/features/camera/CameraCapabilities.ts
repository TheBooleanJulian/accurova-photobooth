import { getImageCaptureConstructor } from './ImageCaptureProvider';

export type PermissionStatus = 'granted' | 'denied' | 'prompt' | 'unknown';

/** Runtime facts about the browser. Detected by feature tests, never inferred from the user agent. */
export interface EnvironmentReport {
  secureContext: boolean;
  hasGetUserMedia: boolean;
  hasEnumerateDevices: boolean;
  hasImageCapture: boolean;
  hasNativeCaptureInput: boolean;
  hasWakeLock: boolean;
  hasPermissionsApi: boolean;
  cameraPermission: PermissionStatus;
  /** Running as an installed (home-screen) app rather than in a browser tab. */
  standalone: boolean;
  /** Informational only: shown to administrators, never used to choose behaviour. */
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  /** Human hint derived from UA + touch points; a heuristic, not a source of truth. */
  deviceHint: string;
  screen: { width: number; height: number; devicePixelRatio: number };
  viewport: { width: number; height: number };
  orientation: string;
  language: string;
}

export function deviceHint(userAgent: string, platform: string, maxTouchPoints: number): string {
  // iPadOS Safari reports itself as a Mac; touch points are the usual tell.
  if (/iPad/.test(userAgent) || (/Mac/.test(platform) && maxTouchPoints > 1)) {
    const version = /Version\/([\d.]+)/.exec(userAgent)?.[1];
    return `iPad (heuristic)${version ? `, Safari ${version}` : ''}`;
  }
  if (/iPhone/.test(userAgent)) return 'iPhone (heuristic)';
  if (/Android/.test(userAgent)) return 'Android device (heuristic)';
  return 'Desktop or unknown (heuristic)';
}

export async function queryCameraPermission(): Promise<PermissionStatus> {
  try {
    const status = await navigator.permissions.query({ name: 'camera' as PermissionName });
    return status.state;
  } catch {
    // Not every browser lets pages query the camera permission.
    return 'unknown';
  }
}

export async function detectEnvironment(): Promise<EnvironmentReport> {
  const nav = navigator;
  const mediaDevices = nav.mediaDevices;
  return {
    secureContext: window.isSecureContext,
    hasGetUserMedia: typeof mediaDevices?.getUserMedia === 'function',
    hasEnumerateDevices: typeof mediaDevices?.enumerateDevices === 'function',
    hasImageCapture: getImageCaptureConstructor() !== undefined,
    hasNativeCaptureInput: 'capture' in document.createElement('input'),
    hasWakeLock: 'wakeLock' in nav,
    hasPermissionsApi: typeof nav.permissions?.query === 'function',
    cameraPermission: await queryCameraPermission(),
    standalone:
      window.matchMedia?.('(display-mode: standalone)').matches === true ||
      (nav as Navigator & { standalone?: boolean }).standalone === true,
    userAgent: nav.userAgent,
    platform: nav.platform,
    maxTouchPoints: nav.maxTouchPoints ?? 0,
    deviceHint: deviceHint(nav.userAgent, nav.platform, nav.maxTouchPoints ?? 0),
    screen: { width: screen.width, height: screen.height, devicePixelRatio: window.devicePixelRatio },
    viewport: { width: window.innerWidth, height: window.innerHeight },
    orientation: screen.orientation?.type ?? (window.innerHeight >= window.innerWidth ? 'portrait' : 'landscape'),
    language: nav.language,
  };
}
