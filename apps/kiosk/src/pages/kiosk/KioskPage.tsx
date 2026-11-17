import { TemplateLoadError, type LocaleStrings, type TemplateConfig } from '@accurova/template-engine';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useStore, type StoreApi } from 'zustand';
import { templateOutputSize } from '../../features/compositing/Compositor';
import { FrameEngine, FrameError, FrameRegistry, type LoadedFrame } from '../../features/frames';
import { createTranslate } from '../../features/i18n/strings';
import { IdleTimer, watchActivity } from '../../features/kiosk/IdleTimer';
import { WakeLockController } from '../../features/kiosk/WakeLock';
import { isBusy, type SessionEvent } from '../../features/session/sessionMachine';
import { createSessionStore, type SessionStore } from '../../features/session/sessionStore';
import { templateRegistry } from '../../features/templates/registry';
import { CameraStage, InstructionsStage, ReviewStage, WelcomeStage } from './CaptureStages';
import { BackgroundStage, CompleteStage, ProcessingStage, ResultStage } from './ResultStages';
import { themeStyle, type KioskContext } from './ui';

interface Booth {
  template: TemplateConfig;
  frame: LoadedFrame;
  store: StoreApi<SessionStore>;
}

/** Loads everything a booth needs before a visitor can start: template, frame, saved session. */
function useBooth(templateId: string) {
  const [booth, setBooth] = useState<Booth | null>(null);
  const [problem, setProblem] = useState<{ message: string; details: string[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBooth(null);
    setProblem(null);
    (async () => {
      const template = await templateRegistry.load(templateId);
      const engine = new FrameEngine((path) => templateRegistry.assetUrl(template.id, path));
      // Validate the frame now, so broken artwork is caught before anyone queues up.
      const frame = await new FrameRegistry(template, engine, templateOutputSize(template)).activate();
      const store = createSessionStore({ templateId: template.id, defaultLocale: template.defaultLocale });
      await store.getState().hydrate();
      if (!cancelled) setBooth({ template, frame, store });
    })().catch((error: Error) => {
      if (cancelled) return;
      const details =
        error instanceof TemplateLoadError ? error.issues : error instanceof FrameError ? error.validation.errors : [];
      setProblem({ message: error.message, details });
    });
    return () => {
      cancelled = true;
    };
  }, [templateId]);

  return { booth, problem };
}

/** The visitor-facing kiosk for one template. Contains no admin controls or links. */
export function KioskPage() {
  const { templateId = '' } = useParams();
  const { booth, problem } = useBooth(templateId);

  if (problem) {
    return (
      <main className="mx-auto flex h-full max-w-xl flex-col justify-center gap-4 px-6">
        <h1 className="text-2xl font-semibold">This booth is not available</h1>
        <p className="text-muted">{problem.message}</p>
        {problem.details.length > 0 && (
          <ul className="list-disc pl-5 font-mono text-sm text-warn">
            {problem.details.map((detail) => (
              <li key={detail}>{detail}</li>
            ))}
          </ul>
        )}
      </main>
    );
  }
  if (!booth) return <main className="grid h-full place-items-center text-muted">Loading…</main>;
  return <Kiosk key={booth.template.id} {...booth} />;
}

function Kiosk({ template, frame, store }: Booth) {
  const session = useStore(store, (state) => state.session);
  const captureImage = useStore(store, (state) => state.captureImage);
  const [strings, setStrings] = useState<LocaleStrings>({});
  const [finalImage, setFinalImage] = useState<Blob | null>(null);
  const rootRef = useRef<HTMLElement>(null);

  const send = useCallback((event: SessionEvent) => store.getState().send(event), [store]);
  const assetUrl = useCallback((path: string) => templateRegistry.assetUrl(template.id, path), [template.id]);

  // Locale strings. A failed load falls back to the built-in English copy.
  useEffect(() => {
    let cancelled = false;
    templateRegistry
      .loadLocale(template.id, session.locale)
      .then((loaded) => !cancelled && setStrings(loaded))
      .catch(() => !cancelled && setStrings({}));
    document.documentElement.lang = session.locale;
    return () => {
      cancelled = true;
    };
  }, [template.id, session.locale]);
  const t = useMemo(() => createTranslate(strings), [strings]);

  // Keep the screen awake while the kiosk is open (best effort; see WakeLock.ts).
  useEffect(() => {
    const wakeLock = new WakeLockController();
    void wakeLock.enable();
    return () => void wakeLock.disable();
  }, []);

  // Reset abandoned sessions. Idle never counts while the booth itself is working.
  const idleRef = useRef<IdleTimer>(null);
  useEffect(() => {
    const timer = new IdleTimer(template.session.idleResetSeconds * 1000, () => send({ type: 'RESET' }));
    idleRef.current = timer;
    const detach = watchActivity(window, timer);
    return () => {
      detach();
      timer.stop();
    };
  }, [template.session.idleResetSeconds, send]);
  const waiting = session.stage === 'welcome' || isBusy(session);
  useEffect(() => {
    const timer = idleRef.current;
    if (!timer) return;
    if (waiting) timer.stop();
    else timer.start();
  }, [waiting, session.stage]);

  // The rendered photo lives only as long as its session.
  useEffect(() => {
    if (session.stage === 'welcome') setFinalImage(null);
  }, [session.stage]);

  const ctx: KioskContext = { template, frame, t, session, store, send, assetUrl };

  return (
    <main
      ref={rootRef}
      style={themeStyle(template)}
      className="h-full w-full touch-manipulation overflow-hidden select-none"
      onContextMenu={(event) => event.preventDefault()}
    >
      {session.stage === 'welcome' && <WelcomeStage ctx={ctx} onLocale={(locale) => send({ type: 'SET_LOCALE', locale })} />}
      {session.stage === 'instructions' && <InstructionsStage ctx={ctx} />}
      {session.stage === 'camera' && <CameraStage ctx={ctx} />}
      {session.stage === 'review' && <ReviewStage ctx={ctx} image={captureImage} />}
      {session.stage === 'background' && <BackgroundStage ctx={ctx} />}
      {session.stage === 'processing' && <ProcessingStage ctx={ctx} capture={captureImage} onFinal={setFinalImage} />}
      {session.stage === 'result' && <ResultStage ctx={ctx} finalImage={finalImage} />}
      {session.stage === 'complete' && <CompleteStage ctx={ctx} />}
    </main>
  );
}
