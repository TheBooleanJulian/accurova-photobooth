import { useEffect, useMemo, useState } from 'react';
import { decodeReport, describeReport, type CompactReport } from '../features/camera/compactReport';

/**
 * Opened on a phone by scanning the QR code on the diagnostics page. The
 * report is in the link's #fragment and is decoded here, on the phone; it is
 * never sent to a server.
 */
export function DiagnosticsReportPage() {
  const [report, setReport] = useState<CompactReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const read = () => {
      const encoded = location.hash.slice(1);
      if (!encoded) {
        setError('No report in this link. Scan the QR code on the camera diagnostics page.');
        return;
      }
      decodeReport(encoded)
        .then((decoded) => {
          setReport(decoded);
          setError(null);
        })
        .catch((e: Error) => setError(e.message));
    };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);

  const text = useMemo(() => (report ? describeReport(report) : ''), [report]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError('Copy was blocked. Select the text below and copy it manually.');
    }
  };
  const share = async () => {
    try {
      await navigator.share({ title: 'Camera diagnostics', text });
    } catch {
      // Dismissed.
    }
  };

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-6">
      <h1 className="text-2xl font-semibold">Camera diagnostics report</h1>
      {error && (
        <p role="alert" className="rounded-xl border border-bad/60 bg-bad/10 px-4 py-3 text-bad">
          {error}
        </p>
      )}
      {report && (
        <>
          <div className="flex gap-2">
            <button type="button" onClick={copy} className="min-h-12 flex-1 rounded-lg bg-accent px-4 font-medium text-ink">
              {copied ? 'Copied ✓' : 'Copy report'}
            </button>
            {typeof navigator.share === 'function' && (
              <button
                type="button"
                onClick={share}
                className="min-h-12 flex-1 rounded-lg border border-line bg-ink px-4 font-medium text-paper"
              >
                Share
              </button>
            )}
          </div>
          <pre className="overflow-x-auto rounded-xl border border-line bg-panel p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap select-all">
            {text}
          </pre>
        </>
      )}
    </main>
  );
}
