import type { DataMeta } from '@/lib/data/types';

/**
 * Provenance, rendered where the user can see it.
 *
 * Every tool shows the source and verified date of the data behind its numbers.
 * That stamp is the difference between this and the abandoned tools already out
 * there: you can tell at a glance whether a readout rests on a real form or on
 * a placeholder nobody has filled in yet.
 */
export function SourceStamp({ sources }: { sources: readonly DataMeta[] }) {
  if (sources.length === 0) return null;
  return (
    <dl className="m-0 grid gap-x-3 gap-y-1 text-[11px] sm:grid-cols-[auto_1fr]">
      {sources.map((meta) => (
        <div key={`${meta.source}-${meta.version}`} className="contents">
          <dt className="util pt-[2px]">{meta.status === 'verified' ? 'Source' : 'Source (stub)'}</dt>
          <dd className="m-0" style={{ color: 'var(--ink-muted)' }}>
            {meta.sourceUrl ? (
              <a
                href={meta.sourceUrl}
                target="_blank"
                rel="noreferrer noopener"
                style={{ color: 'var(--accent)' }}
              >
                {meta.source}
              </a>
            ) : (
              meta.source
            )}
            <span className="tabular"> · v{meta.version} · verified {meta.verifiedDate}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Shown whenever any dataset behind the current readout is still a stub. */
export function StubBanner({ what }: { what: string }) {
  return (
    <div
      role="status"
      className="panel px-3 py-2.5 text-[11.5px] leading-relaxed"
      style={{
        background: 'var(--warn-dim)',
        color: 'var(--warn)',
        border: '1px solid currentColor',
      }}
    >
      <strong className="font-semibold">Unverified data.</strong> {what} These numbers
      have not been transcribed from an official source. Do not rely on them.
    </div>
  );
}
