import type { CameraDeviceInfo, FacingMode } from './types';

export function guessFacing(label: string): FacingMode | undefined {
  if (/front|user|facetime|selfie/i.test(label)) return 'user';
  if (/back|rear|environment/i.test(label)) return 'environment';
  return undefined;
}

/**
 * Lists cameras. Labels (and therefore the facing guess) are empty until the
 * visitor or administrator has granted camera permission.
 */
export async function listCameras(
  mediaDevices: Pick<MediaDevices, 'enumerateDevices'> | undefined = globalThis.navigator?.mediaDevices,
): Promise<CameraDeviceInfo[]> {
  if (!mediaDevices?.enumerateDevices) return [];
  const devices = await mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === 'videoinput')
    .map((d, i) => ({
      deviceId: d.deviceId,
      label: d.label || `Camera ${i + 1} (label hidden until permission is granted)`,
      facing: guessFacing(d.label),
    }));
}
