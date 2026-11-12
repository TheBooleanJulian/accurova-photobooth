import type { ComposeResult, Drawable } from '@accurova/image-engine';
import type { DeliveryResult, JobView } from '@accurova/shared-types';
import type { BackgroundConfig, TemplateConfig } from '@accurova/template-engine';
import { ApiError, type PhotoboothApi } from '../../services/api';
import type { CompositeRequest } from '../compositing/Compositor';
import type { LoadedFrame } from '../frames/FrameEngine';
import type { SessionError } from '../session/sessionMachine';

export type PipelineStep = 'session' | 'upload' | 'segment' | 'compose' | 'deliver';

export class PipelineError extends Error {
  constructor(
    readonly step: PipelineStep,
    /** Ready to hand to the session machine as a FAILED event. */
    readonly sessionError: SessionError,
    message: string,
  ) {
    super(message);
    this.name = 'PipelineError';
  }
}

export interface PipelineInput {
  template: TemplateConfig;
  background: BackgroundConfig;
  frame: LoadedFrame;
  /** The original capture, sent to the server untouched. */
  capture: Blob;
  /** Reuse a server session from before a reload, if there is one. */
  sessionId?: string | null;
  signal?: AbortSignal;
  onProgress?: (step: PipelineStep) => void;
  onSession?: (sessionId: string) => void;
  onJob?: (jobId: string) => void;
}

export interface PipelineResult {
  sessionId: string;
  delivery: DeliveryResult;
  final: ComposeResult;
  job: JobView;
}

type Api = Pick<
  PhotoboothApi,
  'createSession' | 'uploadCapture' | 'startProcessing' | 'waitForJob' | 'fetchForeground' | 'uploadResult'
>;

export interface PipelineDeps {
  api: Api;
  /** Decodes the RGBA foreground into something a canvas can draw. */
  decodeForeground: (image: Blob) => Promise<Drawable<CanvasImageSource>>;
  render: (request: CompositeRequest) => Promise<ComposeResult>;
  /** Attempts per network step before giving up (default 3). */
  attempts?: number;
  sleep?: (ms: number) => Promise<void>;
  /** How long to wait for segmentation before failing (default 90 s). */
  jobTimeoutMs?: number;
}

function toSessionError(error: unknown, step: PipelineStep): SessionError {
  if (error instanceof ApiError) {
    if (error.code === 'job-failed') {
      return error.jobError === 'no-subject'
        ? { code: 'no-subject', retryable: false, retake: true }
        : { code: error.jobError === 'timeout' ? 'timeout' : 'processing', retryable: true, retake: false };
    }
    if (error.code === 'timeout') return { code: 'timeout', retryable: true, retake: false };
    if (error.code === 'network') return { code: 'network', retryable: true, retake: false };
    if (error.code === 'not-configured' || error.status === 503) {
      return { code: 'not-configured', retryable: false, retake: false };
    }
    // The server refused the image itself (not a JPEG, too large): another attempt needs a new photo.
    if (step === 'upload' && (error.status === 413 || error.status === 415)) {
      return { code: 'processing', retryable: false, retake: true };
    }
    if (error.status === 409) return { code: 'processing', retryable: false, retake: true };
  }
  return { code: step === 'deliver' ? 'delivery' : 'processing', retryable: true, retake: false };
}

const transient = (error: unknown) =>
  error instanceof ApiError && (error.code === 'network' || (error.status !== undefined && error.status >= 500 && error.status !== 503));
const sessionGone = (error: unknown) => error instanceof ApiError && error.status === 404;

/**
 * Turns a confirmed capture into a delivered photograph:
 *
 *   session → upload original → segment (server) → compose (canvas) → deliver
 *
 * Every server step is idempotent, so transient failures are retried here and
 * the whole pipeline can simply be run again after a reload. Failures come
 * back as a PipelineError that already says whether to retry or retake.
 */
export async function runPipeline(input: PipelineInput, deps: PipelineDeps): Promise<PipelineResult> {
  const attempts = deps.attempts ?? 3;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let step: PipelineStep = 'session';

  const checkAborted = () => {
    if (input.signal?.aborted) throw new ApiError('aborted', 'The session was cancelled.');
  };
  const enter = (next: PipelineStep) => {
    checkAborted();
    step = next;
    input.onProgress?.(next);
  };
  const retrying = async <T>(work: () => Promise<T>): Promise<T> => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await work();
      } catch (error) {
        if (!transient(error) || attempt >= attempts) throw error;
        await sleep(500 * 2 ** (attempt - 1));
        checkAborted();
      }
    }
  };

  const serverSide = async (sessionId: string | null) => {
    enter('session');
    let created = sessionId;
    if (!created) {
      created = (await retrying(() => deps.api.createSession(input.template.id))).sessionId;
      input.onSession?.(created);
    }
    const id: string = created;
    enter('upload');
    await retrying(() => deps.api.uploadCapture(id, input.capture));
    enter('segment');
    const started = await retrying(() => deps.api.startProcessing(id));
    input.onJob?.(started.jobId);
    const job = await deps.api.waitForJob(started.jobId, { signal: input.signal, timeoutMs: deps.jobTimeoutMs });
    const foreground = await retrying(() => deps.api.fetchForeground(job));
    return { id, job, foreground };
  };

  try {
    let server;
    try {
      server = await serverSide(input.sessionId ?? null);
    } catch (error) {
      // A session carried over a reload may have expired on the server: start a new one, once.
      if (!input.sessionId || !sessionGone(error)) throw error;
      server = await serverSide(null);
    }
    if (!server.job.subjectBox) throw new ApiError('job-failed', 'The job has no subject bounds.', undefined, 'internal-error');

    enter('compose');
    const final = await deps.render({
      template: input.template,
      background: input.background,
      frame: input.frame,
      foreground: await deps.decodeForeground(server.foreground),
      subjectBox: server.job.subjectBox,
    });

    enter('deliver');
    const delivery = await retrying(() => deps.api.uploadResult(server.id, final.blob));
    return { sessionId: server.id, delivery, final, job: server.job };
  } catch (error) {
    if (error instanceof ApiError && error.code === 'aborted') throw error;
    throw new PipelineError(step, toSessionError(error, step), (error as Error).message ?? 'Processing failed');
  }
}
