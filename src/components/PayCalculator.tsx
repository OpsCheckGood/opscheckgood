import { useEffect, useMemo, useState } from 'react';
import { CURRENT_PAY, PAY_GROUP_LABEL } from '@/lib/data/pay';
import type { PayGroup } from '@/lib/data/types';
import {
  difference,
  formatSigned,
  formatUsd,
  lookup,
  nextGrade,
  parseCount,
  serviceYears,
  type PayResult,
} from '@/lib/pay/basic';
import { SourceStamp } from './SourceStamp';

/**
 * Pay calculator.
 *
 * A grade and a length of service go in; monthly basic pay comes out, with
 * the annual and twice-monthly figures beside it and the next longevity
 * raise underneath. A second panel opens for comparison, prefilled with the
 * next grade up at the same length of service, because the question that
 * brings most people here is "what would I make if I put on the next stripe".
 *
 * Every number is read out of the DFAS table in src/data/pay. The component
 * knows one rule -- a column applies once service is over the years it
 * names -- and that lives in lib/pay/basic.ts, not here.
 *
 * Basic pay only. Allowances, special pays and taxes are not on the page,
 * and the footer says so, because a figure that looks like take-home pay and
 * is not would be worse than no figure.
 *
 * Visual language follows the other calculators: flat panels, uppercase
 * utility chrome, one big number per panel, colour only where a difference
 * has a sign. The unverified-data banner does not apply: the table is
 * `status: "verified"` against DFAS, and the source stamp at the foot names
 * the edition.
 */

const DRAFT_KEY = 'ocg.pay.draft';

const dataset = CURRENT_PAY;
const table = dataset.data;

interface Entry {
  gradeId: string;
  years: string;
  months: string;
}

interface Draft {
  primary: Entry;
  /** Null while the comparison panel is closed. */
  compare: Entry | null;
}

const DEFAULT_GRADE = table.grades.find((g) => g.id === 'E-5')?.id ?? table.grades[0]!.id;

function initialDraft(): Draft {
  return { primary: { gradeId: DEFAULT_GRADE, years: '6', months: '0' }, compare: null };
}

const GROUP_ORDER: PayGroup[] = ['enlisted', 'officer', 'officer-prior', 'warrant'];

const CONTROL = {
  background: 'var(--panel-sunk)',
  borderColor: 'var(--rule-strong)',
  color: 'var(--ink)',
} as const;

function resolve(entry: Entry): PayResult | null {
  return lookup(
    table,
    entry.gradeId,
    serviceYears(parseCount(entry.years), parseCount(entry.months)),
  );
}

export default function PayCalculator() {
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [loaded, setLoaded] = useState(false);

  // localStorage only. Read after mount so the static markup and the first
  // client render agree; nothing is uploaded.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved !== null) {
        const parsed = JSON.parse(saved) as Partial<Draft>;
        setDraft({
          primary: { ...initialDraft().primary, ...parsed.primary },
          compare: parsed.compare ? { ...initialDraft().primary, ...parsed.compare } : null,
        });
      }
    } catch {
      /* Private mode, blocked storage, or a draft from an older shape. */
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      /* Nothing to do. */
    }
  }, [draft, loaded]);

  const primary = useMemo(() => resolve(draft.primary), [draft.primary]);
  const compare = useMemo(
    () => (draft.compare ? resolve(draft.compare) : null),
    [draft.compare],
  );
  const diff = primary && compare ? difference(primary, compare) : null;

  function openCompare() {
    const next = nextGrade(table, draft.primary.gradeId);
    setDraft((d) => ({
      ...d,
      compare: { ...d.primary, gradeId: next?.id ?? d.primary.gradeId },
    }));
  }

  return (
    <div className="mx-auto flex max-w-[1000px] flex-col gap-4 px-3 py-4 sm:px-6 sm:py-5">
      <div className={`grid gap-4 ${draft.compare ? 'sm:grid-cols-2' : ''}`}>
        <PayPanel
          idPrefix="pay-a"
          label={draft.compare ? 'You' : 'Basic pay'}
          entry={draft.primary}
          result={primary}
          onChange={(primary) => setDraft((d) => ({ ...d, primary }))}
        />
        {draft.compare && (
          <PayPanel
            idPrefix="pay-b"
            label="Compare"
            entry={draft.compare}
            result={compare}
            onChange={(compare) => setDraft((d) => ({ ...d, compare }))}
            onClose={() => setDraft((d) => ({ ...d, compare: null }))}
          />
        )}
      </div>

      {/* ---- Difference ---------------------------------------------------- */}
      {draft.compare ? (
        <section className="panel flex flex-wrap items-baseline gap-x-6 gap-y-2 px-4 py-3">
          <span className="util">Difference</span>
          {diff ? (
            <>
              <span
                className="tabular text-[20px] font-bold"
                style={{ color: diff.monthly > 0 ? 'var(--ok)' : diff.monthly < 0 ? 'var(--bad)' : 'var(--ink)' }}
              >
                {formatSigned(diff.monthly)}
                <span className="util ml-1.5" style={{ color: 'inherit' }}>
                  a month
                </span>
              </span>
              <span className="tabular text-[13px]" style={{ color: 'var(--ink-muted)' }}>
                {formatSigned(diff.annual)} a year
              </span>
              <span className="tabular text-[13px]" style={{ color: 'var(--ink-muted)' }}>
                {diff.percent > 0 ? '+' : ''}
                {diff.percent}%
              </span>
            </>
          ) : (
            <span className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
              No rate to compare at one of these lengths of service.
            </span>
          )}
        </section>
      ) : (
        <div>
          <button
            type="button"
            onClick={openCompare}
            className="util border px-4 py-2.5"
            style={{ ...CONTROL, background: 'var(--panel-raised)' }}
          >
            Compare with another grade
          </button>
        </div>
      )}

      {/* ---- Provenance ---------------------------------------------------- */}
      <section className="flex flex-col gap-3 pt-2">
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[11px] leading-relaxed" style={{ color: 'var(--ink-faint)' }}>
          {table.footnotes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
        <SourceStamp sources={[dataset.meta]} />
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One grade, one length of service, one number
// ---------------------------------------------------------------------------

function PayPanel({
  idPrefix,
  label,
  entry,
  result,
  onChange,
  onClose,
}: {
  idPrefix: string;
  label: string;
  entry: Entry;
  result: PayResult | null;
  onChange: (entry: Entry) => void;
  onClose?: () => void;
}) {
  const monthly = result?.monthly ?? null;

  return (
    <section className="panel flex flex-col gap-4 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="title m-0">{label}</h2>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="util border px-2 py-1"
            style={{ ...CONTROL, background: 'var(--panel)' }}
          >
            Remove
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <label className="flex flex-1 flex-col gap-1.5" style={{ minWidth: 200 }}>
          <span className="util">Pay grade</span>
          <select
            id={`${idPrefix}-grade`}
            value={entry.gradeId}
            onChange={(e) => onChange({ ...entry, gradeId: e.target.value })}
            className="border px-3 py-2 text-[13px]"
            style={CONTROL}
          >
            {GROUP_ORDER.map((group) => (
              <optgroup key={group} label={PAY_GROUP_LABEL[group]}>
                {table.grades
                  .filter((g) => g.group === group)
                  .map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.id} · {g.abbr}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="util">Years</span>
          <input
            id={`${idPrefix}-years`}
            type="number"
            inputMode="numeric"
            min={0}
            max={40}
            step={1}
            value={entry.years}
            onChange={(e) => onChange({ ...entry, years: e.target.value })}
            className="tabular border px-3 py-2 text-[13px]"
            style={{ ...CONTROL, width: '5.5rem' }}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="util">Months</span>
          <input
            id={`${idPrefix}-months`}
            type="number"
            inputMode="numeric"
            min={0}
            max={11}
            step={1}
            value={entry.months}
            onChange={(e) => onChange({ ...entry, months: e.target.value })}
            className="tabular border px-3 py-2 text-[13px]"
            style={{ ...CONTROL, width: '5.5rem' }}
          />
        </label>
      </div>

      {/* The one big number. */}
      <div
        className="rounded-[4px] border px-4 py-3"
        style={{ background: 'var(--panel-sunk)', borderColor: 'var(--rule)' }}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className="text-[13px]" style={{ color: 'var(--ink)' }}>
            {result ? result.grade.title : '—'}
          </span>
          {result && (
            <span className="util">{result.column} years column</span>
          )}
        </div>
        {monthly !== null ? (
          <>
            <div className="tabular mt-1 text-[34px] font-bold leading-none" style={{ color: 'var(--ink)' }}>
              {formatUsd(monthly)}
              <span className="util ml-2">a month</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] tabular" style={{ color: 'var(--ink-muted)' }}>
              <span>{formatUsd(result!.annual!)} a year</span>
              <span>{formatUsd(result!.semiMonthly!)} each payday</span>
            </div>
          </>
        ) : (
          <p className="m-0 mt-2 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
            {result
              ? `DFAS publishes no ${result.grade.id} rate at this length of service.`
              : 'Choose a pay grade.'}
          </p>
        )}
      </div>

      <p className="m-0 min-h-[1.2em] text-[12px]" style={{ color: 'var(--ink-muted)' }}>
        {result?.nextStep ? (
          <>
            Next longevity raise at {result.nextStep.column.toLowerCase()} years:{' '}
            <span className="tabular" style={{ color: 'var(--ink)' }}>
              {formatUsd(result.nextStep.monthly)}
            </span>{' '}
            <span className="tabular" style={{ color: 'var(--ok)' }}>
              ({formatSigned(result.nextStep.delta)})
            </span>
          </>
        ) : monthly !== null ? (
          'Top of the scale for this grade.'
        ) : null}
      </p>
    </section>
  );
}
