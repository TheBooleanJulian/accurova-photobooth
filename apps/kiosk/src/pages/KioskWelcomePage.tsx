import { TemplateLoadError, type LocaleStrings, type TemplateConfig } from '@accurova/template-engine';
import { useEffect, useState, type CSSProperties } from 'react';
import { useParams } from 'react-router-dom';
import { templateRegistry } from '../features/templates/registry';

const LOCALE_NAMES: Record<string, string> = { en: 'English', 'zh-CN': '中文' };

/**
 * Welcome screen, driven entirely by the template. This is deliberately the
 * only visitor screen so far: the capture flow (M2) waits on the camera proof
 * of concept being validated on real hardware.
 */
export function KioskWelcomePage() {
  const { templateId = '' } = useParams();
  const [template, setTemplate] = useState<TemplateConfig | null>(null);
  const [locale, setLocale] = useState<string | null>(null);
  const [strings, setStrings] = useState<LocaleStrings>({});
  const [error, setError] = useState<TemplateLoadError | Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTemplate(null);
    setError(null);
    templateRegistry
      .load(templateId)
      .then((t) => {
        if (cancelled) return;
        setTemplate(t);
        setLocale(t.defaultLocale);
      })
      .catch((e: Error) => !cancelled && setError(e));
    return () => {
      cancelled = true;
    };
  }, [templateId]);

  useEffect(() => {
    if (!template || !locale) return;
    let cancelled = false;
    templateRegistry
      .loadLocale(template.id, locale)
      .then((s) => !cancelled && setStrings(s))
      .catch((e: Error) => !cancelled && setError(e));
    document.documentElement.lang = locale;
    return () => {
      cancelled = true;
    };
  }, [template, locale]);

  if (error) {
    const issues = error instanceof TemplateLoadError ? error.issues : [];
    return (
      <main className="mx-auto flex min-h-full max-w-xl flex-col justify-center gap-4 px-6">
        <h1 className="text-2xl font-semibold">This booth is not available</h1>
        <p className="text-muted">{error.message}</p>
        {issues.length > 0 && (
          <ul className="list-disc pl-5 font-mono text-sm text-warn">
            {issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        )}
      </main>
    );
  }
  if (!template) return <main className="grid min-h-full place-items-center text-muted">Loading…</main>;

  const c = template.branding.colors;
  const t = (key: string) => strings[key] ?? '';
  const style = { background: c.background, color: c.text } as CSSProperties;

  return (
    <main className="flex min-h-full flex-col items-center justify-between px-8 py-10 text-center" style={style}>
      <div className="flex w-full justify-end gap-2" aria-label={t('welcome.language')}>
        {template.locales.map((l) => (
          <button
            key={l}
            onClick={() => setLocale(l)}
            className="min-h-12 rounded-full border px-5 text-base"
            style={{
              borderColor: c.primary,
              background: l === locale ? c.primary : 'transparent',
              color: l === locale ? c.surface : c.primary,
            }}
          >
            {LOCALE_NAMES[l] ?? l}
          </button>
        ))}
      </div>

      <div className="flex flex-col items-center gap-10">
        <img
          src={templateRegistry.assetUrl(template.id, template.branding.logo)}
          alt={template.name}
          className="w-[min(80vw,34rem)]"
        />
        <button
          disabled
          className="min-h-20 min-w-64 rounded-full px-12 text-2xl font-semibold tracking-wide opacity-60"
          style={{ background: c.primary, color: c.surface }}
        >
          {t('welcome.start')}
        </button>
        <p className="text-sm opacity-60">Capture flow arrives in milestone M2, after camera validation.</p>
      </div>

      <p className="max-w-xl text-sm leading-relaxed opacity-75">{t('welcome.privacy')}</p>
    </main>
  );
}
