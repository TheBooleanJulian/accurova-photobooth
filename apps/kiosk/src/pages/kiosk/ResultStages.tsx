import { useEffect, useMemo, useRef, useState } from 'react';
import { resolveBackground, selectableBackgrounds } from '../../features/backgrounds/BackgroundLibrary';
import { renderFinalImage } from '../../features/compositing/Compositor';
import { deliveryLink, deliveryQrSvg } from '../../features/delivery/qr';
import { PipelineError, runPipeline, type PipelineStep } from '../../features/processing/pipeline';
import { ApiError, api } from '../../services/api';
import { KioskButton, Screen, Spinner, Title, type KioskContext } from './ui';

export function BackgroundStage({ ctx }: { ctx: KioskContext }) {
  const { template, t, session, send, assetUrl } = ctx;
  const backgrounds = useMemo(() => selectableBackgrounds(template), [template]);

  // Nothing chosen yet (or the choice was disabled since): start on the first one.
  useEffect(() => {
    if (!backgrounds.some((b) => b.id === session.backgroundId) && backgrounds[0]) {
      send({ type: 'SELECT_BACKGROUND', backgroundId: backgrounds[0].id });
    }
  }, [backgrounds, session.backgroundId, send]);

  return (
    <Screen className="justify-between gap-6">
      <Title>{t('background.title')}</Title>
      <div className="grid min-h-0 w-full max-w-4xl flex-1 grid-cols-3 content-center gap-4 overflow-y-auto p-1">
        {backgrounds.map((background) => {
          const selected = background.id === session.backgroundId;
          return (
            <button
              key={background.id}
              type="button"
              aria-pressed={selected}
              onClick={() => send({ type: 'SELECT_BACKGROUND', backgroundId: background.id })}
              className={`relative overflow-hidden rounded-2xl transition-transform active:scale-[0.98] ${
                selected ? 'ring-[6px] ring-[var(--k-primary)]' : 'opacity-80'
              }`}
            >
              <img
                src={assetUrl(background.thumbnail)}
                alt={background.name}
                className="aspect-[3/4] w-full object-cover"
                loading="lazy"
              />
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-3 pt-8 pb-3 text-lg font-medium text-white">
                {background.name}
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap justify-center gap-5">
        <KioskButton variant="secondary" onClick={() => send({ type: 'BACK' })}>
          {t('background.back')}
        </KioskButton>
        <KioskButton onClick={() => send({ type: 'CONFIRM_BACKGROUND' })} disabled={!session.backgroundId}>
          {t('background.confirm')}
        </KioskButton>
      </div>
    </Screen>
  );
}

interface ProcessingProps {
  ctx: KioskContext;
  capture: Blob | null;
  onFinal: (image: Blob) => void;
}

export function ProcessingStage({ ctx, capture, onFinal }: ProcessingProps) {
  const { template, frame, t, session, send, assetUrl } = ctx;
  const [step, setStep] = useState<PipelineStep>('session');
  const failed = session.error !== null;
  // Read once per run: ids arriving mid-run must not restart the pipeline.
  const sessionIdRef = useRef(session.sessionId);
  sessionIdRef.current = session.sessionId;

  useEffect(() => {
    if (failed) return;
    if (!capture) {
      send({ type: 'FAILED', error: { code: 'processing', retryable: false, retake: true } });
      return;
    }
    const controller = new AbortController();
    runPipeline(
      {
        template,
        background: resolveBackground(template, session.backgroundId),
        frame,
        capture,
        sessionId: sessionIdRef.current,
        signal: controller.signal,
        onProgress: setStep,
        onSession: (sessionId) => send({ type: 'SESSION_CREATED', sessionId }),
        onJob: (jobId) => send({ type: 'JOB_STARTED', jobId }),
      },
      {
        api,
        decodeForeground: async (image) => {
          const bitmap = await createImageBitmap(image);
          return { source: bitmap, width: bitmap.width, height: bitmap.height };
        },
        render: (request) => renderFinalImage(request, { assetUrl }),
      },
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        onFinal(result.final.blob);
        send({ type: 'DELIVERED', token: result.delivery.token, expiresAt: result.delivery.expiresAt });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || (error instanceof ApiError && error.code === 'aborted')) return;
        const sessionError =
          error instanceof PipelineError
            ? error.sessionError
            : ({ code: 'processing', retryable: true, retake: false } as const);
        send({ type: 'FAILED', error: sessionError });
      });
    return () => controller.abort();
    // The pipeline restarts only when a failure is cleared (RETRY) or its inputs change.
  }, [failed, capture, template, frame, session.backgroundId, send, assetUrl, onFinal]);

  if (session.error) {
    const { code, retryable, retake } = session.error;
    return (
      <Screen className="justify-center gap-12">
        <p role="alert" className="max-w-2xl text-3xl leading-snug">
          {t(`error.${code}`) || t('error.generic')}
        </p>
        <div className="flex flex-col items-center gap-4">
          {retryable && <KioskButton onClick={() => send({ type: 'RETRY' })}>{t('action.retry')}</KioskButton>}
          {retake && <KioskButton onClick={() => send({ type: 'RETAKE' })}>{t('action.retake')}</KioskButton>}
          <KioskButton variant={retryable || retake ? 'quiet' : 'primary'} onClick={() => send({ type: 'RESET' })}>
            {t('action.startOver')}
          </KioskButton>
        </div>
      </Screen>
    );
  }

  return (
    <Screen className="justify-center gap-12">
      <Spinner />
      <div className="flex flex-col gap-4">
        <Title>{t('processing.title')}</Title>
        <p className="text-2xl opacity-70" aria-live="polite">
          {t(`processing.${step}`)}
        </p>
      </div>
    </Screen>
  );
}

export function ResultStage({ ctx, finalImage }: { ctx: KioskContext; finalImage: Blob | null }) {
  const { template, t, session, send } = ctx;
  const token = session.delivery?.token ?? '';
  const [qr, setQr] = useState('');
  const [localUrl, setLocalUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const { text, surface } = template.branding.colors;
    void deliveryQrSvg(deliveryLink(token), { dark: text, light: surface }).then((svg) => !cancelled && setQr(svg));
    return () => {
      cancelled = true;
    };
  }, [token, template]);

  useEffect(() => {
    if (!finalImage) return;
    const objectUrl = URL.createObjectURL(finalImage);
    setLocalUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [finalImage]);

  // After a reload the rendered image is gone from memory; show the delivered one instead.
  const imageUrl = localUrl ?? (token ? api.downloadUrl(token) : null);

  return (
    <Screen className="justify-between gap-6">
      <Title>{t('result.title')}</Title>
      <div className="flex min-h-0 w-full flex-1 items-center justify-center gap-10">
        {imageUrl && <img src={imageUrl} alt="" className="h-full max-w-[55%] rounded-xl object-contain shadow-2xl" />}
        <div className="flex max-w-[38%] flex-col items-center gap-5">
          {/* Generated locally by the QR library from the delivery link: trusted markup. */}
          <div
            className="w-full max-w-72 overflow-hidden rounded-2xl bg-[var(--k-surface)] p-3 shadow-lg [&>svg]:h-auto [&>svg]:w-full"
            dangerouslySetInnerHTML={{ __html: qr }}
          />
          <p className="text-xl leading-snug opacity-75">{t('result.expiry')}</p>
        </div>
      </div>
      <KioskButton onClick={() => send({ type: 'DONE' })}>{t('result.done')}</KioskButton>
    </Screen>
  );
}

export function CompleteStage({ ctx, resetAfterMs = 7000 }: { ctx: KioskContext; resetAfterMs?: number }) {
  const { t, session, send } = ctx;

  useEffect(() => {
    // Best effort: the download link works whether or not this call succeeds.
    if (session.sessionId) void api.completeSession(session.sessionId).catch(() => undefined);
    const timer = setTimeout(() => send({ type: 'RESET' }), resetAfterMs);
    return () => clearTimeout(timer);
  }, [session.sessionId, send, resetAfterMs]);

  return (
    <Screen className="justify-center gap-8">
      <Title>{t('complete.title')}</Title>
      <p className="max-w-xl text-2xl leading-snug opacity-75">{t('complete.note')}</p>
      <KioskButton variant="secondary" onClick={() => send({ type: 'RESET' })}>
        {t('action.startOver')}
      </KioskButton>
    </Screen>
  );
}
