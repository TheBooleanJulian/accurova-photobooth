import type { CompositeReport } from '@accurova/image-engine';
import type { TemplateConfig } from '@accurova/template-engine';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { selectableBackgrounds } from '../features/backgrounds/BackgroundLibrary';
import { renderFinalImage, templateOutputSize } from '../features/compositing/Compositor';
import { drawTestSubject, subjectFromCutout, type TestSubject } from '../features/compositing/testSubject';
import { FrameEngine, FrameError, FrameRegistry, type LoadedFrame } from '../features/frames';
import { templateRegistry } from '../features/templates/registry';
import { downloadBlob, formatBytes } from '../utils/format';

interface Rendered {
  url: string;
  blob: Blob;
  width: number;
  height: number;
  report: CompositeReport;
  ms: number;
}

/**
 * Administrator preview of the final image: background + visitor + frame +
 * sponsors, rendered by the same code the kiosk will use. The visitor here is
 * a drawn stand-in or an uploaded cut-out, never a live capture.
 */
export function ComposePreviewPage() {
  const [templates, setTemplates] = useState<Array<{ id: string; name: string }>>([]);
  const [templateId, setTemplateId] = useState('');
  const [template, setTemplate] = useState<TemplateConfig | null>(null);
  const [frame, setFrame] = useState<LoadedFrame | null>(null);
  const [frameId, setFrameId] = useState('');
  const [backgroundId, setBackgroundId] = useState('');
  const [subject, setSubject] = useState<TestSubject | null>(null);
  const [rendered, setRendered] = useState<Rendered | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const registryRef = useRef<FrameRegistry | null>(null);
  const lastUrl = useRef<string | null>(null);

  useEffect(() => {
    setSubject(drawTestSubject());
    templateRegistry
      .list()
      .then((index) => {
        const enabled = index.templates.filter((t) => t.enabled);
        setTemplates(enabled);
        setTemplateId((current) => current || enabled[0]?.id || '');
      })
      .catch((e: Error) => setProblems([e.message]));
    return () => {
      if (lastUrl.current) URL.revokeObjectURL(lastUrl.current);
    };
  }, []);

  // Load the template and activate its default frame.
  useEffect(() => {
    if (!templateId) return;
    let cancelled = false;
    setTemplate(null);
    setFrame(null);
    templateRegistry
      .load(templateId)
      .then(async (loaded) => {
        if (cancelled) return;
        const engine = new FrameEngine((path) => templateRegistry.assetUrl(loaded.id, path));
        registryRef.current = new FrameRegistry(loaded, engine, templateOutputSize(loaded));
        setTemplate(loaded);
        setBackgroundId(selectableBackgrounds(loaded)[0]?.id ?? '');
        setFrameId(loaded.defaultFrameId);
      })
      .catch((e: Error) => !cancelled && setProblems([e.message]));
    return () => {
      cancelled = true;
    };
  }, [templateId]);

  useEffect(() => {
    const registry = registryRef.current;
    if (!template || !frameId || !registry) return;
    let cancelled = false;
    registry
      .activate(frameId)
      .then((loaded) => {
        if (cancelled) return;
        setFrame(loaded);
        setProblems([]);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        // The registry keeps the last working frame; show why the new one was refused.
        setFrame(registry.current());
        setProblems(e instanceof FrameError ? e.validation.errors : [e.message]);
      });
    return () => {
      cancelled = true;
    };
  }, [template, frameId]);

  const backgrounds = useMemo(() => (template ? selectableBackgrounds(template) : []), [template]);
  const background = backgrounds.find((b) => b.id === backgroundId);

  // Re-render whenever an input changes.
  useEffect(() => {
    if (!template || !frame || !background || !subject) return;
    let cancelled = false;
    setBusy(true);
    const started = performance.now();
    renderFinalImage(
      { template, background, frame, foreground: subject.image, subjectBox: subject.subjectBox },
      { assetUrl: (path) => templateRegistry.assetUrl(template.id, path) },
    )
      .then((result) => {
        if (cancelled) return;
        if (lastUrl.current) URL.revokeObjectURL(lastUrl.current);
        const url = URL.createObjectURL(result.blob);
        lastUrl.current = url;
        setRendered({ ...result, url, ms: Math.round(performance.now() - started) });
      })
      .catch((e: Error) => !cancelled && setProblems([`Rendering failed: ${e.message}`]))
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
    };
  }, [template, frame, background, subject]);

  const onCutout = async (file: File | undefined) => {
    if (!file) return;
    try {
      setSubject(await subjectFromCutout(file));
      setProblems([]);
    } catch (e) {
      setProblems([(e as Error).message]);
    }
  };

  const selectClass = 'min-h-12 w-full rounded-lg border border-line bg-ink px-3 text-paper';
  const placement = rendered?.report.placement;

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6">
      <header>
        <Link to="/" className="text-sm text-muted underline-offset-4 hover:underline">
          ← Photobooth
        </Link>
        <h1 className="mt-1 text-3xl font-semibold">Composite preview</h1>
        <p className="mt-1 max-w-2xl text-muted">
          The final image as the kiosk will export it, using a stand-in visitor. Use it to check frame artwork,
          sponsor slots and each background’s placement.
        </p>
      </header>

      {problems.length > 0 && (
        <ul role="alert" className="rounded-xl border border-bad/60 bg-bad/10 px-4 py-3 text-bad">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_1fr]">
        <section className="flex flex-col gap-4 rounded-2xl border border-line bg-panel p-4">
          <label className="flex flex-col gap-1 text-sm text-muted">
            Template
            <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={selectClass}>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-muted">
            Frame
            <select value={frameId} onChange={(e) => setFrameId(e.target.value)} className={selectClass}>
              {template?.frames.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                  {f.placeholder ? ' (placeholder)' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-muted">
            Background
            <select value={backgroundId} onChange={(e) => setBackgroundId(e.target.value)} className={selectClass}>
              {backgrounds.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {b.placeholder ? ' (placeholder)' : ''}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-col gap-2 text-sm text-muted">
            Visitor: {subject?.description}
            <label className="flex min-h-12 cursor-pointer items-center justify-center rounded-lg border border-line bg-ink px-4 font-medium text-paper">
              Upload a transparent PNG cut-out
              <input type="file" accept="image/png,image/webp" className="hidden" onChange={(e) => onCutout(e.target.files?.[0])} />
            </label>
            <button
              type="button"
              className="min-h-12 rounded-lg border border-line bg-ink px-4 font-medium text-paper"
              onClick={() => setSubject(drawTestSubject())}
            >
              Use the drawn test figure
            </button>
          </div>

          {rendered && placement && (
            <table className="w-full text-left text-sm">
              <tbody>
                {[
                  ['Output', `${rendered.width} × ${rendered.height} JPEG`],
                  ['File size', formatBytes(rendered.blob.size)],
                  ['Render time', `${rendered.ms} ms`],
                  ['Layers', rendered.report.layers.join(' → ')],
                  ['Visitor height', `${Math.round(placement.subject.height)} px`],
                  ['Visitor scale', `${placement.scale.toFixed(2)}×${placement.scale > 1 ? ' (enlarged)' : ''}`],
                  ['Size reduced to fit', placement.clamped ? 'Yes' : 'No'],
                ].map(([key, value]) => (
                  <tr key={key} className="border-t border-line align-top">
                    <td className="py-1.5 pr-3 whitespace-nowrap text-muted">{key}</td>
                    <td className="py-1.5 font-mono break-words">{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {frame && frame.warnings.length > 0 && (
            <ul className="list-disc pl-5 text-sm text-warn">
              {frame.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          <button
            type="button"
            disabled={!rendered}
            className="min-h-12 rounded-lg bg-accent px-4 font-medium text-ink disabled:opacity-40"
            onClick={() => rendered && downloadBlob(rendered.blob, `${templateId}-${backgroundId}-preview.jpg`)}
          >
            Download JPEG
          </button>
        </section>

        <section className="grid place-items-center rounded-2xl border border-line bg-panel p-4">
          {rendered ? (
            <img
              src={rendered.url}
              alt="Composite preview"
              className={`max-h-[80vh] w-auto rounded-md shadow-lg ${busy ? 'opacity-60' : ''}`}
            />
          ) : (
            <p className="py-24 text-muted">{busy ? 'Rendering…' : 'Nothing rendered yet.'}</p>
          )}
        </section>
      </div>
    </main>
  );
}
