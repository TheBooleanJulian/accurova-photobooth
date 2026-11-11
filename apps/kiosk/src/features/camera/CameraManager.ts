import { CameraError, toCameraError, type StreamInfo, type StreamRequest } from './types';

type MediaDevicesLike = Pick<MediaDevices, 'getUserMedia'>;
export type CameraEvent = 'ended' | 'mute' | 'unmute';

export function buildConstraints(request: StreamRequest): MediaStreamConstraints {
  const video: MediaTrackConstraints = {};
  // A specific device wins over a facing preference.
  if (request.deviceId) video.deviceId = { exact: request.deviceId };
  else if (request.facingMode) video.facingMode = { ideal: request.facingMode };
  // `ideal` lets the browser pick its closest mode instead of failing outright.
  if (request.width) video.width = { ideal: request.width };
  if (request.height) video.height = { ideal: request.height };
  return { video, audio: false };
}

export function describeTrack(track: MediaStreamTrack, requested: StreamRequest): StreamInfo {
  const settings = track.getSettings();
  let maxWidth: number | undefined;
  let maxHeight: number | undefined;
  try {
    const caps = track.getCapabilities?.();
    maxWidth = caps?.width?.max;
    maxHeight = caps?.height?.max;
  } catch {
    // getCapabilities is optional; absence is not an error.
  }
  return {
    requested,
    label: track.label,
    deviceId: settings.deviceId,
    facingMode: settings.facingMode,
    width: settings.width ?? 0,
    height: settings.height ?? 0,
    frameRate: settings.frameRate,
    maxWidth,
    maxHeight,
  };
}

/**
 * Owns the preview MediaStream. Capture providers borrow the track from here;
 * they never open their own stream, so there is exactly one place that must
 * release the camera.
 */
export class CameraManager {
  private stream: MediaStream | null = null;
  private info: StreamInfo | null = null;
  private lastRequest: StreamRequest | null = null;
  private generation = 0;
  private detach: (() => void) | null = null;
  private readonly listeners = new Set<(event: CameraEvent) => void>();

  constructor(
    private readonly getMediaDevices: () => MediaDevicesLike | undefined = () => globalThis.navigator?.mediaDevices,
    private readonly isSecureContext: () => boolean = () => globalThis.isSecureContext ?? false,
  ) {}

  async start(request: StreamRequest = {}): Promise<StreamInfo> {
    this.stop();
    const generation = ++this.generation;
    const mediaDevices = this.getMediaDevices();
    if (!mediaDevices?.getUserMedia) {
      throw this.isSecureContext()
        ? new CameraError('unsupported', 'This browser does not expose a camera API.')
        : new CameraError('insecure-context', 'Cameras are only available over HTTPS (or localhost).');
    }

    let stream: MediaStream;
    try {
      stream = await mediaDevices.getUserMedia(buildConstraints(request));
    } catch (error) {
      throw toCameraError(error);
    }

    // A newer start() or a stop() happened while we were waiting: discard this stream.
    if (generation !== this.generation) {
      stream.getTracks().forEach((t) => t.stop());
      throw new CameraError('interrupted', 'Camera start was superseded.');
    }

    const track = stream.getVideoTracks()[0];
    if (!track) {
      stream.getTracks().forEach((t) => t.stop());
      throw new CameraError('not-found', 'The camera returned no video track.');
    }

    const handlers: Array<[CameraEvent, () => void]> = (['ended', 'mute', 'unmute'] as const).map((event) => [
      event,
      () => this.listeners.forEach((listener) => listener(event)),
    ]);
    handlers.forEach(([event, handler]) => track.addEventListener(event, handler));
    this.detach = () => handlers.forEach(([event, handler]) => track.removeEventListener(event, handler));

    this.stream = stream;
    this.lastRequest = request;
    this.info = describeTrack(track, request);
    return this.info;
  }

  /** Releases the camera. Safe to call repeatedly. */
  stop(): void {
    this.generation++;
    this.detach?.();
    this.detach = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.info = null;
  }

  /** Reopens the camera with the last request, e.g. after Safari suspends the tab. */
  restart(): Promise<StreamInfo> {
    if (!this.lastRequest) throw new CameraError('not-ready', 'The camera has not been started yet.');
    return this.start(this.lastRequest);
  }

  /** True when a stream exists and its track has not been ended by the system. */
  isLive(): boolean {
    return this.getTrack()?.readyState === 'live';
  }

  getStream(): MediaStream | null {
    return this.stream;
  }

  getTrack(): MediaStreamTrack | null {
    return this.stream?.getVideoTracks()[0] ?? null;
  }

  /** Re-reads settings from the live track (they can change on rotation). */
  getInfo(): StreamInfo | null {
    const track = this.getTrack();
    if (track && this.lastRequest) this.info = describeTrack(track, this.lastRequest);
    return this.info;
  }

  onEvent(listener: (event: CameraEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
