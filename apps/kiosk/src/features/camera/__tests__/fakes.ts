// SIMULATED camera primitives for automated tests. Nothing in this file
// exercises real hardware; physical validation is recorded separately in
// docs/CAMERA_COMPATIBILITY.md.
import { vi } from 'vitest';

export class FakeTrack extends EventTarget {
  readyState: 'live' | 'ended' = 'live';
  stop = vi.fn(() => {
    this.readyState = 'ended';
  });

  constructor(
    public settings: MediaTrackSettings = { width: 1920, height: 1080, frameRate: 30, facingMode: 'user' },
    public label = 'Fake Front Camera',
    public capabilities: MediaTrackCapabilities | null = { width: { max: 1920 }, height: { max: 1080 } },
  ) {
    super();
  }

  getSettings() {
    return this.settings;
  }

  getCapabilities() {
    if (!this.capabilities) throw new Error('not supported');
    return this.capabilities;
  }
}

export function fakeStream(track: FakeTrack): MediaStream {
  return {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream;
}

/** getUserMedia stand-in that hands out the given tracks in order. */
export function fakeMediaDevices(...tracks: FakeTrack[]) {
  const queue = [...tracks];
  const getUserMedia = vi.fn(async (_constraints?: MediaStreamConstraints) => {
    const track = queue.shift();
    if (!track) throw Object.assign(new Error('no camera'), { name: 'NotFoundError' });
    return fakeStream(track);
  });
  return { getUserMedia };
}

export const jpeg = (bytes = 4) => new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' });
