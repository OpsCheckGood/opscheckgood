import { useEffect, useMemo, useRef, useState } from 'react';
import { FORMS, getForm, isFormUsable } from '@/lib/data/forms';
import { ADVERBS, IRREGULAR_PAST, loadVerbs } from '@/lib/data/vocab';
import { loadFontMetrics } from '@/lib/metrics/registry';
import type { FontMetrics } from '@/lib/metrics/font';
import { roundMm } from '@/lib/metrics/units';
import { inflect, matchCase } from '@/lib/text/synonyms';
import type { VerbEntry } from '@/lib/data/types';

/**
 * The action-verb list, browsable.
 *
 * The same list the editor consults when a word is selected, laid out for the
 * other way of using it: you have the accomplishment and are hunting for the
 * verb. Every verb and every pick is measured at the chosen form's type size,
 * because on a 1206 the question is never only "is this stronger" but "does
 * it still fit". Picks are shown in the past tense, the tense a bullet is
 * written in, with the width each one adds or saves against the verb.
 *
 * Entries on The Tongue and Quill's action verb table are tagged, and its
 * sample adverbs follow the list, measured the same way.
 */

/** Enough rows to scan; beyond this the search box is the faster tool. */
const MAX_ROWS = 150;

export default function VerbBank() {
  const usableForms = useMemo(() => FORMS.filter((f) => isFormUsable(f.data)), []);
  const [formId, setFormId] = useState(() => usableForms[0]?.data.id ?? FORMS[0]!.data.id);
  const form = getForm(formId) ?? FORMS[0]!;

  const [verbs, setVerbs] = useState<VerbEntry[] | null>(null);
  const [dataError, setDataError] = useState(false);
  const [font, setFont] = useState<FontMetrics | null>(null);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadVerbs().then(
      (dataset) => setVerbs(dataset.data),
      () => setDataError(true),
    );
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const file = form.data.font.file;
    if (!file) return;
    loadFontMetrics(file, form.data.font.family).then(
      (metrics) => {
        if (!cancelled) setFont(metrics);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [form]);

  const sizePt = form.data.font.sizePt;
  const pastTense = IRREGULAR_PAST.data;
  const measure = (word: string) =>
    font && sizePt > 0 ? font.widthMm(word, sizePt, false) : null;

  /**
   * Verbs whose past form or base starts with the query come first, then any
   * whose picks contain it, so typing "led" finds "led" before "compelled".
   */
  const matches = useMemo(() => {
    if (!verbs) return [];
    const q = query.trim().toLowerCase();
    if (q === '') return verbs;
    const leading: VerbEntry[] = [];
    const rest: VerbEntry[] = [];
    for (const entry of verbs) {
      if (entry.verb.startsWith(q) || entry.base.startsWith(q)) leading.push(entry);
      else if (
        entry.verb.includes(q) ||
        entry.synonyms.some((s) => s.includes(q) || inflect(s, 'ed', pastTense).includes(q))
      ) {
        rest.push(entry);
      }
    }
    return [...leading, ...rest];
  }, [verbs, query, pastTense]);

  /** Adverbs that match the same query, or all of them when there is none. */
  const adverbs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ADVERBS.data.filter((a) => q === '' || a.includes(q));
  }, [query]);

  const control = {
    background: 'var(--panel)',
    borderColor: 'var(--rule-strong)',
    color: 'var(--ink)',
  };

  return (
    <div className="mx-auto flex max-w-[1000px] flex-col gap-4 px-3 py-4 sm:px-6 sm:py-5">
      {/* ---- Search -------------------------------------------------------- */}
      <form
        className="flex flex-wrap items-end gap-x-4 gap-y-3"
        onSubmit={(e) => e.preventDefault()}
      >
        <label className="flex flex-1 flex-col gap-1.5" style={{ minWidth: 260 }}>
          <span className="util">Find a verb</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="led, overhauled, spearheaded…"
            aria-label="Filter the verb list"
            className="border px-3 py-2 text-[13px]"
            style={control}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="util">Measure against</span>
          <select
            value={formId}
            onChange={(e) => setFormId(e.target.value)}
            className="border px-2.5 py-2 text-[13px]"
            style={control}
          >
            {FORMS.map((f) => (
              <option key={f.data.id} value={f.data.id} disabled={!isFormUsable(f.data)}>
                {f.data.label}
              </option>
            ))}
          </select>
        </label>
      </form>

      {/* ---- List ---------------------------------------------------------- */}
      {dataError ? (
        <p className="m-0 text-[12px]" style={{ color: 'var(--bad)' }}>
          The verb list could not be loaded.
        </p>
      ) : !verbs ? (
        <p className="util m-0">Loading verb list…</p>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <span className="util">
              {matches.length === verbs.length
                ? `${verbs.length} verbs`
                : `${matches.length} of ${verbs.length} verbs`}
              {matches.length > MAX_ROWS ? `, first ${MAX_ROWS} shown` : ''}
            </span>
            {font && sizePt > 0 && <span className="util">widths at {sizePt}pt</span>}
          </div>

          {matches.length === 0 ? (
            <p className="m-0 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
              Nothing on the list matches “{query.trim()}”. The Thesaurus tab searches the
              whole dictionary.
            </p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {matches.slice(0, MAX_ROWS).map((entry) => {
                const shown = matchCase(entry.verb, 'A');
                const baseMm = measure(shown);
                return (
                  <li
                    key={entry.verb}
                    className="panel flex flex-wrap items-baseline gap-x-4 gap-y-2 p-3"
                  >
                    <span
                      className="flex items-baseline gap-2 text-[13px]"
                      style={{ color: 'var(--ink)', minWidth: '11em' }}
                    >
                      <span style={{ fontWeight: 600 }}>{shown}</span>
                      {entry.tq && (
                        <span
                          className="util"
                          style={{ color: 'var(--accent)' }}
                          title="On The Tongue and Quill's action verb table"
                        >
                          T&amp;Q
                        </span>
                      )}
                      {baseMm !== null && (
                        <span className="tabular text-[10.5px]" style={{ color: 'var(--ink-faint)' }}>
                          {roundMm(baseMm, 1)}mm
                        </span>
                      )}
                    </span>
                    <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
                      {entry.synonyms.map((syn) => {
                        const text = matchCase(inflect(syn, 'ed', pastTense), 'A');
                        const mm = measure(text);
                        const delta = mm !== null && baseMm !== null ? mm - baseMm : null;
                        return (
                          <li key={syn}>
                            <button
                              type="button"
                              onClick={() => setQuery(text.toLowerCase())}
                              title={`Find "${text}" on the list`}
                              className="flex items-baseline gap-2 border px-2.5 py-1 text-[12px]"
                              style={{
                                background: 'var(--panel-sunk)',
                                borderColor: 'var(--accent)',
                                color: 'var(--ink)',
                              }}
                            >
                              <span>{text}</span>
                              {delta !== null && (
                                <span
                                  className="tabular text-[10.5px]"
                                  style={{
                                    color: delta < 0 ? 'var(--ok)' : 'var(--ink-faint)',
                                  }}
                                >
                                  {delta < 0 ? '' : '+'}
                                  {roundMm(delta, 1)}mm
                                </span>
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {/* ---- Adverbs ------------------------------------------------------- */}
      {adverbs.length > 0 && (
        <section className="panel p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="title m-0">Sample adverbs</h2>
            <span className="util">The Tongue and Quill</span>
          </div>
          <p className="m-0 mt-1 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
            The handbook's own list. Use sparingly: an adverb rarely does the work a number
            does.
          </p>
          <ul className="m-0 mt-3 flex list-none flex-wrap gap-2 p-0">
            {adverbs.map((adverb) => {
              const mm = measure(adverb);
              return (
                <li
                  key={adverb}
                  className="flex items-baseline gap-2 border px-2.5 py-1 text-[12px]"
                  style={{
                    background: 'var(--panel-sunk)',
                    borderColor: 'var(--rule-strong)',
                    color: 'var(--ink)',
                  }}
                >
                  <span>{adverb}</span>
                  {mm !== null && (
                    <span className="tabular text-[10.5px]" style={{ color: 'var(--ink-faint)' }}>
                      {roundMm(mm, 1)}mm
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <p className="util m-0" style={{ textTransform: 'none' }}>
        A curated list, not an official one, except where marked T&amp;Q: those verbs and the
        adverbs are The Tongue and Quill's. The picks are the same ones the Bench shows first
        when a listed verb is selected. Widths are measured without kerning, the way a PDF
        form field lays plain text out. Nothing you type here leaves your device.
      </p>
    </div>
  );
}
