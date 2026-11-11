import type { JobView } from '@accurova/shared-types';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, PhotoboothApi, downloadPageUrl } from '../api';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const job = (over: Partial<JobView>): JobView => ({
  jobId: 'j1',
  sessionId: 's1',
  status: 'queued',
  error: null,
  attempts: 1,
  provider: null,
  width: null,
  height: null,
  subjectBox: null,
  foregroundUrl: null,
  ...over,
});

function client(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init));
  return { api: new PhotoboothApi({ baseUrl: 'https://api.test/', fetch: fetchMock as typeof fetch }), fetchMock };
}

describe('PhotoboothApi (simulated transport)', () => {
  it('creates a session with a JSON body', async () => {
    const { api, fetchMock } = client(() => json({ sessionId: 's1' }, 201));
    expect((await api.createSession('little-red-dot-tours')).sessionId).toBe('s1');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.test/api/session/create');
    expect(init).toMatchObject({ method: 'POST', body: '{"templateId":"little-red-dot-tours"}' });
  });

  it('uploads the capture and the result as the untouched Blob', async () => {
    const { api, fetchMock } = client(() => json({}));
    const photo = new Blob(['jpeg-bytes'], { type: 'image/jpeg' });
    await api.uploadCapture('s1', photo);
    await api.uploadResult('s1', photo);
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method, init?.body === photo])).toEqual([
      ['https://api.test/api/session/s1/capture', 'PUT', true],
      ['https://api.test/api/session/s1/result', 'PUT', true],
    ]);
  });

  it('surfaces the API error detail and status', async () => {
    const { api } = client(() => json({ detail: 'Segmentation is not configured' }, 503));
    await expect(api.startProcessing('s1')).rejects.toMatchObject({
      code: 'http',
      status: 503,
      message: 'Segmentation is not configured',
    });
  });

  it('distinguishes network failures, cancellation and a missing API address', async () => {
    const offline = client(() => {
      throw new TypeError('Failed to fetch');
    });
    await expect(offline.api.getJob('j1')).rejects.toMatchObject({ code: 'network' });

    const aborted = client(() => {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    });
    await expect(aborted.api.getJob('j1')).rejects.toMatchObject({ code: 'aborted' });

    const unconfigured = new PhotoboothApi({ baseUrl: '' });
    expect(unconfigured.configured).toBe(false);
    await expect(unconfigured.createSession('x')).rejects.toMatchObject({ code: 'not-configured' });
  });

  it('polls until the job is done and reports progress', async () => {
    const states = [job({}), job({ status: 'segmenting' }), job({ status: 'done', foregroundUrl: '/api/process/j1/foreground' })];
    const { api, fetchMock } = client(() => json(states.shift()));
    const seen: string[] = [];
    const sleep = vi.fn(async () => undefined);
    const done = await api.waitForJob('j1', { sleep, onUpdate: (j) => seen.push(j.status) });
    expect(done.status).toBe('done');
    expect(seen).toEqual(['queued', 'segmenting', 'done']);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('rejects with the job error when processing fails', async () => {
    const { api } = client(() => json(job({ status: 'failed', error: 'no-subject' })));
    const error = await api.waitForJob('j1', { sleep: async () => undefined }).catch((e: ApiError) => e);
    expect(error).toMatchObject({ code: 'job-failed', jobError: 'no-subject' });
  });

  it('gives up after the timeout instead of polling forever', async () => {
    const { api, fetchMock } = client(() => json(job({ status: 'segmenting' })));
    let clock = 0;
    const waiting = api.waitForJob('j1', {
      intervalMs: 1000,
      timeoutMs: 3000,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });
    await expect(waiting).rejects.toMatchObject({ code: 'timeout' });
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it('stops waiting when aborted', async () => {
    const controller = new AbortController();
    const { api } = client(() => json(job({})));
    const waiting = api.waitForJob('j1', { signal: controller.signal, sleep: async () => controller.abort() });
    await expect(waiting).rejects.toMatchObject({ code: 'aborted' });
  });

  it('fetches the foreground only for finished jobs', async () => {
    const { api, fetchMock } = client(() => new Response('png', { headers: { 'Content-Type': 'image/png' } }));
    await expect(api.fetchForeground(job({}))).rejects.toMatchObject({ code: 'job-failed' });
    const blob = await api.fetchForeground(job({ status: 'done', foregroundUrl: '/api/process/j1/foreground' }));
    expect(await blob.text()).toBe('png');
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.test/api/process/j1/foreground');
  });

  it('builds download URLs without exposing anything but the token', () => {
    const { api } = client(() => json({}));
    expect(api.downloadUrl('tok_en-1')).toBe('https://api.test/api/download/tok_en-1');
    expect(downloadPageUrl('tok_en-1', 'https://photobooth.accurova.com')).toBe(
      'https://photobooth.accurova.com/d/tok_en-1',
    );
  });
});
