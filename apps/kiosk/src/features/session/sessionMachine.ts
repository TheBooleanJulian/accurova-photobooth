import type { CaptureRecord, SessionStage } from '@accurova/shared-types';

/**
 * The visitor flow as a pure state machine. No timers, no network, no DOM:
 * screens send events, this decides the next state. Invalid events are
 * ignored, so a double tap or a late callback can never skip a step.
 *
 *   welcome → instructions → camera ⇄ review → background → processing → result → complete
 */

export type SessionErrorCode =
  | 'camera'
  | 'network'
  | 'timeout'
  | 'no-subject'
  | 'processing'
  | 'not-configured'
  | 'delivery';

export interface SessionError {
  code: SessionErrorCode;
  /** The same step can be tried again as it is. */
  retryable: boolean;
  /** The photograph itself is the problem: send the visitor back to the camera. */
  retake: boolean;
}

export interface SessionState {
  stage: SessionStage;
  templateId: string;
  locale: string;
  /** When the visitor pressed start (epoch ms). Used to expire stale sessions after a reload. */
  startedAt: number | null;
  /** Facts about the confirmed capture. The image itself is stored separately. */
  capture: CaptureRecord | null;
  retakes: number;
  backgroundId: string | null;
  /** Server-side ids, kept so a reload can resume the same idempotent job. */
  sessionId: string | null;
  jobId: string | null;
  delivery: { token: string; expiresAt: string } | null;
  error: SessionError | null;
}

export type SessionEvent =
  | { type: 'SET_LOCALE'; locale: string }
  | { type: 'START'; at: number }
  | { type: 'READY' }
  | { type: 'BACK' }
  | { type: 'CAPTURED'; capture: CaptureRecord }
  | { type: 'RETAKE' }
  | { type: 'CONFIRM_PHOTO' }
  | { type: 'SELECT_BACKGROUND'; backgroundId: string }
  | { type: 'CONFIRM_BACKGROUND' }
  | { type: 'SESSION_CREATED'; sessionId: string }
  | { type: 'JOB_STARTED'; jobId: string }
  | { type: 'DELIVERED'; token: string; expiresAt: string }
  | { type: 'FAILED'; error: SessionError }
  | { type: 'RETRY' }
  | { type: 'DONE' }
  | { type: 'RESET' };

export function initialSession(templateId: string, locale: string): SessionState {
  return {
    stage: 'welcome',
    templateId,
    locale,
    startedAt: null,
    capture: null,
    retakes: 0,
    backgroundId: null,
    sessionId: null,
    jobId: null,
    delivery: null,
    error: null,
  };
}

/** Clears everything derived from a photograph, keeping the server session for reuse. */
const discardPhoto = (state: SessionState): SessionState => ({
  ...state,
  capture: null,
  jobId: null,
  delivery: null,
  error: null,
});

export function transition(state: SessionState, event: SessionEvent): SessionState {
  if (event.type === 'RESET') return initialSession(state.templateId, state.locale);

  switch (state.stage) {
    case 'welcome':
      if (event.type === 'SET_LOCALE') return { ...state, locale: event.locale };
      if (event.type === 'START') return { ...state, stage: 'instructions', startedAt: event.at };
      return state;

    case 'instructions':
      if (event.type === 'READY') return { ...state, stage: 'camera' };
      if (event.type === 'BACK') return { ...state, stage: 'welcome', startedAt: null };
      return state;

    case 'camera':
      if (event.type === 'CAPTURED') return { ...state, stage: 'review', capture: event.capture, error: null };
      if (event.type === 'FAILED') return { ...state, error: event.error };
      if (event.type === 'RETRY') return { ...state, error: null };
      if (event.type === 'BACK') return { ...state, stage: 'instructions', error: null };
      return state;

    case 'review':
      if (event.type === 'RETAKE') return { ...discardPhoto(state), stage: 'camera', retakes: state.retakes + 1 };
      if (event.type === 'CONFIRM_PHOTO' && state.capture) return { ...state, stage: 'background' };
      return state;

    case 'background':
      if (event.type === 'SELECT_BACKGROUND') return { ...state, backgroundId: event.backgroundId };
      if (event.type === 'CONFIRM_BACKGROUND' && state.backgroundId) return { ...state, stage: 'processing', error: null };
      if (event.type === 'BACK') return { ...state, stage: 'review' };
      return state;

    case 'processing':
      if (event.type === 'SESSION_CREATED') return { ...state, sessionId: event.sessionId, jobId: null };
      if (event.type === 'JOB_STARTED') return { ...state, jobId: event.jobId };
      if (event.type === 'DELIVERED') {
        return { ...state, stage: 'result', delivery: { token: event.token, expiresAt: event.expiresAt }, error: null };
      }
      if (event.type === 'FAILED') return { ...state, error: event.error };
      if (event.type === 'RETRY' && state.error?.retryable) return { ...state, error: null };
      // Only a failure lets the visitor leave processing; otherwise they wait for the result.
      if (event.type === 'RETAKE' && state.error) {
        return { ...discardPhoto(state), stage: 'camera', retakes: state.retakes + 1 };
      }
      if (event.type === 'BACK' && state.error) return { ...state, stage: 'background', error: null };
      return state;

    case 'result':
      if (event.type === 'DONE') return { ...state, stage: 'complete' };
      return state;

    case 'complete':
      return state;
  }
}

/** True while the visitor is waiting on the machine, not the other way round. */
export const isBusy = (state: SessionState) => state.stage === 'processing' && state.error === null;

export interface ResumeContext {
  now: number;
  /** Whether the captured image survived the reload. */
  hasCaptureImage: boolean;
  /** Sessions older than this are abandoned rather than resumed. */
  maxAgeMs: number;
}

/**
 * Decides where to continue after Safari reloads the page or the tablet
 * wakes up. The rule: never show a stage whose inputs are gone, and never
 * resume something stale.
 */
export function resumeSession(saved: SessionState, context: ResumeContext): SessionState {
  const fresh = initialSession(saved.templateId, saved.locale);
  if (saved.stage === 'welcome' || saved.stage === 'complete') return fresh;
  if (saved.startedAt === null || context.now - saved.startedAt > context.maxAgeMs) return fresh;

  if (saved.stage === 'result') {
    const valid = saved.delivery && Date.parse(saved.delivery.expiresAt) > context.now;
    return valid ? saved : fresh;
  }
  if (saved.stage === 'instructions' || saved.stage === 'camera') return { ...saved, error: null };

  // review, background, processing all need the photograph.
  if (!saved.capture || !context.hasCaptureImage) {
    return { ...discardPhoto(saved), stage: 'camera' };
  }
  // A processing stage restarts its pipeline; the server job is idempotent.
  return { ...saved, error: null };
}
