import { useEffect, useMemo, useRef, useState } from 'react';
import { FORMS, getForm, getField, isFormUsable } from '@/lib/data/forms';
import { HQ_APPROVED, COMMON } from '@/lib/data/abbreviationSets';
import { loadFontMetrics } from '@/lib/metrics/registry';
import type { FontMetrics } from '@/lib/metrics/font';
import { roundMm } from '@/lib/metrics/units';
import {
  shapeDocument,
  DEFAULT_TOLERANCE_MM,
  type ShapeResult,
} from '@/lib/shape/optimizer';
import { diagnose, type Diagnosis } from '@/lib/shape/diagnose';
import { SPACE_CHARS } from '@/lib/shape/spaces';
import { FillBars, type BarRow, type LineState } from './FillBars';
import { SourceStamp, StubBanner } from './SourceStamp';

/**
 * Bullet Bench -- the unified workspace.
 *
 * One editor, one parsed document state. Competing tools ship the disclaimer
 * "the shaping tool does not work with character count" because their features
 * live on separate pages and cannot see each other; here the width readout, the
 * character count, the fill bars and the diagnoses all read from the same
 * `shapeDocument` result, so they cannot disagree.
 *
 * Features 1-5 (duplicates, acronyms, verb bank, synonyms) attach to this same
 * state and are not built yet.
 */

const DRAFT_KEY = 'ocg.bullet-bench.draft';

const SAMPLE = [
  'Led 12-person maintenance team; drove 340 sorties and zero mishaps across the quarter',
  'Rebuilt tool accountability process; cut audit findings 60% and briefed results to leadership',
].join('\n');

function stateForWidth(result: ShapeResult): LineState {
  if (result.status === 'too-long') return 'over';
  if (result.status === 'too-short') return 'short';
  return 'ok';
}

/** Splits shaped text so the substituted spaces can be tinted. */
function markSegments(text: string) {
  return text.split(/([\u2004\u2006])/);
}

export default function BulletBench() {
  const usable = useMemo(() => FORMS.filter((f) => isFormUsable(f.data)), []);
  const [formId, setFormId] = useState(() => usable[0]?.data.id ?? FORMS[0]!.data.id);

  const form = getForm(formId) ?? FORMS[0]!;
  const [fieldId, setFieldId] = useState(() => form.data.fields[0]!.id);
  const field = getField(form.data, fieldId) ?? form.data.fields[0]!;

  const [text, setText] = useState(SAMPLE);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [font, setFont] = useState<FontMetrics | null>(null);
  const [fontError, setFontError] = useState<string | null>(null);
  const [showMarks, setShowMarks] = useState(true);
  const [activeLine, setActiveLine] = useState<number | null>(null);
  const [copyNote, setCopyNote] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const outputRef = useRef<HTMLTextAreaElement>(null);

  // Keep the field selection valid when the form changes.
  useEffect(() => {
    if (!getField(form.data, fieldId)) setFieldId(form.data.fields[0]!.id);
  }, [form, fieldId]);

  // Draft persistence is localStorage only -- nothing leaves the browser.
  // Read after mount so the server-rendered markup and the first client render
  // agree.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved !== null) setText(saved);
    } catch {
      /* Private mode or blocked storage: the editor still works. */
    }
    setDraftLoaded(true);
  }, []);

  useEffect(() => {
    if (!draftLoaded) return;
    try {
      localStorage.setItem(DRAFT_KEY, text);
    } catch {
      /* Nothing to do; the draft simply is not remembered. */
    }
  }, [text, draftLoaded]);

  useEffect(() => {
    let cancelled = false;
    const file = form.data.font.file;
    setFont(null);
    setFontError(null);
    if (!file) {
      setFontError('This form has no font yet, so nothing can be measured.');
      return;
    }
    loadFontMetrics(file, form.data.font.family).then(
      (metrics) => {
        if (!cancelled) setFont(metrics);
      },
      (error: unknown) => {
        if (!cancelled) setFontError(error instanceof Error ? error.message : String(error));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [form]);

  const bindsOnWidth = field.constraint === 'width';
  const targetMm = field.widthMm ?? 0;
  const maxChars = field.maxChars ?? 0;
  const sizePt = form.data.font.sizePt;

  const results: ShapeResult[] = useMemo(() => {
    if (!font || targetMm <= 0 || sizePt <= 0) return [];
    return shapeDocument(text, font, { targetMm, sizePt });
  }, [font, text, targetMm, sizePt]);

  const rows: BarRow[] = useMemo(() => {
    const out: BarRow[] = [];
    results.forEach((result, index) => {
      if (result.status === 'empty') return;
      if (bindsOnWidth) {
        out.push({
          index,
          ratio: result.fillRatio,
          tolerance: DEFAULT_TOLERANCE_MM / targetMm,
          state: stateForWidth(result),
          primary: `${roundMm(result.widthMm)}/${roundMm(targetMm)}mm`,
          secondary: `${result.charCount}ch`,
          description: `Line ${index + 1}: ${roundMm(result.widthMm)} of ${roundMm(targetMm)} millimetres, ${result.charCount} characters, ${stateForWidth(result)}`,
        });
      } else {
        const over = result.charCount > maxChars;
        out.push({
          index,
          ratio: maxChars > 0 ? result.charCount / maxChars : 0,
          tolerance: maxChars > 0 ? 1 / maxChars : 0,
          state: over ? 'over' : 'ok',
          primary: `${result.charCount}/${maxChars}ch`,
          secondary: `${roundMm(result.widthMm)}mm`,
          description: `Line ${index + 1}: ${result.charCount} of ${maxChars} characters, ${roundMm(result.widthMm)} millimetres, ${over ? 'over' : 'within limit'}`,
        });
      }
    });
    return out;
  }, [results, bindsOnWidth, targetMm, maxChars]);

  const diagnoses: Array<{ index: number; diagnosis: Diagnosis }> = useMemo(() => {
    if (!font || !bindsOnWidth) return [];
    const out: Array<{ index: number; diagnosis: Diagnosis }> = [];
    results.forEach((result, index) => {
      const d = diagnose(result, {
        font,
        sizePt,
        // Both tables are empty stubs today, so no abbreviation remedies
        // appear until they are populated from an official source.
        abbreviations:
          HQ_APPROVED.data.entries.length > 0 ? HQ_APPROVED.data : COMMON.data,
      });
      if (d) out.push({ index, diagnosis: d });
    });
    return out;
  }, [results, font, sizePt, bindsOnWidth]);

  const charOverruns = useMemo(() => {
    if (bindsOnWidth || maxChars <= 0) return [];
    return results.flatMap((r, index) =>
      r.status !== 'empty' && r.charCount > maxChars
        ? [{ index, over: r.charCount - maxChars }]
        : [],
    );
  }, [results, bindsOnWidth, maxChars]);

  const shapedText = results.map((r) => r.text).join('\n');

  async function copyOutput() {
    try {
      await navigator.clipboard.writeText(shapedText);
      setCopyNote('Copied to clipboard.');
    } catch {
      // Clipboard access is refused on file:// and in some locked-down
      // browsers. Select the text instead so Ctrl+C still works.
      outputRef.current?.focus();
      outputRef.current?.select();
      setCopyNote('Clipboard blocked. Text selected: press Ctrl+C.');
    }
    window.setTimeout(() => setCopyNote(null), 4000);
  }

  const sources = [form.meta];
  const measurable = font !== null && targetMm > 0 && sizePt > 0;

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-3 p-3">
      {/* ---- Control bar ------------------------------------------------- */}
      <div className="panel flex flex-wrap items-end gap-x-5 gap-y-3 px-3 py-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="form-select" className="label">
            Form
          </label>
          <select
            id="form-select"
            value={formId}
            onChange={(e) => setFormId(e.target.value)}
            className="tabular border px-2 py-1 text-[13px]"
            style={{ background: 'var(--panel)', color: 'var(--ink)', borderColor: 'var(--rule-strong)' }}
          >
            {FORMS.map((f) => (
              <option key={f.data.id} value={f.data.id} disabled={!isFormUsable(f.data)}>
                {f.data.label}
                {isFormUsable(f.data) ? '' : ' — not yet populated'}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="field-select" className="label">
            Block
          </label>
          <select
            id="field-select"
            value={field.id}
            onChange={(e) => setFieldId(e.target.value)}
            className="border px-2 py-1 text-[13px]"
            style={{ background: 'var(--panel)', color: 'var(--ink)', borderColor: 'var(--rule-strong)' }}
          >
            {form.data.fields.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </div>

        {/* Both metrics always show; the binding one is emphasised. */}
        <div className="flex gap-5">
          <Readout
            label="Target width"
            value={targetMm > 0 ? `${roundMm(targetMm)}mm` : '—'}
            binding={bindsOnWidth}
          />
          <Readout
            label="Character limit"
            value={maxChars > 0 ? `${maxChars}` : '—'}
            binding={!bindsOnWidth}
          />
          <Readout
            label="Type size"
            value={sizePt > 0 ? `${sizePt}pt` : '—'}
            binding={false}
          />
        </div>

        <div className="ml-auto flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
            <input
              type="checkbox"
              checked={showMarks}
              onChange={(e) => setShowMarks(e.target.checked)}
            />
            Show spacing marks
          </label>
          <button
            type="button"
            onClick={copyOutput}
            disabled={!measurable}
            className="border px-3 py-1.5 text-[13px] font-medium"
            style={{
              background: 'var(--panel-sunk)',
              color: measurable ? 'var(--ink)' : 'var(--ink-faint)',
              borderColor: 'var(--rule-strong)',
            }}
          >
            Copy shaped bullets
          </button>
        </div>
      </div>

      {copyNote && (
        <p role="status" className="m-0 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
          {copyNote}
        </p>
      )}

      {form.isStub && (
        <StubBanner
          what={`${form.data.label} is a placeholder.`}
        />
      )}

      {fontError && (
        <div
          role="alert"
          className="px-3 py-2 text-[12px]"
          style={{
            background: 'var(--state-over-bg)',
            color: 'var(--state-over)',
            border: '1px solid currentColor',
          }}
        >
          {fontError}
        </div>
      )}

      {/* ---- Two panes --------------------------------------------------- */}
      <div className="grid gap-3 lg:grid-cols-2">
        <section className="panel flex min-h-[240px] flex-col" aria-label="Draft bullets">
          <header className="flex items-baseline justify-between border-b px-3 py-2" style={{ borderColor: 'var(--rule)' }}>
            <h2 className="label m-0">Draft — one bullet per line</h2>
            <span className="tabular text-[11px]" style={{ color: 'var(--ink-faint)' }}>
              {text.split('\n').filter((l) => l.trim()).length} bullets
            </span>
          </header>
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onSelect={(e) => {
              const upto = e.currentTarget.value.slice(0, e.currentTarget.selectionStart ?? 0);
              setActiveLine(upto.split('\n').length - 1);
            }}
            spellCheck
            aria-describedby="privacy-note"
            className="min-h-[220px] flex-1 resize-y border-0 p-3 text-[13px] leading-6 outline-none"
            style={{ background: 'transparent', color: 'var(--ink)', fontFamily: 'var(--font-sans)' }}
          />
        </section>

        <section className="panel flex min-h-[240px] flex-col" aria-label="Shaped output">
          <header className="flex items-baseline justify-between border-b px-3 py-2" style={{ borderColor: 'var(--rule)' }}>
            <h2 className="label m-0">Shaped output</h2>
            <span className="tabular text-[11px]" style={{ color: 'var(--ink-faint)' }}>
              {rows.filter((r) => r.state === 'ok').length}/{rows.length} flush
            </span>
          </header>

          {!measurable ? (
            <p className="m-0 p-3 text-[12px]" style={{ color: 'var(--ink-faint)' }}>
              {font ? 'This block has no target yet.' : 'Loading font…'}
            </p>
          ) : (
            <ol className="m-0 flex-1 list-none overflow-auto p-0">
              {results.map((result, index) => {
                if (result.status === 'empty') return null;
                const state = bindsOnWidth
                  ? stateForWidth(result)
                  : result.charCount > maxChars
                    ? 'over'
                    : 'ok';
                return (
                  <li
                    key={index}
                    onMouseEnter={() => setActiveLine(index)}
                    className="flex gap-2 px-3 py-1.5 text-[13px] leading-6"
                    style={{
                      borderTop: index === 0 ? 'none' : '1px solid var(--rule)',
                      background: activeLine === index ? 'var(--panel-sunk)' : 'transparent',
                      borderLeft: `3px solid ${
                        state === 'ok'
                          ? 'var(--state-ok)'
                          : state === 'over'
                            ? 'var(--state-over)'
                            : 'var(--state-short)'
                      }`,
                    }}
                  >
                    <span className="tabular shrink-0 text-[10px] leading-6" style={{ color: 'var(--ink-faint)' }}>
                      {index + 1}
                    </span>
                    <span className="min-w-0 break-words whitespace-pre-wrap">
                      {showMarks
                        ? markSegments(result.text).map((part, i) =>
                            i % 2 === 1 ? (
                              <span
                                key={i}
                                title={
                                  part === SPACE_CHARS.THREE_PER_EM
                                    ? 'U+2004 three-per-em space'
                                    : 'U+2006 six-per-em space'
                                }
                                style={{
                                  background:
                                    part === SPACE_CHARS.THREE_PER_EM
                                      ? 'var(--state-ok-bg)'
                                      : 'var(--state-short-bg)',
                                  outline: '1px solid var(--rule)',
                                }}
                              >
                                {part}
                              </span>
                            ) : (
                              part
                            ),
                          )
                        : result.text}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}

          {/* Off-screen mirror so Copy has something to select when the
              clipboard API is unavailable, as it is under file://. */}
          <textarea
            ref={outputRef}
            readOnly
            value={shapedText}
            tabIndex={-1}
            aria-hidden
            className="absolute h-px w-px overflow-hidden opacity-0"
          />
        </section>
      </div>

      {/* ---- Fill bars --------------------------------------------------- */}
      <FillBars
        rows={rows}
        caption={
          bindsOnWidth
            ? `${rows.length} line${rows.length === 1 ? '' : 's'} · target ${roundMm(targetMm)}mm · tolerance ${DEFAULT_TOLERANCE_MM}mm`
            : `${rows.length} line${rows.length === 1 ? '' : 's'} · limit ${maxChars} characters`
        }
        activeLine={activeLine}
        onSelectLine={(index) => {
          setActiveLine(index);
          const area = inputRef.current;
          if (!area) return;
          const lines = area.value.split('\n');
          const start = lines.slice(0, index).reduce((n, l) => n + l.length + 1, 0);
          area.focus();
          area.setSelectionRange(start, start + (lines[index]?.length ?? 0));
        }}
      />

      {/* ---- What to do about the failures ------------------------------- */}
      {(diagnoses.length > 0 || charOverruns.length > 0) && (
        <section className="panel" aria-label="Lines that need editing">
          <header className="border-b px-3 py-2" style={{ borderColor: 'var(--rule)' }}>
            <h2 className="label m-0">Needs editing</h2>
          </header>
          <ul className="m-0 list-none p-0">
            {diagnoses.map(({ index, diagnosis }) => (
              <li
                key={index}
                className="flex gap-2 px-3 py-2 text-[12px]"
                style={{ borderTop: '1px solid var(--rule)' }}
              >
                <span className="tabular shrink-0" style={{ color: 'var(--ink-faint)' }}>
                  {index + 1}
                </span>
                <span style={{ color: 'var(--ink-muted)' }}>{diagnosis.message}</span>
              </li>
            ))}
            {charOverruns.map(({ index, over }) => (
              <li
                key={`c${index}`}
                className="flex gap-2 px-3 py-2 text-[12px]"
                style={{ borderTop: '1px solid var(--rule)' }}
              >
                <span className="tabular shrink-0" style={{ color: 'var(--ink-faint)' }}>
                  {index + 1}
                </span>
                <span style={{ color: 'var(--ink-muted)' }}>
                  Over the character limit by {over}. Cut {over} character
                  {over === 1 ? '' : 's'}.
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ---- Provenance and privacy -------------------------------------- */}
      <div className="panel flex flex-col gap-2 px-3 py-2">
        <SourceStamp sources={sources} />
        <p id="privacy-note" className="m-0 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
          Your draft stays on this device. It is saved to this browser's local
          storage and is never uploaded, logged, or sent anywhere.
        </p>
      </div>
    </div>
  );
}

function Readout({
  label,
  value,
  binding,
}: {
  label: string;
  value: string;
  binding: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="label">
        {label}
        {binding ? ' · binding' : ''}
      </span>
      <span
        className="tabular text-[15px]"
        style={{
          color: binding ? 'var(--ink)' : 'var(--ink-faint)',
          fontWeight: binding ? 600 : 400,
        }}
      >
        {value}
      </span>
    </div>
  );
}
