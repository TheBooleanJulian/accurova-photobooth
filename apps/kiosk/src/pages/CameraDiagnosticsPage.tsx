import type { CaptureMethod, CaptureRecord, QualityVerdict } from '@accurova/shared-types';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  CameraManager,
  CameraPreview,
  DEFAULT_QUALITY_POLICY,
  ImageCaptureProvider,
  NativeCaptureProvider,
  RESOLUTION_PRESETS,
  StreamCaptureProvider,
  detectCanvasMimeTypes,
  detectEnvironment,
  evaluateQuality,
  listCameras,
  probeStreamResolutions,
  selectProvider,
  toCameraError,
  toCaptureRecord,
  type CameraCapabilities,
  type CameraCaptureProvider,
  type CameraDeviceInfo,
  type EnvironmentReport,
  type FacingMode,
  type ProbeResult,
  type ProviderOverride,
  type StreamInfo,
  type StreamRequest,
} from '../features/camera';
import { downloadBlob, extensionFor, formatBytes } from '../utils/format';

const OVERRIDE_KEY = 'photobooth.captureProviderOverride';
const METHOD_LABEL: Record<CaptureMethod, string> = {
  imagecapture: 'ImageCapture (still photo)',
  stream: 'Stream frame',
  native: 'Native camera (manual)',
};

interface CaptureEntry {
  id: number;
  record: CaptureRecord;
  verdict: QualityVerdict;
  blob: Blob;
  url: string;
  metadata?: Record<string, unknown>;
}

interface LogEntry {
  at: string;
  message: string;
}

function readOverride(): ProviderOverride {
  try {
    const v = localStorage.getItem(OVERRIDE_KEY);
    return v === 'imagecapture' || v === 'stream' || v === 'native' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function CameraDiagnosticsPage() {
  const managerRef = useRef<CameraManager>(null);
  managerRef.current ??= new CameraManager();
  const manager = managerRef.current;
  const videoRef = useRef<HTMLVideoElement>(null);
  const wantRunning = useRef(false);
  const nextId = useRef(1);

  const [env, setEnv] = useState<EnvironmentReport | null>(null);
  const [mimeTypes, setMimeTypes] = useState<string[]>([]);
  const [devices, setDevices] = useState<CameraDeviceInfo[]>([]);
  const [facing, setFacing] = useState<FacingMode>('user');
  const [deviceId, setDeviceId] = useState('');
  const [presetIndex, setPresetIndex] = useState(0);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [streamInfo, setStreamInfo] = useState<StreamInfo | null>(null);
  const [frameSize, setFrameSize] = useState<{ width: number; height: number } | null>(null);
  const [capabilities, setCapabilities] = useState<CameraCapabilities[]>([]);
  const [override, setOverride] = useState<ProviderOverride>(readOverride);
  const [probes, setProbes] = useState<ProbeResult[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [captures, setCaptures] = useState<CaptureEntry[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [copied, setCopied] = useState(false);

  const addLog = useCallback((message: string) => {
    setLog((entries) => [...entries.slice(-99), { at: new Date().toISOString(), message }]);
  }, []);

  const providers = useMemo<Record<CaptureMethod, CameraCaptureProvider>>(
    () => ({
      imagecapture: new ImageCaptureProvider(manager),
      stream: new StreamCaptureProvider(manager, () => videoRef.current),
      native: new NativeCaptureProvider({ facing }),
    }),
    [manager, facing],
  );

  const refreshCapabilities = useCallback(async () => {
    await providers.imagecapture.initialize();
    setCapabilities(await Promise.all(Object.values(providers).map((p) => p.getCapabilities())));
  }, [providers]);

  const refreshEnvironment = useCallback(async () => {
    setEnv(await detectEnvironment());
    setDevices(await listCameras());
  }, []);

  const currentRequest = useCallback((): StreamRequest => {
    const preset = RESOLUTION_PRESETS[presetIndex] ?? RESOLUTION_PRESETS[0]!;
    return { facingMode: facing, deviceId: deviceId || undefined, width: preset.width, height: preset.height };
  }, [facing, deviceId, presetIndex]);

  const start = useCallback(
    async (request: StreamRequest) => {
      setError(null);
      setBusy('Starting camera…');
      wantRunning.current = true;
      try {
        const info = await manager.start(request);
        setStream(manager.getStream());
        setStreamInfo(info);
        addLog(`Stream started: ${info.width}×${info.height} (${info.label || 'unlabelled camera'})`);
        await refreshEnvironment();
      } catch (e) {
        const err = toCameraError(e);
        if (err.code !== 'interrupted') {
          wantRunning.current = false;
          setStream(null);
          setStreamInfo(null);
          setError(`${err.code}: ${err.message}`);
          addLog(`Start failed: ${err.code}`);
        }
      } finally {
        setBusy(null);
      }
    },
    [manager, addLog, refreshEnvironment],
  );

  const stop = useCallback(() => {
    wantRunning.current = false;
    manager.stop();
    setStream(null);
    setStreamInfo(null);
    setFrameSize(null);
    addLog('Stream stopped');
  }, [manager, addLog]);

  // Initial detection.
  useEffect(() => {
    void refreshEnvironment();
    void detectCanvasMimeTypes().then(setMimeTypes);
  }, [refreshEnvironment]);

  useEffect(() => {
    void refreshCapabilities();
  }, [refreshCapabilities, stream]);

  // Track events + tab visibility: Safari suspends cameras in the background.
  useEffect(() => {
    const recover = () => {
      if (wantRunning.current && !manager.isLive() && document.visibilityState === 'visible') {
        addLog('Camera not live while visible: restarting');
        void start(currentRequest());
      }
    };
    const off = manager.onEvent((event) => {
      addLog(`Track event: ${event}`);
      if (event === 'ended') recover();
    });
    const onVisibility = () => {
      addLog(`Visibility: ${document.visibilityState}`);
      recover();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      off();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [manager, addLog, start, currentRequest]);

  // Always release the camera when leaving the page.
  useEffect(() => () => manager.stop(), [manager]);
  const capturesRef = useRef(captures);
  capturesRef.current = captures;
  useEffect(() => () => capturesRef.current.forEach((c) => URL.revokeObjectURL(c.url)), []);

  // The real frame size (it swaps on rotation), read from the <video> itself.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const update = () => {
      if (video.videoWidth) setFrameSize({ width: video.videoWidth, height: video.videoHeight });
      setStreamInfo(manager.getInfo());
    };
    video.addEventListener('loadedmetadata', update);
    video.addEventListener('resize', update);
    return () => {
      video.removeEventListener('loadedmetadata', update);
      video.removeEventListener('resize', update);
    };
  }, [manager]);

  const runCapture = async (method: CaptureMethod) => {
    setError(null);
    setBusy(`Capturing with ${METHOD_LABEL[method]}…`);
    const started = performance.now();
    try {
      const image = await providers[method].capture();
      const record = toCaptureRecord(image, performance.now() - started);
      const entry: CaptureEntry = {
        id: nextId.current++,
        record,
        verdict: evaluateQuality(image.width, image.height),
        blob: image.blob,
        url: URL.createObjectURL(image.blob),
        metadata: image.metadata,
      };
      setCaptures((list) => [entry, ...list]);
      addLog(`Captured ${record.width}×${record.height} via ${method} in ${record.latencyMs} ms`);
    } catch (e) {
      const err = toCameraError(e);
      setError(`${METHOD_LABEL[method]} failed — ${err.code}: ${err.message}`);
      addLog(`Capture failed (${method}): ${err.code}`);
    } finally {
      setBusy(null);
    }
  };

  const runProbe = async () => {
    setError(null);
    const resume = wantRunning.current;
    wantRunning.current = false;
    setStream(null);
    try {
      const base: StreamRequest = { facingMode: facing, deviceId: deviceId || undefined };
      const results = await probeStreamResolutions(manager, base, RESOLUTION_PRESETS, (done, total) =>
        setBusy(`Probing resolutions ${done}/${total}…`),
      );
      setProbes(results);
      addLog(`Probed ${results.length} resolutions`);
    } finally {
      setBusy(null);
      setStreamInfo(null);
      if (resume) await start(currentRequest());
    }
  };

  const changeOverride = (value: ProviderOverride) => {
    setOverride(value);
    try {
      localStorage.setItem(OVERRIDE_KEY, value);
    } catch {
      // Private browsing: the override then lasts for this page only.
    }
  };

  const selection = useMemo(() => selectProvider(capabilities, override), [capabilities, override]);

  const report = useMemo(
    () => ({
      reportVersion: 1,
      generatedAt: new Date().toISOString(),
      origin: location.origin,
      qualityPolicy: DEFAULT_QUALITY_POLICY,
      environment: env,
      canvasMimeTypes: mimeTypes,
      cameras: devices,
      stream: streamInfo && { ...streamInfo, previewFrame: frameSize },
      resolutionProbe: probes,
      providers: capabilities,
      selection: { ...selection, override },
      captures: captures.map((c) => ({ ...c.record, verdict: c.verdict, metadata: c.metadata })),
      events: log,
    }),
    [env, mimeTypes, devices, streamInfo, frameSize, probes, capabilities, selection, override, captures, log],
  );
  const reportJson = useMemo(() => JSON.stringify(report, null, 2), [report]);

  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(reportJson);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Copy was blocked by the browser. Use “Download report” instead.');
    }
  };

  // Hand the report to the system share sheet (AirDrop, Mail, Messages, Notes…).
  const canShare = typeof navigator.share === 'function';
  const shareReport = async () => {
    try {
      await navigator.share({ title: 'Camera diagnostics report', text: reportJson });
    } catch (e) {
      if ((e as { name?: string }).name !== 'AbortError') setError('Sharing failed. Take a screenshot of the summary instead.');
    }
  };

  // The few numbers that decide the capture strategy, short enough to read out or photograph.
  const best = captures.reduce<CaptureEntry | null>(
    (top, c) => (!top || c.record.width * c.record.height > top.record.width * top.record.height ? c : top),
    null,
  );
  const probeMax = probes.reduce((top, p) => (p.width * p.height > top.width * top.height ? p : top), {
    width: 0,
    height: 0,
  } as { width: number; height: number });
  const summary = [
    `Use: ${selection.method ?? 'none'}`,
    `ImageCapture: ${env?.hasImageCapture ? 'yes' : 'no'}`,
    `Stream: ${frameSize ? `${frameSize.width}×${frameSize.height}` : 'not started'}`,
    `Probe max: ${probeMax.width ? `${probeMax.width}×${probeMax.height}` : 'not run'}`,
    `Best capture: ${best ? `${best.record.width}×${best.record.height} ${best.record.captureMethod}` : 'none yet'}`,
    `Camera: ${streamInfo?.facingMode ?? facing}`,
    env?.deviceHint ?? '',
  ]
    .filter(Boolean)
    .join(' · ');

  const running = stream !== null;
  const cap = (method: CaptureMethod) => capabilities.find((c) => c.method === method);

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link to="/" className="text-sm text-muted underline-offset-4 hover:underline">
            ← Photobooth
          </Link>
          <h1 className="mt-1 text-3xl font-semibold">Camera diagnostics</h1>
          <p className="mt-1 max-w-2xl text-muted">
            Measures what this device and browser really deliver. Every number below is read back from the browser or
            the captured file, never assumed.
          </p>
        </div>
        <div className="flex gap-2">
          {canShare && <Button onClick={shareReport}>Share report</Button>}
          <Button onClick={copyReport}>{copied ? 'Copied ✓' : 'Copy report'}</Button>
          <Button
            onClick={() =>
              downloadBlob(new Blob([reportJson], { type: 'application/json' }), `camera-report-${Date.now()}.json`)
            }
          >
            Download report
          </Button>
        </div>
      </header>

      <section className="rounded-2xl border border-accent/50 bg-panel p-4">
        <h2 className="mb-2 text-sm tracking-widest text-muted uppercase">Summary (screenshot this if you can’t export)</h2>
        <p className="font-mono text-base leading-relaxed select-all sm:text-lg">{summary}</p>
      </section>

      {error && (
        <p role="alert" className="rounded-xl border border-bad/60 bg-bad/10 px-4 py-3 text-bad">
          {error}
        </p>
      )}
      {busy && <p className="rounded-xl border border-line bg-panel px-4 py-3 text-warn">{busy}</p>}

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="1 · Camera">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Facing">
              <select
                value={facing}
                onChange={(e) => {
                  setFacing(e.target.value as FacingMode);
                  setDeviceId('');
                }}
                className={selectClass}
              >
                <option value="user">Front (visitor-facing)</option>
                <option value="environment">Rear</option>
              </select>
            </Field>
            <Field label="Device">
              <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)} className={selectClass}>
                <option value="">Choose by facing</option>
                {devices
                  .filter((d) => d.deviceId)
                  .map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Requested stream size" wide>
              <select
                value={presetIndex}
                onChange={(e) => setPresetIndex(Number(e.target.value))}
                className={selectClass}
              >
                {RESOLUTION_PRESETS.map((p, i) => (
                  <option key={p.label} value={i}>
                    {p.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button primary onClick={() => start(currentRequest())} disabled={busy !== null}>
              {running ? 'Restart stream' : 'Start camera'}
            </Button>
            <Button onClick={stop} disabled={!running}>
              Stop
            </Button>
            <Button onClick={runProbe} disabled={busy !== null}>
              Probe all sizes
            </Button>
          </div>

          <div className="mt-4 overflow-hidden rounded-xl border border-line bg-black">
            <CameraPreview
              ref={videoRef}
              stream={stream}
              mirrored={streamInfo?.facingMode ? streamInfo.facingMode === 'user' : facing === 'user'}
              className={`mx-auto max-h-[60vh] w-full object-contain ${running ? 'block' : 'hidden'}`}
            />
            {!running && <p className="px-4 py-10 text-center text-muted">Camera is off.</p>}
          </div>

          {streamInfo && (
            <Table
              rows={[
                ['Camera', streamInfo.label || '—'],
                ['Track settings', `${streamInfo.width} × ${streamInfo.height}`],
                ['Frame as displayed', frameSize ? `${frameSize.width} × ${frameSize.height}` : '—'],
                ['Frame rate', streamInfo.frameRate ? `${Math.round(streamInfo.frameRate)} fps` : '—'],
                ['Facing (reported)', streamInfo.facingMode ?? 'not reported'],
                [
                  'Track maximum',
                  streamInfo.maxWidth && streamInfo.maxHeight
                    ? `${streamInfo.maxWidth} × ${streamInfo.maxHeight}`
                    : 'not exposed',
                ],
              ]}
            />
          )}
        </Section>

        <Section title="2 · Capture tests">
          <p className="text-muted">
            Targets: longest edge ≥ {DEFAULT_QUALITY_POLICY.preferredLongestEdge}px preferred, ≥{' '}
            {DEFAULT_QUALITY_POLICY.minimumLongestEdge}px minimum.
          </p>
          <div className="mt-3 flex flex-col gap-2">
            {(['imagecapture', 'stream', 'native'] as const).map((method) => {
              const c = cap(method);
              return (
                <div key={method} className="rounded-xl border border-line p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">{METHOD_LABEL[method]}</p>
                      <p className="text-sm text-muted">
                        {c?.supported ? 'Available' : 'Unavailable'}
                        {c?.maxWidth && c.maxHeight ? ` · reports up to ${c.maxWidth} × ${c.maxHeight}` : ''}
                      </p>
                    </div>
                    <Button onClick={() => runCapture(method)} disabled={!c?.supported || busy !== null}>
                      Capture
                    </Button>
                  </div>
                  {c?.note && <p className="mt-2 text-sm text-muted">{c.note}</p>}
                </div>
              );
            })}
          </div>

          <div className="mt-4 rounded-xl border border-line bg-ink p-3">
            <p className="text-sm tracking-widest text-muted uppercase">Kiosk would use</p>
            <p className="mt-1 text-lg font-medium">{selection.method ? METHOD_LABEL[selection.method] : 'Nothing'}</p>
            <p className="text-sm text-muted">{selection.reason}</p>
            <Field label="Administrator override">
              <select
                value={override}
                onChange={(e) => changeOverride(e.target.value as ProviderOverride)}
                className={selectClass}
              >
                <option value="auto">Automatic (recommended)</option>
                <option value="imagecapture">Force ImageCapture</option>
                <option value="stream">Force stream frame</option>
                <option value="native">Force native camera (manual)</option>
              </select>
            </Field>
          </div>
        </Section>
      </div>

      {captures.length > 0 && (
        <Section title={`3 · Captures (${captures.length})`}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {captures.map((c) => (
              <article key={c.id} className="overflow-hidden rounded-xl border border-line">
                <img src={c.url} alt={`Capture ${c.id}`} className="max-h-72 w-full bg-black object-contain" />
                <div className="p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium">
                      {c.record.width} × {c.record.height}
                    </p>
                    <Verdict verdict={c.verdict} />
                  </div>
                  <Table
                    rows={[
                      ['Method', METHOD_LABEL[c.record.captureMethod]],
                      ['Native still', c.record.nativeStill ? 'Yes' : 'No — video frame'],
                      ['Megapixels', `${c.record.megapixels} MP`],
                      ['File', `${formatBytes(c.record.fileSize)} · ${c.record.mimeType}`],
                      ['Latency', `${c.record.latencyMs} ms`],
                    ]}
                  />
                  <Button
                    onClick={() =>
                      downloadBlob(
                        c.blob,
                        `capture-${c.record.captureMethod}-${c.record.width}x${c.record.height}.${extensionFor(c.record.mimeType)}`,
                      )
                    }
                  >
                    Download original
                  </Button>
                </div>
              </article>
            ))}
          </div>
        </Section>
      )}

      {probes.length > 0 && (
        <Section title="Stream resolution probe">
          <Table
            head={['Requested', 'Delivered']}
            rows={probes.map((p) => [
              p.requested,
              p.error ? p.error : `${p.width} × ${p.height}${p.frameRate ? ` @ ${Math.round(p.frameRate)} fps` : ''}`,
            ])}
          />
        </Section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Device and browser">
          {env ? (
            <Table
              rows={[
                ['Device hint', env.deviceHint],
                ['Secure context (HTTPS)', yesNo(env.secureContext)],
                ['getUserMedia', yesNo(env.hasGetUserMedia)],
                ['ImageCapture API', yesNo(env.hasImageCapture)],
                ['Native capture input', yesNo(env.hasNativeCaptureInput)],
                ['Camera permission', env.cameraPermission],
                ['Wake Lock API', yesNo(env.hasWakeLock)],
                ['Installed app mode', yesNo(env.standalone)],
                ['Canvas encoders', mimeTypes.join(', ') || '—'],
                ['Screen', `${env.screen.width} × ${env.screen.height} @ ${env.screen.devicePixelRatio}x`],
                ['Orientation', env.orientation],
                ['Platform', `${env.platform} · ${env.maxTouchPoints} touch points`],
                ['User agent', env.userAgent],
              ]}
            />
          ) : (
            <p className="text-muted">Detecting…</p>
          )}
        </Section>

        <Section title="Cameras and event log">
          <Table
            rows={
              devices.length
                ? devices.map((d, i) => [`Camera ${i + 1}`, `${d.label}${d.facing ? ` · ${d.facing}` : ''}`])
                : [['Cameras', 'None listed']]
            }
          />
          <ol className="mt-3 max-h-56 overflow-y-auto rounded-lg bg-ink p-3 font-mono text-xs text-muted">
            {log.length === 0 && <li>No events yet.</li>}
            {log.map((entry, i) => (
              <li key={i}>
                {entry.at.slice(11, 19)} {entry.message}
              </li>
            ))}
          </ol>
        </Section>
      </div>
    </main>
  );
}

const selectClass = 'min-h-12 w-full rounded-lg border border-line bg-ink px-3 text-paper';
const yesNo = (value: boolean) => (value ? 'Yes' : 'No');

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-panel p-4 sm:p-5">
      <h2 className="mb-3 text-sm tracking-widest text-muted uppercase">{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <label className={`mt-2 flex flex-col gap-1 text-sm text-muted ${wide ? 'col-span-2' : ''}`}>
      {label}
      {children}
    </label>
  );
}

function Button({
  children,
  onClick,
  disabled,
  primary,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`min-h-12 rounded-lg px-4 font-medium disabled:opacity-40 ${
        primary ? 'bg-accent text-ink' : 'border border-line bg-ink text-paper'
      }`}
    >
      {children}
    </button>
  );
}

function Table({ rows, head }: { rows: Array<[string, string]>; head?: [string, string] }) {
  return (
    <table className="my-3 w-full text-left text-sm">
      {head && (
        <thead>
          <tr className="text-muted">
            <th className="py-1.5 pr-3 font-normal">{head[0]}</th>
            <th className="py-1.5 font-normal">{head[1]}</th>
          </tr>
        </thead>
      )}
      <tbody>
        {rows.map(([key, value], i) => (
          <tr key={`${key}-${i}`} className="border-t border-line align-top">
            <td className="py-1.5 pr-3 whitespace-nowrap text-muted">{key}</td>
            <td className="py-1.5 font-mono break-all">{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Verdict({ verdict }: { verdict: QualityVerdict }) {
  const style = {
    preferred: ['Meets preferred', 'border-good/60 text-good'],
    acceptable: ['Meets minimum', 'border-warn/60 text-warn'],
    'below-minimum': ['Below minimum', 'border-bad/60 text-bad'],
  }[verdict] as [string, string];
  return <span className={`rounded-full border px-2.5 py-0.5 text-xs whitespace-nowrap ${style[1]}`}>{style[0]}</span>;
}
