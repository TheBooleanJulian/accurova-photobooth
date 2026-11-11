import type {
  CaptureReceipt,
  DeliveryResult,
  DownloadInfo,
  JobErrorCode,
  JobView,
  SessionView,
} from '@accurova/shared-types';

export type ApiErrorCode = 'network' | 'http' | 'timeout' | 'aborted' | 'job-failed' | 'not-configured';

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    /** HTTP status for `http` errors. */
    readonly status?: number,
    /** The job's own error code for `job-failed`. */
    readonly jobError?: JobErrorCode | null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiOptions {
  /** Origin of the FastAPI service, e.g. https://api.example.com. Empty = not configured. */
  baseUrl: string;
  fetch?: typeof fetch;
}

export interface WaitOptions {
  intervalMs?: number;
  /** Give up after this long so a visitor is never left on the processing screen. */
  timeoutMs?: number;
  signal?: AbortSignal;
  onUpdate?: (job: JobView) => void;
  /** Injected in tests. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** Typed client for the photobooth API. One instance per page. */
export class PhotoboothApi {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ApiOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
  }

  get configured(): boolean {
    return this.baseUrl !== '';
  }

  /** Turns an API-relative path (as returned in responses) into a full URL. */
  url(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    if (!this.configured) throw new ApiError('not-configured', 'The photobooth API address is not configured.');
    let response: Response;
    try {
      response = await this.fetchImpl(this.url(path), init);
    } catch (error) {
      if ((error as { name?: string }).name === 'AbortError') throw new ApiError('aborted', 'The request was cancelled.');
      throw new ApiError('network', 'The photobooth service could not be reached.');
    }
    if (!response.ok) {
      let detail = `The photobooth service answered ${response.status}.`;
      try {
        const body = (await response.json()) as { detail?: unknown };
        if (typeof body.detail === 'string') detail = body.detail;
      } catch {
        // Keep the generic message when the body is not JSON.
      }
      throw new ApiError('http', detail, response.status);
    }
    return response;
  }

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    return (await (await this.request(path, init)).json()) as T;
  }

  createSession(templateId: string): Promise<SessionView> {
    return this.json('/api/session/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId }),
    });
  }

  /** Sends the original capture untouched. Calling again is a retake. */
  uploadCapture(sessionId: string, image: Blob): Promise<CaptureReceipt> {
    return this.json(`/api/session/${sessionId}/capture`, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: image,
    });
  }

  /** Idempotent: returns the existing job if one is already running or done. */
  startProcessing(sessionId: string): Promise<JobView> {
    return this.json(`/api/session/${sessionId}/process`, { method: 'POST' });
  }

  getJob(jobId: string, signal?: AbortSignal): Promise<JobView> {
    return this.json(`/api/process/${jobId}`, { signal });
  }

  /** Polls until the job is done. Rejects with `job-failed`, `timeout` or `aborted`. */
  async waitForJob(jobId: string, options: WaitOptions = {}): Promise<JobView> {
    const { intervalMs = 1000, timeoutMs = 90_000, signal, onUpdate } = options;
    const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    const now = options.now ?? (() => Date.now());
    const deadline = now() + timeoutMs;
    for (;;) {
      if (signal?.aborted) throw new ApiError('aborted', 'Waiting was cancelled.');
      const job = await this.getJob(jobId, signal);
      onUpdate?.(job);
      if (job.status === 'done') return job;
      if (job.status === 'failed') {
        throw new ApiError('job-failed', `Processing failed (${job.error ?? 'unknown'}).`, undefined, job.error);
      }
      if (now() + intervalMs > deadline) throw new ApiError('timeout', 'Processing took too long.');
      await sleep(intervalMs);
    }
  }

  /** The lossless RGBA foreground of a finished job. */
  async fetchForeground(job: JobView): Promise<Blob> {
    if (!job.foregroundUrl) throw new ApiError('job-failed', 'The job has no foreground yet.');
    return (await this.request(job.foregroundUrl)).blob();
  }

  /** Sends the finished photograph and receives its download token. Safe to retry. */
  uploadResult(sessionId: string, image: Blob): Promise<DeliveryResult> {
    return this.json(`/api/session/${sessionId}/result`, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: image,
    });
  }

  completeSession(sessionId: string): Promise<{ sessionId: string; status: 'complete' }> {
    return this.json(`/api/session/${sessionId}/complete`, { method: 'POST' });
  }

  downloadInfo(token: string): Promise<DownloadInfo> {
    return this.json(`/api/download/${encodeURIComponent(token)}/info`);
  }

  downloadUrl(token: string): string {
    return this.url(`/api/download/${encodeURIComponent(token)}`);
  }
}

export const api = new PhotoboothApi({ baseUrl: import.meta.env.VITE_API_BASE_URL ?? '' });

/** The page visitors reach from the QR code. Lives on the kiosk site, not the API. */
export function downloadPageUrl(token: string, origin: string = location.origin): string {
  return `${origin}/d/${encodeURIComponent(token)}`;
}
