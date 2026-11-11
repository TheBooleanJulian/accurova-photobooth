import type { RegistryIndex } from '@accurova/template-engine';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { templateRegistry } from '../features/templates/registry';

export function HomePage() {
  const [index, setIndex] = useState<RegistryIndex | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    templateRegistry
      .list()
      .then(setIndex)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col gap-8 px-6 py-12">
      <header>
        <p className="text-sm tracking-[0.3em] text-muted uppercase">Accurova</p>
        <h1 className="mt-2 text-4xl font-semibold">Photobooth</h1>
        <p className="mt-3 text-muted">Operator start page. Visitors only ever see a kiosk route.</p>
      </header>

      <section>
        <h2 className="mb-3 text-sm tracking-widest text-muted uppercase">Templates</h2>
        {error && <p className="rounded-lg border border-bad/50 p-4 text-bad">Could not load templates: {error}</p>}
        {!index && !error && <p className="text-muted">Loading…</p>}
        <ul className="flex flex-col gap-3">
          {index?.templates.map((t) => (
            <li key={t.id}>
              {t.enabled ? (
                <Link
                  to={`/kiosk/${t.id}`}
                  className="flex min-h-16 items-center justify-between rounded-xl border border-line bg-panel px-5 text-lg"
                >
                  <span>{t.name}</span>
                  <span className="font-mono text-sm text-muted">/kiosk/{t.id}</span>
                </Link>
              ) : (
                <div className="flex min-h-16 items-center justify-between rounded-xl border border-line px-5 text-lg text-muted">
                  <span>{t.name}</span>
                  <span className="text-sm">disabled</span>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-3 text-sm tracking-widest text-muted uppercase">Administration</h2>
        <Link
          to="/admin/diagnostics"
          className="flex min-h-16 items-center justify-between rounded-xl border border-accent/60 bg-panel px-5 text-lg"
        >
          <span>Camera diagnostics</span>
          <span className="font-mono text-sm text-muted">/admin/diagnostics</span>
        </Link>
      </section>
    </main>
  );
}
