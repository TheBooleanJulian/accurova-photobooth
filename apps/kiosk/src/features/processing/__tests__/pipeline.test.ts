import type { ComposeResult } from '@accurova/image-engine';
import type { DeliveryResult, JobView } from '@accurova/shared-types';
import type { BackgroundConfig, TemplateConfig } from '@accurova/template-engine';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../services/api';
import type { LoadedFrame } from '../../frames/FrameEngine';
import { PipelineError, runPipeline, type PipelineDeps, type PipelineStep } from '../pipeline';

const template = { id: 'little-red-dot-tours' } as TemplateConfig;
const background = { id: 'marina-bay-sands' } as BackgroundConfig;
const frame = { config: { id: 'frame' } } as LoadedFrame;
const capture = new Blob(['original'], { type: 'image/jpeg' });
const finalBlob = new Blob(['final'], { type: 'image/jpeg' });

const job: JobView = {
  jobId: 'j1',
  sessionId: 's1',
  status: 'done',
  error: null,
  attempts: 1,
  provider: 'mock',
  width: 1080,
  height: 1920,
  subjectBox: [10, 20, 300, 400],
  foregroundUrl: '/api/process/j1/foreground',
};
const delivery = { sessionId: 's1', token: 'tok', expiresAt: '2026-11-13T00:00:00Z' } as DeliveryResult;

function setup(over: Partial<PipelineDeps['api']> = {}) {
  const api = {
    createSession: vi.fn(async () => ({ sessionId: 's1' }) as never),
    uploadCapture: vi.fn(async () => ({}) as never),
    startProcessing: vi.fn(async () => ({ ...job, status: 'queued' }) as JobView),
    waitForJob: vi.fn(async () => job),
    fetchForeground: vi.fn(async () => new Blob(['png'])),
    uploadResult: vi.fn(async () => delivery),
    ...over,
  };
  const deps: PipelineDeps = {
    api,
    decodeForeground: vi.fn(async () => ({ source: 'FG' as unknown as CanvasImageSource, width: 1080, height: 1920 })),
    render: vi.fn(async () => ({ blob: finalBlob, width: 1080, height: 1920, report: {} }) as ComposeResult),
    sleep: vi.fn(async () => undefined),
  };
  return { api, deps };
}
const input = { template, background, frame, capture };
const network = () => new ApiError('network', 'offline');
const http = (status: number) => new ApiError('http', `status ${status}`, status);

describe('runPipeline (simulated services)', () => {
  it('runs session → upload → segment → compose → deliver and reports progress', async () => {
    const { api, deps } = setup();
    const steps: PipelineStep[] = [];
    const ids: string[] = [];
    const result = await runPipeline(
      { ...input, onProgress: (s) => steps.push(s), onSession: (id) => ids.push(id), onJob: (id) => ids.push(id) },
      deps,
    );
    expect(steps).toEqual(['session', 'upload', 'segment', 'compose', 'deliver']);
    expect(ids).toEqual(['s1', 'j1']);
    expect(api.uploadCapture).toHaveBeenCalledWith('s1', capture); // the original, untouched
    expect(deps.render).toHaveBeenCalledWith(expect.objectContaining({ template, background, frame, subjectBox: job.subjectBox }));
    expect(api.uploadResult).toHaveBeenCalledWith('s1', finalBlob);
    expect(result).toMatchObject({ sessionId: 's1', delivery, job });
  });

  it('reuses a session from before a reload', async () => {
    const { api, deps } = setup();
    await runPipeline({ ...input, sessionId: 'old' }, deps);
    expect(api.createSession).not.toHaveBeenCalled();
    expect(api.uploadCapture).toHaveBeenCalledWith('old', capture);
  });

  it('starts a new session once if the carried-over one has expired', async () => {
    const uploadCapture = vi.fn().mockRejectedValueOnce(http(404)).mockResolvedValue({});
    const { api, deps } = setup({ uploadCapture });
    const onSession = vi.fn();
    const result = await runPipeline({ ...input, sessionId: 'expired', onSession }, deps);
    expect(api.createSession).toHaveBeenCalledTimes(1);
    expect(onSession).toHaveBeenCalledWith('s1');
    expect(result.sessionId).toBe('s1');
  });

  it('retries transient failures with backoff, then succeeds', async () => {
    const uploadResult = vi.fn().mockRejectedValueOnce(network()).mockRejectedValueOnce(http(502)).mockResolvedValue(delivery);
    const { deps } = setup({ uploadResult });
    await runPipeline(input, deps);
    expect(uploadResult).toHaveBeenCalledTimes(3);
    expect((deps.sleep as ReturnType<typeof vi.fn>).mock.calls).toEqual([[500], [1000]]);
  });

  it('gives up after the configured attempts and says it is retryable', async () => {
    const { deps } = setup({ createSession: vi.fn().mockRejectedValue(network()) });
    const error = await runPipeline(input, { ...deps, attempts: 2 }).catch((e: PipelineError) => e);
    expect(error).toBeInstanceOf(PipelineError);
    expect(error).toMatchObject({ step: 'session', sessionError: { code: 'network', retryable: true, retake: false } });
    expect(deps.api.createSession).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['no person found', new ApiError('job-failed', 'x', undefined, 'no-subject'), 'segment', { code: 'no-subject', retryable: false, retake: true }],
    ['job timed out on the server', new ApiError('job-failed', 'x', undefined, 'timeout'), 'segment', { code: 'timeout', retryable: true, retake: false }],
    ['provider failed', new ApiError('job-failed', 'x', undefined, 'provider-error'), 'segment', { code: 'processing', retryable: true, retake: false }],
    ['kiosk stopped waiting', new ApiError('timeout', 'x'), 'segment', { code: 'timeout', retryable: true, retake: false }],
  ] as const)('maps a segmentation failure: %s', async (_name, failure, step, sessionError) => {
    const { deps } = setup({ waitForJob: vi.fn().mockRejectedValue(failure) });
    await expect(runPipeline(input, deps)).rejects.toMatchObject({ step, sessionError });
  });

  it('reports an unconfigured service as not retryable and a rejected image as a retake', async () => {
    const unconfigured = setup({ startProcessing: vi.fn().mockRejectedValue(http(503)) });
    await expect(runPipeline(input, unconfigured.deps)).rejects.toMatchObject({
      sessionError: { code: 'not-configured', retryable: false },
    });
    expect(unconfigured.api.startProcessing).toHaveBeenCalledTimes(1); // 503 is not retried

    const rejected = setup({ uploadCapture: vi.fn().mockRejectedValue(http(415)) });
    await expect(runPipeline(input, rejected.deps)).rejects.toMatchObject({
      step: 'upload',
      sessionError: { retake: true, retryable: false },
    });
  });

  it('reports compositing and delivery failures against the right step', async () => {
    const compose = setup();
    compose.deps.render = vi.fn().mockRejectedValue(new Error('canvas lost'));
    await expect(runPipeline(input, compose.deps)).rejects.toMatchObject({ step: 'compose', sessionError: { code: 'processing', retryable: true } });
    expect(compose.api.uploadResult).not.toHaveBeenCalled();

    const deliver = setup({ uploadResult: vi.fn().mockRejectedValue(http(500)) });
    await expect(runPipeline(input, { ...deliver.deps, attempts: 1 })).rejects.toMatchObject({ step: 'deliver', sessionError: { code: 'delivery', retryable: true } });
  });

  it('stops quietly when the session is cancelled', async () => {
    const controller = new AbortController();
    const { api, deps } = setup({
      uploadCapture: vi.fn(async () => {
        controller.abort();
        return {} as never;
      }),
    });
    const error = await runPipeline({ ...input, signal: controller.signal }, deps).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe('aborted');
    expect(api.startProcessing).not.toHaveBeenCalled();
  });
});
