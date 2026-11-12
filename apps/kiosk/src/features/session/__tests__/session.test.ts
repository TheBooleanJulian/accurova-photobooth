import type { CaptureRecord } from '@accurova/shared-types';
import { describe, expect, it } from 'vitest';
import {
  initialSession,
  isBusy,
  resumeSession,
  transition,
  type SessionEvent,
  type SessionState,
} from '../sessionMachine';
import { createSessionStore, memoryPersistence } from '../sessionStore';

const capture: CaptureRecord = {
  captureMethod: 'stream',
  width: 1080,
  height: 1920,
  megapixels: 2.07,
  mimeType: 'image/jpeg',
  fileSize: 400_000,
  latencyMs: 90,
  capturedAt: '2026-11-12T01:00:00.000Z',
  nativeStill: false,
};
const T0 = Date.parse('2026-11-12T01:00:00Z');
const run = (events: SessionEvent[], from = initialSession('lrdt', 'en')) => events.reduce(transition, from);

const toProcessing: SessionEvent[] = [
  { type: 'START', at: T0 },
  { type: 'READY' },
  { type: 'CAPTURED', capture },
  { type: 'CONFIRM_PHOTO' },
  { type: 'SELECT_BACKGROUND', backgroundId: 'marina-bay-sands' },
  { type: 'CONFIRM_BACKGROUND' },
];
const delivered: SessionEvent = { type: 'DELIVERED', token: 'tok', expiresAt: '2026-11-13T01:00:00Z' };

describe('session machine', () => {
  it('walks the whole visitor flow', () => {
    const stages: string[] = [];
    let state = initialSession('lrdt', 'en');
    for (const event of [...toProcessing, { type: 'SESSION_CREATED', sessionId: 's1' }, { type: 'JOB_STARTED', jobId: 'j1' }, delivered, { type: 'DONE' }] as SessionEvent[]) {
      state = transition(state, event);
      stages.push(state.stage);
    }
    expect(stages).toEqual(['instructions', 'camera', 'review', 'background', 'background', 'processing', 'processing', 'processing', 'result', 'complete']);
    expect(state).toMatchObject({ sessionId: 's1', jobId: 'j1', backgroundId: 'marina-bay-sands', delivery: { token: 'tok' } });
  });

  it('ignores events that do not belong to the current stage', () => {
    const welcome = initialSession('lrdt', 'en');
    for (const event of [{ type: 'READY' }, { type: 'CONFIRM_PHOTO' }, delivered, { type: 'DONE' }, { type: 'RETAKE' }] as SessionEvent[]) {
      expect(transition(welcome, event)).toBe(welcome);
    }
    const background = run(toProcessing.slice(0, 4));
    expect(transition(background, { type: 'CONFIRM_BACKGROUND' })).toBe(background); // nothing selected yet
    const processing = run(toProcessing);
    expect(transition(processing, { type: 'BACK' })).toBe(processing); // no leaving mid-processing
    expect(transition(processing, { type: 'RETAKE' })).toBe(processing);
  });

  it('only allows changing language before starting', () => {
    expect(run([{ type: 'SET_LOCALE', locale: 'zh-CN' }]).locale).toBe('zh-CN');
    expect(run([{ type: 'START', at: T0 }, { type: 'SET_LOCALE', locale: 'zh-CN' }]).locale).toBe('en');
  });

  it('counts retakes and discards everything made from the old photo', () => {
    const state = run([...toProcessing.slice(0, 3), { type: 'RETAKE' }]);
    expect(state).toMatchObject({ stage: 'camera', capture: null, retakes: 1 });
  });

  it('handles processing failures: retry in place, retake, or go back', () => {
    const processing = run([...toProcessing, { type: 'SESSION_CREATED', sessionId: 's1' }, { type: 'JOB_STARTED', jobId: 'j1' }]);
    expect(isBusy(processing)).toBe(true);

    const network = transition(processing, { type: 'FAILED', error: { code: 'network', retryable: true, retake: false } });
    expect(isBusy(network)).toBe(false);
    expect(transition(network, { type: 'RETRY' })).toMatchObject({ stage: 'processing', error: null, sessionId: 's1' });
    expect(transition(network, { type: 'BACK' })).toMatchObject({ stage: 'background', error: null });

    const noSubject = transition(processing, { type: 'FAILED', error: { code: 'no-subject', retryable: false, retake: true } });
    expect(transition(noSubject, { type: 'RETRY' })).toBe(noSubject); // not retryable
    expect(transition(noSubject, { type: 'RETAKE' })).toMatchObject({ stage: 'camera', capture: null, jobId: null, sessionId: 's1', retakes: 1 });
  });

  it('forgets the job when a new server session is created', () => {
    const state = run([...toProcessing, { type: 'SESSION_CREATED', sessionId: 's1' }, { type: 'JOB_STARTED', jobId: 'j1' }, { type: 'SESSION_CREATED', sessionId: 's2' }]);
    expect(state).toMatchObject({ sessionId: 's2', jobId: null });
  });

  it('resets from anywhere, keeping the template and language', () => {
    const state = transition(run([{ type: 'SET_LOCALE', locale: 'zh-CN' }, ...toProcessing]), { type: 'RESET' });
    expect(state).toEqual(initialSession('lrdt', 'zh-CN'));
  });
});

describe('resumeSession', () => {
  const context = { now: T0 + 60_000, hasCaptureImage: true, maxAgeMs: 15 * 60_000 };
  const at = (events: SessionEvent[]) => run(events);

  it('resumes early stages and stages whose photograph survived', () => {
    expect(resumeSession(at(toProcessing.slice(0, 2)), context).stage).toBe('camera');
    expect(resumeSession(at(toProcessing.slice(0, 3)), context).stage).toBe('review');
    expect(resumeSession(at(toProcessing), context)).toMatchObject({ stage: 'processing', error: null });
  });

  it('sends the visitor back to the camera when the photograph is gone', () => {
    const resumed = resumeSession(at(toProcessing), { ...context, hasCaptureImage: false });
    expect(resumed).toMatchObject({ stage: 'camera', capture: null, backgroundId: 'marina-bay-sands' });
  });

  it('abandons stale, finished and never-started sessions', () => {
    const fresh = initialSession('lrdt', 'en');
    expect(resumeSession(at(toProcessing), { ...context, now: T0 + 16 * 60_000 })).toEqual(fresh);
    expect(resumeSession(at([...toProcessing, delivered, { type: 'DONE' }]), context)).toEqual(fresh);
    expect(resumeSession(fresh, context)).toEqual(fresh);
  });

  it('keeps showing a result only while its link is valid', () => {
    const result = at([...toProcessing, delivered]);
    expect(resumeSession(result, context).stage).toBe('result');
    const expired: SessionState = { ...result, startedAt: Date.parse('2026-11-13T00:55:00Z') };
    expect(resumeSession(expired, { ...context, now: Date.parse('2026-11-13T01:00:01Z') }).stage).toBe('welcome');
  });
});

describe('session store', () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const image = new Blob(['original-bytes'], { type: 'image/jpeg' });

  it('persists the state and the untouched capture, and restores them after a reload', async () => {
    const persistence = memoryPersistence();
    const store = createSessionStore({ templateId: 'lrdt', defaultLocale: 'en', persistence, now: () => T0 + 1000 });
    await store.getState().hydrate();
    store.getState().send({ type: 'START', at: T0 });
    store.getState().send({ type: 'READY' });
    store.getState().setCapture(image, capture);
    store.getState().send({ type: 'CONFIRM_PHOTO' });
    await flush();
    expect(persistence.image).toBe(image); // the same Blob, never re-encoded
    expect(persistence.state?.stage).toBe('background');

    const reloaded = createSessionStore({ templateId: 'lrdt', defaultLocale: 'en', persistence, now: () => T0 + 5000 });
    expect(reloaded.getState().hydrated).toBe(false);
    await reloaded.getState().hydrate();
    expect(reloaded.getState()).toMatchObject({ hydrated: true, captureImage: image, session: { stage: 'background' } });
  });

  it('drops the stored image on retake and clears everything on reset', async () => {
    const persistence = memoryPersistence();
    const store = createSessionStore({ templateId: 'lrdt', defaultLocale: 'en', persistence });
    store.getState().send({ type: 'START', at: T0 });
    store.getState().send({ type: 'READY' });
    store.getState().setCapture(image, capture);
    store.getState().send({ type: 'RETAKE' });
    await flush();
    expect(store.getState().captureImage).toBeNull();
    expect(persistence.image).toBeNull();

    store.getState().setCapture(image, capture);
    store.getState().send({ type: 'RESET' });
    await flush();
    expect(store.getState()).toMatchObject({ captureImage: null, session: { stage: 'welcome' } });
    expect(persistence.state).toBeNull();
    expect(persistence.image).toBeNull();
  });

  it('refuses a capture outside the camera stage', () => {
    const store = createSessionStore({ templateId: 'lrdt', defaultLocale: 'en', persistence: memoryPersistence() });
    store.getState().setCapture(image, capture);
    expect(store.getState()).toMatchObject({ captureImage: null, session: { stage: 'welcome' } });
  });

  it('ignores another template’s saved session and survives broken storage', async () => {
    const persistence = memoryPersistence();
    persistence.state = { ...run(toProcessing, initialSession('other', 'en')) };
    const store = createSessionStore({ templateId: 'lrdt', defaultLocale: 'en', persistence, now: () => T0 });
    await store.getState().hydrate();
    expect(store.getState().session.stage).toBe('welcome');

    const broken = { ...memoryPersistence(), loadState: async () => Promise.reject(new Error('blocked')), saveState: async () => Promise.reject(new Error('full')) };
    const fragile = createSessionStore({ templateId: 'lrdt', defaultLocale: 'en', persistence: broken });
    await fragile.getState().hydrate();
    fragile.getState().send({ type: 'START', at: T0 });
    await flush();
    expect(fragile.getState()).toMatchObject({ hydrated: true, session: { stage: 'instructions' } });
  });
});
