import type { DownloadInfo } from '@accurova/shared-types';
import type { LocaleStrings, TemplateConfig } from '@accurova/template-engine';
import { useEffect, useState, type CSSProperties } from 'react';
import { useParams } from 'react-router-dom';
import { templateRegistry } from '../features/templates/registry';
import { api } from '../services/api';

/** Used when the template or its locale cannot be loaded; the photo still downloads. */
const FALLBACK: LocaleStrings = {
  'download.title': 'Your photo is ready',
  'download.save': 'Save photo',
  'download.share': 'Share',
  'download.hint': 'You can also press and hold the photo to save it.',
  'download.expires': 'Available until {time}',
  'download.invalid': 'This link is invalid or has expired.',
};
const FALLBACK_COLORS = { background: '#111318', surface: '#f4efe6', primary: '#e0613f', text: '#f4efe6' };

function pickLocale(template: TemplateConfig, preferred: readonly string[]): string {
  for (const wanted of preferred) {
    const exact = template.locales.find((l) => l.toLowerCase() === wanted.toLowerCase());
    if (exact) return exact;
    const sameLanguage = template.locales.find((l) => l.split('-')[0] === wanted.split('-')[0]);
    if (sameLanguage) return sameLanguage;
  }
  return template.defaultLocale;
}

/**
 * The page a visitor's phone opens from the QR code: shows the photograph and
 * lets them save or share it. Knows only the download token.
 */
export function DownloadPage() {
  const { token = '' } = useParams();
  const [info, setInfo] = useState<DownloadInfo | null>(null);
  const [failed, setFailed] = useState(false);
  const [template, setTemplate] = useState<TemplateConfig | null>(null);
  const [strings, setStrings] = useState<LocaleStrings>(FALLBACK);
  const [canShare, setCanShare] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .downloadInfo(token)
      .then(async (result) => {
        if (cancelled) return;
        setInfo(result);
        try {
          const loaded = await templateRegistry.load(result.templateId);
          const locale = pickLocale(loaded, navigator.languages ?? [navigator.language]);
          const localized = await templateRegistry.loadLocale(loaded.id, locale);
          if (cancelled) return;
          setTemplate(loaded);
          setStrings({ ...FALLBACK, ...localized });
          document.documentElement.lang = locale;
        } catch {
          // Branding is optional here; keep the neutral fallback.
        }
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    // Sharing a file needs Web Share Level 2; feature-detect with a tiny probe.
    try {
      const probe = new File([''], 'photo.jpg', { type: 'image/jpeg' });
      setCanShare(typeof navigator.canShare === 'function' && navigator.canShare({ files: [probe] }));
    } catch {
      setCanShare(false);
    }
  }, []);

  const colors = template?.branding.colors ?? FALLBACK_COLORS;
  const page = { background: colors.background, color: colors.text } as CSSProperties;
  const t = (key: string) => strings[key] ?? FALLBACK[key] ?? '';
  const imageUrl = api.downloadUrl(token);
  const fileName = `${info?.templateId ?? 'photobooth'}-photo.jpg`;

  const share = async () => {
    try {
      const blob = await (await fetch(imageUrl)).blob();
      await navigator.share({ files: [new File([blob], fileName, { type: 'image/jpeg' })] });
    } catch {
      // Dismissing the share sheet is not an error worth showing.
    }
  };

  if (failed) {
    return (
      <main className="grid min-h-full place-items-center px-8 text-center" style={page}>
        <p className="max-w-sm text-lg">{t('download.invalid')}</p>
      </main>
    );
  }
  if (!info) return <main className="grid min-h-full place-items-center text-muted">…</main>;

  const expires = new Date(info.expiresAt).toLocaleString(document.documentElement.lang || undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return (
    <main className="flex min-h-full flex-col items-center gap-5 px-5 py-8 text-center" style={page}>
      <h1 className="text-2xl font-semibold">{t('download.title')}</h1>
      <img
        src={imageUrl}
        alt={template?.name ?? 'Photo'}
        width={info.width}
        height={info.height}
        className="h-auto max-h-[62vh] w-auto max-w-full rounded-lg shadow-lg"
      />
      <div className="flex w-full max-w-sm flex-col gap-3">
        <a
          href={imageUrl}
          download={fileName}
          className="flex min-h-14 items-center justify-center rounded-full text-lg font-semibold"
          style={{ background: colors.primary, color: colors.surface }}
        >
          {t('download.save')}
        </a>
        {canShare && (
          <button
            type="button"
            onClick={share}
            className="min-h-14 rounded-full border text-lg font-semibold"
            style={{ borderColor: colors.primary, color: colors.primary }}
          >
            {t('download.share')}
          </button>
        )}
      </div>
      <p className="text-sm opacity-70">{t('download.hint')}</p>
      <p className="text-sm opacity-70">{t('download.expires').replace('{time}', expires)}</p>
      {template?.branding.photographyCredit && (
        <p className="mt-auto pt-4 text-xs tracking-widest uppercase opacity-50">
          {template.branding.photographyCredit}
        </p>
      )}
    </main>
  );
}
