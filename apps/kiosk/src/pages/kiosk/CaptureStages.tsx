import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CameraManager,
  CameraPreview,
  ImageCaptureProvider,
  StreamCaptureProvider,
  evaluateQuality,
  selectProvider,
  toCameraError,
  toCaptureRecord,
  type CameraCaptureProvider,
} from '../../features/camera';
import { LOCALE_NAMES } from '../../features/i18n/strings';
import { KioskButton, PositioningGuide, Screen, Title, type KioskContext } from './ui';

/** Formats the API accepts as an original capture. Anything else falls back to a stream frame. */
const UPLOADABLE = new Set(['image/jpeg', 'image/png']);

export function WelcomeStage({ ctx, onLocale }: { ctx: KioskContext; onLocale: (locale: string) => void }) {
  const { template, t, session, send, assetUrl } = ctx;
  return (
    <Screen className="justify-between">
      <div className="flex w-full justify-end gap-3" aria-label={t('welcome.language')}>
        {template.locales.length > 1 &&
          template.locales.map((locale) => (
            <button
              key={locale}
              type="button"
              onClick={() => onLocale(locale)}
              aria-pressed={locale === session.locale}
              className={`min-h-14 rounded-full border-2 border-[var(--k-primary)] px-7 text-xl ${
                locale === session.locale ? 'bg-[var(--k-primary)] text-[var(--k-surface)]' : 'text-[var(--k-primary)]'
              }`}
            >
              {LOCALE_NAMES[locale] ?? locale}
            </button>
          ))}
      </div>

      <div className="flex flex-col items-center gap-14">
        <img src={assetUrl(template.branding.logo)} alt={template.name} className="w-[min(78vw,36rem)]" />
        <KioskButton onClick={() => send({ type: 'START', at: Date.now() })} className="min-h-24 min-w-72 text-3xl">
          {t('welcome.start')}
        </KioskButton>
      </div>

      <p className="max-w-2xl text-base leading-relaxed opacity-70">{t('welcome.privacy')}</p>
    </Screen>
  );
}

export function InstructionsStage({ ctx }: { ctx: KioskContext }) {
  const { t, send } = ctx;
  return (
    <Screen className="justify-between">
      <Title>{t('instructions.title')}</Title>
      <div className="flex flex-col items-center gap-8">
        <div className="relative h-[38vh] w-[28vh] rounded-3xl bg-[var(--k-text)]/85">
          <PositioningGuide />
        </div>
        <ul className="flex max-w-xl flex-col gap-3 text-2xl leading-snug">
          <li>{t('instructions.stand')}</li>
          <li>{t('instructions.fullBody')}</li>
        </ul>
      </div>
      <div className="flex flex-col items-center gap-3">
        <KioskButton onClick={() => send({ type: 'READY' })}>{t('instructions.continue')}</KioskButton>
        <KioskButton variant="quiet" onClick={() => send({ type: 'BACK' })} className="min-h-14 text-xl">
          {t('instructions.back')}
        </KioskButton>
      </div>
    </Screen>
  );
}

type CameraPhase = 'starting' | 'ready' | 'countdown' | 'capturing' | 'error';

export function CameraStage({ ctx }: { ctx: KioskContext }) {
  const { template, t, send, store } = ctx;
  const managerRef = useRef<CameraManager>(null);
  managerRef.current ??= new CameraManager();
  const manager = managerRef.current;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [phase, setPhase] = useState<CameraPhase>('starting');
  const [frameSize, setFrameSize] = useState<{ width: number; height: number } | null>(null);
  const hasFrame = frameSize !== null;
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const measure = () => setStageSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // The picture's on-screen rectangle (object-fit: contain), so the outline sits on the video.
  const box =
    frameSize && stageSize
      ? (() => {
          const scale = Math.min(stageSize.width / frameSize.width, stageSize.height / frameSize.height);
          return { width: frameSize.width * scale, height: frameSize.height * scale };
        })()
      : null;
  const [count, setCount] = useState(0);
  const facing = template.capture.facingMode;

  const start = useCallback(async () => {
    setPhase('starting');
    setFrameSize(null);
    try {
      // Ask for the largest 4:3 mode; the browser delivers the closest it supports.
      await manager.start({ facingMode: facing, width: 4032, height: 3024 });
      setStream(manager.getStream());
      setPhase('ready');
    } catch (error) {
      if (toCameraError(error).code !== 'interrupted') {
        setStream(null);
        setPhase('error');
      }
    }
  }, [manager, facing]);

  useEffect(() => {
    void start();
    const recover = () => {
      // Safari stops the camera when the tab is hidden or the tablet sleeps.
      if (document.visibilityState === 'visible' && !manager.isLive()) void start();
    };
    const off = manager.onEvent((event) => event === 'ended' && recover());
    document.addEventListener('visibilitychange', recover);
    return () => {
      off();
      document.removeEventListener('visibilitychange', recover);
      manager.stop(); // always release the camera when leaving this screen
    };
  }, [manager, start]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    // The frame size can change on rotation; the guide follows the picture, not the screen.
    const ready = () => setFrameSize(video.videoWidth > 0 ? { width: video.videoWidth, height: video.videoHeight } : null);
    video.addEventListener('loadeddata', ready);
    video.addEventListener('resize', ready);
    return () => {
      video.removeEventListener('loadeddata', ready);
      video.removeEventListener('resize', ready);
    };
  }, []);

  const capture = useCallback(async () => {
    setPhase('capturing');
    try {
      const still = new ImageCaptureProvider(manager);
      await still.initialize();
      const frame = new StreamCaptureProvider(manager, () => videoRef.current);
      const capabilities = await Promise.all([still.getCapabilities(), frame.getCapabilities()]);
      // Native capture needs a person at the system camera UI, so the kiosk never uses it.
      const override = template.capture.providerOverride === 'native' ? 'auto' : template.capture.providerOverride;
      const selection = selectProvider(capabilities, override);
      if (!selection.method) throw new Error('No capture method is available');

      const take = async (provider: CameraCaptureProvider) => {
        const started = performance.now();
        const image = await provider.capture();
        return { image, latency: performance.now() - started };
      };
      let shot = await take(selection.method === 'imagecapture' ? still : frame);
      if (!UPLOADABLE.has(shot.image.mimeType) && selection.method === 'imagecapture') {
        // The still is in a format the pipeline cannot read (e.g. HEIC): use a stream
        // frame instead. It is recorded as `stream`, never passed off as a still.
        shot = await take(frame);
      }

      const { quality } = template.capture;
      const verdict = evaluateQuality(shot.image.width, shot.image.height, quality);
      if (verdict === 'below-minimum' && quality.belowMinimumPolicy === 'block') {
        throw new Error('The capture is below the minimum resolution for this template');
      }
      store.getState().setCapture(shot.image.blob, toCaptureRecord(shot.image, shot.latency));
    } catch {
      setPhase('error');
    }
  }, [manager, store, template.capture]);

  // Countdown: one tick per second, then the shutter.
  useEffect(() => {
    if (phase !== 'countdown') return;
    if (count <= 0) {
      void capture();
      return;
    }
    const timer = setTimeout(() => setCount((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [phase, count, capture]);

  const begin = () => {
    setCount(template.capture.countdownSeconds);
    setPhase('countdown');
  };

  return (
    <section className="relative h-full w-full overflow-hidden bg-black text-white">
      {/* A box with the picture's own aspect ratio, so the outline sits on the video, not on letterboxing. */}
      <div ref={stageRef} className="absolute inset-0 grid place-items-center">
        <div className="relative" style={box ?? { width: '100%', height: '100%' }}>
          <CameraPreview
            ref={videoRef}
            stream={stream}
            mirrored={facing === 'user'}
            className="absolute inset-0 h-full w-full object-contain"
          />
          {phase !== 'error' && hasFrame && <PositioningGuide />}
        </div>
      </div>

      {phase === 'starting' && (
        <p className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-2xl">{t('camera.starting')}</p>
      )}

      {phase === 'countdown' && (
        <div className="absolute inset-0 grid place-items-center" aria-live="assertive">
          <span key={count} className="animate-[ping_1s_ease-out_1] text-[14rem] leading-none font-semibold drop-shadow-lg">
            {count > 0 ? count : ''}
          </span>
          <span className="absolute text-[14rem] leading-none font-semibold drop-shadow-lg">{count > 0 ? count : ''}</span>
          <p className="absolute bottom-24 text-4xl font-medium drop-shadow">{t('camera.countdown')}</p>
        </div>
      )}

      {phase === 'capturing' && <div className="absolute inset-0 bg-white" />}

      {phase === 'ready' && (
        <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-5 bg-gradient-to-t from-black/70 to-transparent px-8 pt-24 pb-[max(2.5rem,env(safe-area-inset-bottom))]">
          <p className="text-2xl drop-shadow">{t('camera.guide')}</p>
          <button
            type="button"
            onClick={begin}
            disabled={!hasFrame}
            className="min-h-24 min-w-72 rounded-full bg-white px-12 text-3xl font-semibold text-black transition-transform active:scale-[0.97] disabled:opacity-40"
          >
            {t('camera.take')}
          </button>
        </div>
      )}

      {phase === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-10 px-10 text-center">
          <p className="max-w-xl text-3xl leading-snug">{t('error.camera')}</p>
          <button
            type="button"
            onClick={() => void start()}
            className="min-h-[4.5rem] min-w-56 rounded-full bg-white px-10 text-2xl font-semibold text-black"
          >
            {t('camera.retry')}
          </button>
          <button type="button" onClick={() => send({ type: 'RESET' })} className="min-h-14 text-xl opacity-80">
            {t('action.startOver')}
          </button>
        </div>
      )}
    </section>
  );
}

export function ReviewStage({ ctx, image }: { ctx: KioskContext; image: Blob | null }) {
  const { t, send } = ctx;
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!image) return;
    const objectUrl = URL.createObjectURL(image);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [image]);

  return (
    <Screen className="justify-between gap-6">
      <Title>{t('review.title')}</Title>
      <div className="min-h-0 flex-1">
        {url && <img src={url} alt="" className="h-full max-w-full rounded-2xl object-contain shadow-xl" />}
      </div>
      <div className="flex flex-wrap justify-center gap-5">
        <KioskButton variant="secondary" onClick={() => send({ type: 'RETAKE' })}>
          {t('review.retake')}
        </KioskButton>
        <KioskButton onClick={() => send({ type: 'CONFIRM_PHOTO' })}>{t('review.confirm')}</KioskButton>
      </div>
    </Screen>
  );
}
