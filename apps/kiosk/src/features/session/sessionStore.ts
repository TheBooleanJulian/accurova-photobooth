import type { CaptureRecord } from '@accurova/shared-types';
import { del, get, set } from 'idb-keyval';
import { createStore, type StoreApi } from 'zustand/vanilla';
import {
  initialSession,
  resumeSession,
  transition,
  type SessionEvent,
  type SessionState,
} from './sessionMachine';

/** Where a session survives a reload. The image and the state are stored apart. */
export interface SessionPersistence {
  loadState(): Promise<SessionState | null>;
  saveState(state: SessionState): Promise<void>;
  loadImage(): Promise<Blob | null>;
  saveImage(image: Blob | null): Promise<void>;
  clear(): Promise<void>;
}

/** IndexedDB persistence, one record set per template so kiosks never share state. */
export function indexedDbPersistence(templateId: string): SessionPersistence {
  const stateKey = `photobooth:${templateId}:session`;
  const imageKey = `photobooth:${templateId}:capture`;
  return {
    loadState: async () => (await get<SessionState>(stateKey)) ?? null,
    saveState: (state) => set(stateKey, state),
    loadImage: async () => (await get<Blob>(imageKey)) ?? null,
    saveImage: (image) => (image ? set(imageKey, image) : del(imageKey)),
    clear: async () => {
      await Promise.all([del(stateKey), del(imageKey)]);
    },
  };
}

export function memoryPersistence(): SessionPersistence & { state: SessionState | null; image: Blob | null } {
  return {
    state: null,
    image: null,
    async loadState() {
      return this.state;
    },
    async saveState(state) {
      this.state = state;
    },
    async loadImage() {
      return this.image;
    },
    async saveImage(image) {
      this.image = image;
    },
    async clear() {
      this.state = null;
      this.image = null;
    },
  };
}

export interface SessionStore {
  session: SessionState;
  /** False until a previous session (if any) has been restored. */
  hydrated: boolean;
  /** The captured image for the current session, in memory. */
  captureImage: Blob | null;
  send(event: SessionEvent): void;
  /** Records a capture: keeps the original Blob untouched and moves to review. */
  setCapture(image: Blob, record: CaptureRecord): void;
  hydrate(): Promise<void>;
}

export interface SessionStoreOptions {
  templateId: string;
  defaultLocale: string;
  persistence?: SessionPersistence;
  now?: () => number;
  /** Sessions older than this are not resumed after a reload. */
  maxAgeMs?: number;
}

/**
 * The kiosk's session, with persistence. Persistence failures (private
 * browsing, full storage) are swallowed: the session then simply does not
 * survive a reload, which is safe.
 */
export function createSessionStore(options: SessionStoreOptions): StoreApi<SessionStore> {
  const persistence = options.persistence ?? indexedDbPersistence(options.templateId);
  const now = options.now ?? (() => Date.now());
  const safely = (work: Promise<void>) => void work.catch(() => undefined);

  return createStore<SessionStore>((setState, getState) => {
    const apply = (next: SessionState, image?: Blob | null) => {
      const previous = getState().session;
      if (next === previous && image === undefined) return;
      const dropImage = image === undefined && next.capture === null && getState().captureImage !== null;
      const captureImage = image !== undefined ? image : dropImage ? null : getState().captureImage;
      setState({ session: next, captureImage });
      if (next.stage === 'welcome') {
        safely(persistence.clear());
        return;
      }
      safely(persistence.saveState(next));
      if (image !== undefined || dropImage) safely(persistence.saveImage(captureImage));
    };

    return {
      session: initialSession(options.templateId, options.defaultLocale),
      hydrated: false,
      captureImage: null,

      send(event) {
        apply(transition(getState().session, event));
      },

      setCapture(image, record) {
        const next = transition(getState().session, { type: 'CAPTURED', capture: record });
        if (next !== getState().session) apply(next, image);
      },

      async hydrate() {
        try {
          const saved = await persistence.loadState();
          if (saved && saved.templateId === options.templateId) {
            const image = await persistence.loadImage();
            const resumed = resumeSession(saved, {
              now: now(),
              hasCaptureImage: image !== null,
              maxAgeMs: options.maxAgeMs ?? 15 * 60 * 1000,
            });
            setState({ session: resumed, captureImage: resumed.capture ? image : null });
            if (resumed.stage === 'welcome') safely(persistence.clear());
          }
        } catch {
          // Unreadable storage: start fresh.
        }
        setState({ hydrated: true });
      },
    };
  });
}
