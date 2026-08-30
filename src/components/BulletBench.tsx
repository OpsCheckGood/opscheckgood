import { useEffect, useMemo, useRef, useState } from 'react';
import { FORMS, getForm, getField, isFormUsable } from '@/lib/data/forms';
import { HQ_APPROVED, COMMON } from '@/lib/data/abbreviationSets';
import { mergeAbbreviations, applyAbbreviations } from '@/lib/data/abbreviations';
import { STOPWORDS } from '@/lib/data/vocab';
import { loadFontMetrics } from '@/lib/metrics/registry';
import { ensureFontFace } from '@/lib/metrics/fontface';
import type { FontMetrics } from '@/lib/metrics/font';
import { roundMm } from '@/lib/metrics/units';
import { shapeDocument, type ShapeResult } from '@/lib/shape/optimizer';
import { diagnose } from '@/lib/shape/diagnose';
import { SPACE_CHARS, countSpaces, unshape } from '@/lib/shape/spaces';
import { splitLines } from '@/lib/text/tokenize';
import { findDuplicates } from '@/lib/text/analyze';
import { wrapToWidth } from '@/lib/text/wrap';
import {
  findSynonyms,
  findDefinition,
  wordAt,
  type SynonymOption,
} from '@/lib/text/synonyms';
import { loadSynonyms } from '@/lib/data/vocab';
import { lookupAbbreviation } from '@/lib/data/abbreviations';
import type { SynonymData } from '@/lib/data/types';

/**
 * Bullet Bench.
 *
 * The job is narrow and mechanical: take a statement that does not physically
 * fit the line a form gives it, and substitute half spaces for normal ones
 * until it does. It is a deterministic formatting operation, not a suggestion,
 * and the interface is built to say so -- no advice framing, no confidence
 * language, no decoration around a measurement.
 *
 * Fit is decided by rendered width, never by character count. Character count
 * is shown because some blocks are character-limited and all users think in it,
 * but width is what binds.
 *
 * Every readout follows the caret: the line you are editing is the line the
 * requirement, status, preview and checks all describe.
 */

const DRAFT_KEY = 'ocg.bullet-bench.draft.v2';

const SAMPLE = [
  '- Type or paste your bullets here, one bullet per line, and the shaped version appears in the box on the right as you type',
  '- Spacing is adjusted using U+2004 and U+2006 Unicode spaces, so it survives a copy-paste into the PDF form field',
  '- A bullet that cannot be squeezed onto one line stays red; hover over it to see roughly how many characters to trim',
  '- Both boxes are the real width of the form field, so a line that wraps here is a line that will wrap on the form itself',
  '- Your draft is saved in this browser alone. Nothing you type is ever uploaded, logged, tracked, or sent anywhere else',
].join('\n');

/**
 * A line fits when it is not wider than the field at the narrowest spacing.
 * Falling short of flush is not a fit failure -- the statement still occupies
 * one line, it just does not reach the right margin.
 */
function fits(result: ShapeResult): boolean {
  return result.status !== 'too-long';
}

type StatusState = 'ok' | 'bad' | 'idle';

const STATE_COLOR: Record<StatusState, string> = {
  ok: 'var(--ok)',
  bad: 'var(--bad)',
  idle: 'var(--ink-faint)',
};

export default function BulletBench() {
  const usable = useMemo(() => FORMS.filter((f) => isFormUsable(f.data)), []);
  const [formId, setFormId] = useState(() => usable[0]?.data.id ?? FORMS[0]!.data.id);

  const form = getForm(formId) ?? FORMS[0]!;
  const [fieldId, setFieldId] = useState(() => form.data.fields[0]!.id);
  const field = getField(form.data, fieldId) ?? form.data.fields[0]!;

  const [text, setText] = useState(SAMPLE);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [font, setFont] = useState<FontMetrics | null>(null);
  const [cssFamily, setCssFamily] = useState<string | null>(null);
  const [fontError, setFontError] = useState<string | null>(null);
  const [autoSpace, setAutoSpace] = useState(true);
  // The reference replaces approved abbreviations on the way to the output,
  // before any spacing work. Same order here: shortening the words first is
  // what gives the optimizer room to work with.
  const [abbreviate, setAbbreviate] = useState(true);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [activeLine, setActiveLine] = useState(0);
  const [copyNote, setCopyNote] = useState<string | null>(null);
  /** The word the caret or selection is on, and where it sits in the draft. */
  const [selection, setSelection] = useState<{
    word: string;
    start: number;
    end: number;
  } | null>(null);
  const [synonymData, setSynonymData] = useState<SynonymData | null>(null);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!getField(form.data, fieldId)) setFieldId(form.data.fields[0]!.id);
  }, [form, fieldId]);

  // localStorage only -- nothing leaves the browser. Read after mount so the
  // server-rendered markup and the first client render agree.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved !== null) setText(saved);
    } catch {
      /* Blocked storage: the editor still works, the draft is not remembered. */
    }
    setDraftLoaded(true);
  }, []);

  useEffect(() => {
    if (!draftLoaded) return;
    try {
      localStorage.setItem(DRAFT_KEY, text);
    } catch {
      /* Nothing to do. */
    }
  }, [text, draftLoaded]);

  useEffect(() => {
    let cancelled = false;
    const file = form.data.font.file;
    setFont(null);
    setCssFamily(null);
    setFontError(null);
    if (!file) {
      setFontError('This form has no font yet, so nothing can be measured.');
      return;
    }
    // The CSS face is display-only; measurement never waits on it.
    ensureFontFace(file).then(
      (family) => {
        if (!cancelled) setCssFamily(family);
      },
      () => {},
    );
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
  const measurable = font !== null && targetMm > 0 && sizePt > 0;

  /**
   * Both reference lists merged: used for the abbreviation pass on the output
   * and for the suggestions on a failed line.
   */
  const suggestionTable = useMemo(
    () => mergeAbbreviations([HQ_APPROVED.data, COMMON.data]),
    [],
  );

  /**
   * What the output is actually built from: the draft with approved
   * abbreviations substituted. Replacement runs before shaping, exactly as in
   * the reference -- abbreviating first frees width, and only then is it worth
   * adjusting spaces.
   */
  const sourceText = useMemo(() => {
    if (!abbreviate || suggestionTable.entries.length === 0) return text;
    return splitLines(text)
      .map((line) => applyAbbreviations(line, suggestionTable))
      .join('\n');
  }, [text, abbreviate, suggestionTable]);

  const results: ShapeResult[] = useMemo(() => {
    if (!font || targetMm <= 0 || sizePt <= 0) return [];
    return shapeDocument(sourceText, font, { targetMm, sizePt });
  }, [font, sourceText, targetMm, sizePt]);

  /** With Auto Space off, the output is the user's own spacing, normalized. */
  const outputLines = useMemo(
    () => results.map((r) => (autoSpace ? r.text : unshape(r.text))),
    [results, autoSpace],
  );

  const lines = useMemo(() => splitLines(text), [text]);
  const active = Math.min(activeLine, Math.max(0, results.length - 1));
  const activeResult = results[active];
  const activeText = outputLines[active] ?? '';

  const meanCharMm = useMemo(() => {
    if (!font || !activeResult || activeResult.charCount === 0) return 0;
    const plain = unshape(activeResult.text);
    return font.widthMm(plain, sizePt) / Math.max(1, [...plain].length);
  }, [font, activeResult, sizePt]);

  const spare = activeResult ? targetMm - activeResult.widthMm : 0;
  const charsSpare = meanCharMm > 0 ? Math.floor(spare / meanCharMm) : 0;

  const spaces = useMemo(() => countSpaces(activeText), [activeText]);
  const halfSpaces = spaces[SPACE_CHARS.SIX_PER_EM];
  const wideSpaces = spaces[SPACE_CHARS.THREE_PER_EM];

  const duplicates = useMemo(
    () => findDuplicates(text, STOPWORDS.data),
    [text],
  );

  /** Irregular whitespace the optimizer will collapse on the way out. */
  const needsNormalizing = useMemo(
    () => lines.some((l) => /\t| {2,}/.test(l) || l !== l.trim()),
    [lines],
  );

  const overLines = results.filter((r) => r.status !== 'empty' && !fits(r)).length;
  const liveLines = results.filter((r) => r.status !== 'empty').length;

  const counterText =
    !activeResult || activeResult.status === 'empty'
      ? '—'
      : maxChars > 0
        ? `${activeResult.charCount} / ${maxChars}`
        : `${activeResult.charCount} ch`;

  const shapedText = outputLines.join('\n');

  async function copyOutput() {
    try {
      await navigator.clipboard.writeText(shapedText);
      setCopyNote('Copied');
    } catch {
      // Clipboard access is refused on file:// and in locked-down browsers.
      mirrorRef.current?.focus();
      mirrorRef.current?.select();
      setCopyNote('Select + Ctrl+C');
    }
    window.setTimeout(() => setCopyNote(null), 3000);
  }

  function syncActiveLine(el: HTMLTextAreaElement) {
    const caret = el.selectionStart ?? 0;
    setActiveLine(el.value.slice(0, caret).split('\n').length - 1);

    // A drag-selection takes precedence over the caret, so highlighting a word
    // does what you would expect; otherwise fall back to the word under it.
    const end = el.selectionEnd ?? caret;
    if (end > caret) {
      const picked = el.value.slice(caret, end).trim();
      if (/^[A-Za-z'’-]+$/.test(picked)) {
        const start = el.value.indexOf(picked, caret);
        setSelection({ word: picked, start, end: start + picked.length });
        return;
      }
    }
    setSelection(wordAt(el.value, caret));
  }

  /** Loads the synonym chunk the first time a word is actually selected. */
  useEffect(() => {
    if (!selection || synonymData) return;
    let cancelled = false;
    loadSynonyms().then(
      (dataset) => {
        if (!cancelled) setSynonymData(dataset.data);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [selection, synonymData]);

  /**
   * Replacement options for the selected word, each carrying the width it
   * would add or save. Sorted by that delta so the shortest surface first --
   * on a line that will not fit, the shortest option is the useful one.
   */
  const options = useMemo(() => {
    if (!selection || !font) return [];
    const current = font.widthMm(selection.word, sizePt, false);

    const synonyms: Array<SynonymOption & { deltaMm: number; kind: 'synonym' | 'abbreviation' }> =
      synonymData
        ? findSynonyms(selection.word, synonymData).map((option) => ({
            ...option,
            kind: 'synonym' as const,
            deltaMm: font.widthMm(option.text, sizePt, false) - current,
          }))
        : [];

    // An approved abbreviation is usually the biggest single saving available,
    // so it belongs in the same list rather than somewhere separate.
    const abbr =
      lookupAbbreviation(selection.word, suggestionTable) ??
      lookupAbbreviation(selection.word, HQ_APPROVED.data);
    if (abbr && abbr.toLowerCase() !== selection.word.toLowerCase()) {
      synonyms.unshift({
        text: abbr,
        lemma: selection.word.toLowerCase(),
        reconstructed: false,
        kind: 'abbreviation',
        deltaMm: font.widthMm(abbr, sizePt, false) - current,
      });
    }

    const seen = new Set<string>();
    return synonyms
      .filter((o) => {
        const key = o.text.toLowerCase();
        if (key === selection.word.toLowerCase() || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => a.deltaMm - b.deltaMm || a.text.localeCompare(b.text));
  }, [selection, synonymData, font, sizePt, suggestionTable]);

  /** What the selected word actually means, so a shorter swap stays correct. */
  const definition = useMemo(
    () => (selection && synonymData ? findDefinition(selection.word, synonymData) : null),
    [selection, synonymData],
  );

  /** Whether the selected word repeats elsewhere, worth knowing before swapping. */
  const selectionRepeats = useMemo(() => {
    if (!selection) return 0;
    const found = duplicates.find((d) =>
      d.forms.includes(selection.word.toLowerCase()),
    );
    return found?.count ?? 0;
  }, [selection, duplicates]);

  function replaceSelection(replacement: string) {
    if (!selection) return;
    const next =
      text.slice(0, selection.start) + replacement + text.slice(selection.end);
    setText(next);
    setSelection({
      word: replacement,
      start: selection.start,
      end: selection.start + replacement.length,
    });
    // Put the caret back on the word just swapped, so a second look is easy.
    window.requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(selection.start, selection.start + replacement.length);
    });
  }

  const editorType = {
    fontFamily: 'var(--font-sans)',
    fontSize: '13px',
    lineHeight: '20px',
  } as const;

  const previewType = {
    fontFamily: cssFamily
      ? `'${cssFamily}', 'Times New Roman', Times, serif`
      : `'Times New Roman', Times, serif`,
    fontSize: `${sizePt}pt`,
    lineHeight: 1.3,
    fontKerning: 'normal' as const,
  };

  const statusState: StatusState = !measurable
    ? 'idle'
    : overLines > 0
      ? 'bad'
      : 'ok';

  const statusText = !measurable
    ? 'LOADING'
    : liveLines === 0
      ? 'EMPTY'
      : overLines > 0
        ? `${overLines} OF ${liveLines} OVER`
        : 'FITS';

  return (
    <div className="mx-auto flex max-w-[1560px] flex-col gap-4 px-6 py-5">
      {/* ---- Configuration bar ------------------------------------------ */}
      <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <Field label="Form / Document">
          <select
            aria-label="Form or document"
            value={formId}
            onChange={(e) => setFormId(e.target.value)}
            className="w-[330px] max-w-full border px-3 py-2 text-[12.5px]"
            style={{
              background: 'var(--panel)',
              borderColor: 'var(--rule-strong)',
              color: 'var(--ink)',
            }}
          >
            {FORMS.map((f) => (
              <option key={f.data.id} value={f.data.id} disabled={!isFormUsable(f.data)}>
                {f.data.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Section">
          <select
            aria-label="Section"
            value={field.id}
            onChange={(e) => setFieldId(e.target.value)}
            className="w-[270px] max-w-full border px-3 py-2 text-[12.5px]"
            style={{
              background: 'var(--panel)',
              borderColor: 'var(--rule-strong)',
              color: 'var(--ink)',
            }}
          >
            {form.data.fields.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Requirements">
          <span
            className="flex items-center gap-2 py-2 text-[12.5px]"
            style={{ color: 'var(--ink)' }}
            title={
              bindsOnWidth
                ? 'Fit is decided by rendered width, not character count. The character figure is informational.'
                : 'This block is limited by character count.'
            }
          >
            {bindsOnWidth ? `${roundMm(targetMm, 2)} mm line` : `Max ${maxChars} characters`}
            <span
              aria-hidden
              className="inline-flex h-[15px] w-[15px] items-center justify-center rounded-full border text-[9px]"
              style={{ borderColor: 'var(--rule-strong)', color: 'var(--ink-faint)' }}
            >
              i
            </span>
          </span>
        </Field>

        <Field label="Status">
          <span className="flex items-center gap-3 py-2 text-[12.5px]">
            <span style={{ color: STATE_COLOR[statusState] }}>{statusText}</span>
            {measurable && activeResult && activeResult.status !== 'empty' && (
              <>
                <span style={{ color: 'var(--rule-strong)' }}>|</span>
                <span style={{ color: 'var(--ink-muted)' }}>
                  {spare >= 0
                    ? `${charsSpare} characters remaining`
                    : `${roundMm(-spare, 1)} mm over`}
                </span>
              </>
            )}
          </span>
        </Field>

        <div className="ml-auto flex items-center gap-3">
          {copyNote && <span className="util">{copyNote}</span>}
          <button
            type="button"
            onClick={copyOutput}
            disabled={!measurable}
            className="util flex items-center gap-2 border px-4 py-2.5"
            style={{
              background: 'var(--panel)',
              borderColor: 'var(--rule-strong)',
              color: measurable ? 'var(--ink)' : 'var(--ink-faint)',
              letterSpacing: '0.1em',
            }}
          >
            <span aria-hidden>⧉</span> Copy Output
          </button>
        </div>
      </div>

      {fontError && (
        <div
          role="alert"
          className="panel px-3 py-2 text-[12px]"
          style={{ background: 'var(--bad-dim)', color: 'var(--bad)' }}
        >
          {fontError}
        </div>
      )}

      {/* ---- Workspace --------------------------------------------------- */}
      <div className="grid items-stretch gap-3 lg:grid-cols-[1fr_auto_1fr]">
        {/* Draft */}
        <section className="panel flex flex-col p-4">
          <div className="mb-3 flex items-start justify-between gap-4">
            <div>
              <h2 className="title m-0">Draft</h2>
              <p className="m-0 mt-1 text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
                Enter your bullet below.
              </p>
            </div>
            <span className="text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
              {counterText}
            </span>
          </div>

          {/*
            Same field width and same face as the output. That is the whole
            comparison the reference is built around: the draft wraps where the
            form wraps, the output does not, and the difference is the point.
          */}
          <FieldBox widthMm={targetMm} type={previewType} over={false} minHeight={230} neutral>
            <div className="relative">
              {/* Duplicate highlighting sits behind a transparent textarea;
                  identical type and padding keep the marks on the glyphs. */}
              <div
                ref={overlayRef}
                aria-hidden
                className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words"
                style={{ ...previewType, color: 'transparent' }}
              >
                {showDuplicates ? <DuplicateMarks text={text} words={duplicates} /> : null}
              </div>
              <textarea
                ref={inputRef}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  syncActiveLine(e.currentTarget);
                }}
                onSelect={(e) => syncActiveLine(e.currentTarget)}
                onScroll={(e) => {
                  if (overlayRef.current) {
                    overlayRef.current.scrollTop = e.currentTarget.scrollTop;
                  }
                }}
                spellCheck
                aria-label="Draft"
                placeholder="Paste or type your statement."
                className="relative block w-full resize-none border-0 bg-transparent p-0 outline-none"
                style={{ ...previewType, minHeight: 206, color: 'var(--ink)' }}
              />
            </div>
          </FieldBox>

          <div
            className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-t pt-3 text-[11.5px]"
            style={{ borderColor: 'var(--rule)' }}
          >
            <Toggle checked={autoSpace} onChange={setAutoSpace} label="Auto-Space" />
            <Toggle checked={abbreviate} onChange={setAbbreviate} label="Abbreviate" />
            <Toggle
              checked={showDuplicates}
              onChange={setShowDuplicates}
              label="Show Duplicates"
            />
            <span style={{ color: 'var(--rule-strong)' }}>|</span>
            <span style={{ color: 'var(--ink-muted)' }}>
              Formatting:{' '}
              <span style={{ color: needsNormalizing ? 'var(--warn)' : 'var(--ok)' }}>
                {needsNormalizing ? 'Irregular' : 'Normalized'}
              </span>
            </span>
          </div>
        </section>

        {/* Direction */}
        <div className="hidden items-center justify-center lg:flex" aria-hidden>
          <span style={{ color: 'var(--ink-faint)', fontSize: '16px' }}>&rarr;</span>
        </div>

        {/* Output */}
        <section className="panel flex flex-col p-4">
          <div className="mb-3 flex items-start justify-between gap-4">
            <div>
              <h2 className="title m-0">Output</h2>
              <p className="m-0 mt-1 text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
                Optimized to fit on one line using half-spaces.
              </p>
            </div>
            <span
              className="text-[12.5px]"
              style={{ color: statusState === 'bad' ? 'var(--bad)' : 'var(--ok)' }}
            >
              {counterText}
            </span>
          </div>

          {/*
            Rendered at the field's real width in the form's real face, with
            our own line breaks. This is not decoration: the pane previously
            wrapped by browser width in a monospace font, so replacing a word
            with a shorter one -- which flips the optimizer from narrowing to
            widening -- visibly pushed a fitting line onto a second row. What
            you see here is now what the form does.
          */}
          <FieldBox
            widthMm={targetMm}
            type={previewType}
            over={statusState === 'bad'}
            minHeight={230}
          >
            {!measurable ? (
              <p className="util m-0">{font ? 'No target width' : 'Loading'}</p>
            ) : (
              results.map((result, index) => {
                if (result.status === 'empty') return <div key={index}>&nbsp;</div>;
                const bad = !fits(result);
                const rows = wrapToWidth(outputLines[index]!, font!, sizePt, targetMm);
                return (
                  <div
                    key={index}
                    title={
                      bad && font
                        ? (diagnose(result, { font, sizePt, abbreviations: suggestionTable })
                            ?.message ?? undefined)
                        : undefined
                    }
                    onMouseDown={() => setActiveLine(index)}
                    style={{ color: bad ? 'var(--bad)' : 'var(--ink)' }}
                  >
                    {rows.map((row, r) => (
                      <div key={r} style={{ whiteSpace: 'pre' }}>
                        {row}
                      </div>
                    ))}
                  </div>
                );
              })
            )}
          </FieldBox>

          <div
            className="mt-3 border-t pt-3 text-[11.5px]"
            style={{ borderColor: 'var(--rule)' }}
          >
            <span
              style={{
                color: halfSpaces > 0 || wideSpaces > 0 ? 'var(--ok)' : 'var(--ink-muted)',
              }}
            >
              {!autoSpace
                ? 'Auto-Space off'
                : halfSpaces > 0
                  ? 'Half-Spaces Applied'
                  : wideSpaces > 0
                    ? 'Spacing Widened'
                    : 'No Change Needed'}
            </span>
          </div>
        </section>
      </div>

      {/* ---- Synonyms ---------------------------------------------------- */}
      <section className="panel p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="title m-0">Definition &amp; Synonyms</h2>
          <span className="util">
            {selection
              ? `Selected: ${selection.word}`
              : 'Select a word in the draft'}
          </span>
        </div>

        {selection && (
          <div
            className="mt-3 rounded-[4px] border p-3"
            style={{ background: 'var(--panel-sunk)', borderColor: 'var(--rule)' }}
          >
            <div className="flex flex-wrap items-baseline gap-x-2.5">
              <span className="text-[12.5px]" style={{ color: 'var(--ink)' }}>
                {definition?.lemma ?? selection.word}
              </span>
              {definition && (
                <span className="util" style={{ textTransform: 'none', fontStyle: 'italic' }}>
                  {definition.partOfSpeech}
                </span>
              )}
              {definition?.reduced && (
                <span className="util" title="Defined under its dictionary form">
                  from "{selection.word}"
                </span>
              )}
            </div>
            <p className="m-0 mt-1.5 text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
              {definition
                ? definition.text
                : synonymData
                  ? 'No definition available for this word.'
                  : 'Loading word list\u2026'}
            </p>
          </div>
        )}

        {selectionRepeats > 1 && (
          <p className="m-0 mt-2 text-[11.5px]" style={{ color: 'var(--warn)' }}>
            "{selection?.word}" appears {selectionRepeats} times in this draft.
          </p>
        )}

        {!selection ? (
          <p className="m-0 mt-3 text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
            Highlight or click a word on the left. Replacements are listed shortest first,
            with the width each one adds or saves.
          </p>
        ) : options.length === 0 ? (
          <p className="m-0 mt-3 text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
            {synonymData
              ? `No synonyms for "${selection.word}".`
              : 'Loading word list\u2026'}
          </p>
        ) : (
          <ul className="m-0 mt-3 flex list-none flex-wrap gap-2 p-0">
            {options.map((option) => (
              <li key={`${option.kind}-${option.text}`}>
                <button
                  type="button"
                  onClick={() => replaceSelection(option.text)}
                  className="flex items-baseline gap-2 border px-2.5 py-1.5 text-[12px]"
                  title={
                    option.kind === 'abbreviation'
                      ? 'Approved abbreviation'
                      : option.reconstructed
                        ? `From "${option.lemma}", put back into the tense you selected`
                        : undefined
                  }
                  style={{
                    background: 'var(--panel-sunk)',
                    borderColor:
                      option.kind === 'abbreviation' ? 'var(--ok)' : 'var(--rule-strong)',
                    color: 'var(--ink)',
                  }}
                >
                  <span>{option.text}</span>
                  <span
                    className="tabular text-[10.5px]"
                    style={{
                      color: option.deltaMm < 0 ? 'var(--ok)' : 'var(--ink-faint)',
                    }}
                  >
                    {option.deltaMm < 0 ? '' : '+'}
                    {roundMm(option.deltaMm, 1)}mm
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Off-screen mirror so Copy has something to select when the clipboard
          API is unavailable, as it is under file://. */}
      <textarea
        ref={mirrorRef}
        readOnly
        value={shapedText}
        tabIndex={-1}
        aria-hidden
        className="absolute h-px w-px overflow-hidden opacity-0"
      />
    </div>
  );
}

/**
 * Draws its children at the field's true width, scaled down to fit the column.
 *
 * CSS `mm` is a fixed 96dpi unit, so the field is always the same pixel width
 * regardless of window size. Scaling keeps that geometry intact rather than
 * reflowing it; line breaks are computed from font metrics, so the scale factor
 * cannot move them.
 */
function FieldBox({
  widthMm,
  type,
  over,
  minHeight,
  neutral = false,
  children,
}: {
  widthMm: number;
  type: React.CSSProperties;
  over: boolean;
  minHeight: number;
  /** Draft box: no pass/fail colour, since it is not a verdict. */
  neutral?: boolean;
  children: React.ReactNode;
}) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState<number | undefined>(undefined);
  const widthPx = widthMm > 0 ? (widthMm / 25.4) * 96 : 0;

  useEffect(() => {
    const outerEl = outer.current;
    const innerEl = inner.current;
    if (!outerEl || !innerEl || widthPx <= 0) return;
    const update = () => {
      const next = Math.min(1, (outerEl.clientWidth || widthPx) / widthPx);
      setScale(next);
      setHeight(innerEl.offsetHeight * next);
    };
    update();
    // Absent in jsdom and older browsers; the pane still renders without it.
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(outerEl);
    observer.observe(innerEl);
    return () => observer.disconnect();
  }, [widthPx]);

  return (
    <div
      ref={outer}
      className="flex-1 overflow-hidden rounded-[4px] border p-3"
      style={{
        background: 'var(--panel-sunk)',
        borderColor: neutral ? 'var(--rule)' : over ? 'var(--bad)' : 'var(--ok)',
        minHeight,
        height: height === undefined ? undefined : Math.max(minHeight, height + 24),
      }}
    >
      <div
        ref={inner}
        style={{
          ...type,
          width: widthPx > 0 ? widthPx : '100%',
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
        }}
      >
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="util">{label}</span>
      {children}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <label className="util flex cursor-pointer items-center gap-1.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ accentColor: 'var(--ok)' }}
      />
      {label}
    </label>
  );
}

function DuplicateMarks({
  text,
  words,
}: {
  text: string;
  words: { forms: string[]; related: boolean }[];
}) {
  if (words.length === 0) return <>{text}</>;

  const lookup = new Map<string, boolean>();
  for (const entry of words) {
    for (const form of entry.forms) lookup.set(form, entry.related);
  }

  const parts = text.split(/([A-Za-z][A-Za-z'’-]*)/g);
  return (
    <>
      {parts.map((part, i) => {
        const related = lookup.get(part.toLowerCase());
        if (related === undefined) return part;
        return (
          <span
            key={i}
            style={{
              // Softer for inflections (led/leads) than for a literal repeat.
              background: related ? 'var(--warn-dim)' : 'var(--bad-dim)',
              boxShadow: `inset 0 -1px 0 ${related ? 'var(--warn)' : 'var(--bad)'}`,
            }}
          >
            {part}
          </span>
        );
      })}
    </>
  );
}
