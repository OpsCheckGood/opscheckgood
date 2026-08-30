import { useEffect, useMemo, useRef, useState } from 'react';
import { FORMS, getForm, isFormUsable } from '@/lib/data/forms';
import { loadSynonyms } from '@/lib/data/vocab';
import { loadFontMetrics } from '@/lib/metrics/registry';
import type { FontMetrics } from '@/lib/metrics/font';
import { roundMm } from '@/lib/metrics/units';
import { findSenses, type ResolvedSense } from '@/lib/text/synonyms';
import type { SynonymData } from '@/lib/data/types';

/**
 * Look a word up without a bullet open.
 *
 * Results are grouped by meaning rather than shown as one list, which is the
 * whole reason this page waited on a data rebuild: "lead" means six different
 * things, and a flat list offers "conduce" as a replacement for "led a team".
 * Each meaning carries its own definition and its own replacements.
 *
 * Every option is measured at the selected form's type size, because the
 * question here is not only "is this the right word" but "will it still fit".
 */

const HISTORY_KEY = 'ocg.thesaurus.recent';
const MAX_RECENT = 8;

export default function Thesaurus() {
  const usableForms = useMemo(() => FORMS.filter((f) => isFormUsable(f.data)), []);
  const [formId, setFormId] = useState(() => usableForms[0]?.data.id ?? FORMS[0]!.data.id);
  const form = getForm(formId) ?? FORMS[0]!;

  const [query, setQuery] = useState('');
  const [word, setWord] = useState('');
  const [data, setData] = useState<SynonymData | null>(null);
  const [dataError, setDataError] = useState(false);
  const [font, setFont] = useState<FontMetrics | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadSynonyms().then(
      (dataset) => setData(dataset.data),
      () => setDataError(true),
    );
    try {
      const saved = localStorage.getItem(HISTORY_KEY);
      if (saved) setRecent(JSON.parse(saved) as string[]);
    } catch {
      /* Blocked storage: history just is not remembered. */
    }
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
  const senses: ResolvedSense[] = useMemo(
    () => (data && word ? findSenses(word, data) : []),
    [data, word],
  );

  /** Width of the searched word itself, so each option can show a delta. */
  const baseMm = useMemo(
    () => (font && word && sizePt > 0 ? font.widthMm(word, sizePt, false) : 0),
    [font, word, sizePt],
  );

  function lookup(next: string) {
    const cleaned = next.trim().replace(/[^A-Za-z'’-]/g, '');
    if (cleaned === '') return;
    setWord(cleaned);
    setQuery(cleaned);
    setRecent((current) => {
      const updated = [cleaned, ...current.filter((w) => w !== cleaned)].slice(0, MAX_RECENT);
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
      } catch {
        /* Not remembered; the page still works. */
      }
      return updated;
    });
  }

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
        onSubmit={(e) => {
          e.preventDefault();
          lookup(query);
        }}
      >
        <label className="flex flex-1 flex-col gap-1.5" style={{ minWidth: 260 }}>
          <span className="util">Word</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="led, directed, overhauled…"
            aria-label="Word to look up"
            className="border px-3 py-2 text-[13px]"
            style={control}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="util">Measure against</span>
          <select
            value={formId}
            onChange={(e) => setFormId(e.target.value)}
            className="border px-2.5 py-2 text-[12.5px]"
            style={control}
          >
            {FORMS.map((f) => (
              <option key={f.data.id} value={f.data.id} disabled={!isFormUsable(f.data)}>
                {f.data.label}
              </option>
            ))}
          </select>
        </label>

        <button
          type="submit"
          className="util border px-4 py-2.5"
          style={{ ...control, background: 'var(--panel-raised)' }}
        >
          Look up
        </button>
      </form>

      {recent.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="util">Recent</span>
          {recent.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => lookup(w)}
              className="util border px-2 py-1"
              style={{ ...control, background: 'var(--panel-sunk)' }}
            >
              {w}
            </button>
          ))}
        </div>
      )}

      {/* ---- Results ------------------------------------------------------- */}
      {dataError ? (
        <p className="m-0 text-[12px]" style={{ color: 'var(--bad)' }}>
          The word list could not be loaded.
        </p>
      ) : !data ? (
        <p className="util m-0">Loading word list…</p>
      ) : word === '' ? (
        <p className="m-0 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
          Type a word and press Look up. Past tense is fine — <em>led</em>, <em>directed</em>{' '}
          and <em>overhauled</em> all resolve, and replacements come back in the same tense.
        </p>
      ) : senses.length === 0 ? (
        <p className="m-0 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
          Nothing for “{word}”. It may be a proper noun, an abbreviation, or simply absent
          from the dictionary.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <h2 className="title m-0">{word}</h2>
            {font && sizePt > 0 && (
              <span className="util">
                {roundMm(baseMm, 1)}mm at {sizePt}pt
              </span>
            )}
            <span className="util">
              {senses.length} meaning{senses.length === 1 ? '' : 's'}
            </span>
          </div>

          {senses.map((sense, index) => (
            <section key={index} className="panel p-4">
              <div className="flex flex-wrap items-baseline gap-x-2.5">
                <span className="util">{index + 1}</span>
                <span
                  className="util"
                  style={{ textTransform: 'none', fontStyle: 'italic', color: 'var(--accent)' }}
                >
                  {sense.partOfSpeech}
                </span>
                <span className="text-[12.5px]" style={{ color: 'var(--ink)' }}>
                  {sense.definition}
                </span>
              </div>

              <ul className="m-0 mt-3 flex list-none flex-wrap gap-2 p-0">
                {sense.options
                  .map((option) => ({
                    ...option,
                    deltaMm:
                      font && sizePt > 0
                        ? font.widthMm(option.text, sizePt, false) - baseMm
                        : 0,
                  }))
                  // Shortest first: on a line that will not fit, that is the
                  // one worth reading.
                  .sort((a, b) => a.deltaMm - b.deltaMm || a.text.localeCompare(b.text))
                  .map((option) => (
                    <li
                      key={option.text}
                      className="flex items-baseline gap-2 border px-2.5 py-1.5 text-[12px]"
                      style={{
                        background: 'var(--panel-sunk)',
                        borderColor: 'var(--rule-strong)',
                        color: 'var(--ink)',
                      }}
                    >
                      <span>{option.text}</span>
                      {font && sizePt > 0 && (
                        <span
                          className="tabular text-[10.5px]"
                          style={{
                            color: option.deltaMm < 0 ? 'var(--ok)' : 'var(--ink-faint)',
                          }}
                        >
                          {option.deltaMm < 0 ? '' : '+'}
                          {roundMm(option.deltaMm, 1)}mm
                        </span>
                      )}
                    </li>
                  ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <p className="util m-0" style={{ textTransform: 'none' }}>
        Widths are measured without kerning, the way a PDF form field lays plain text out.
        Nothing you type here leaves your device.
      </p>
    </div>
  );
}
