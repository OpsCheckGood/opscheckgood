import { useState } from 'react';
import { caoStamp } from '@/lib/pdfform/version';

/**
 * The downloads a tool offers, at the top of the page where they can be
 * found: the same bar on every tool that has a fillable PDF, the same
 * wording, the same order. Each button names exactly what it hands over.
 */

export interface DownloadItem {
  label: string;
  /** One line under the label saying what the file is. */
  detail: string;
  /** Builds and hands over the file; may take a moment. */
  run: () => Promise<void> | void;
  disabled?: boolean;
  /** The main download, drawn in ink. */
  primary?: boolean;
}

export function DownloadBar({ items, note }: { items: DownloadItem[]; note?: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function go(item: DownloadItem) {
    if (busy) return;
    setBusy(item.label);
    setStatus(null);
    try {
      await item.run();
      setStatus(`${item.label} downloaded.`);
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : 'The download failed.');
    } finally {
      setBusy(null);
      window.setTimeout(() => setStatus(null), 5000);
    }
  }

  return (
    <section className="panel p-4" aria-label="Downloads">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="title m-0">Downloads</h2>
        <span className="util">
          {note ?? 'Fillable PDFs that work in Adobe Acrobat or Reader without this site'} · {caoStamp()}
        </span>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => {
          const off = item.disabled || busy !== null;
          return (
            <button
              key={item.label}
              type="button"
              disabled={off}
              onClick={() => void go(item)}
              className="flex flex-col items-start gap-0.5 border px-3 py-2.5 text-left"
              style={{
                background: item.primary && !item.disabled ? 'var(--ink)' : 'var(--panel-sunk)',
                borderColor: item.disabled ? 'var(--rule)' : 'var(--ink)',
                color: item.disabled ? 'var(--ink-faint)' : item.primary ? 'var(--ground)' : 'var(--ink)',
                opacity: busy && busy !== item.label ? 0.6 : 1,
              }}
              title={item.detail}
            >
              <span className="util" style={{ color: 'inherit', letterSpacing: '0.09em' }}>
                {busy === item.label ? 'Preparing…' : item.label}
              </span>
              <span className="text-[11.5px]" style={{ color: 'inherit', opacity: 0.8 }}>
                {item.detail}
              </span>
            </button>
          );
        })}
      </div>
      {status && (
        <p role="status" className="m-0 mt-2 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
          {status}
        </p>
      )}
    </section>
  );
}
