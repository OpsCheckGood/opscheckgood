import { useEffect, useMemo, useRef, useState } from 'react';
import { FORMS, getForm, getField, isFormUsable } from '@/lib/data/forms';
import { HQ_APPROVED, COMMON } from '@/lib/data/abbreviationSets';
import { mergeAbbreviations, applyAbbreviations } from '@/lib/data/abbreviations';
import {
  effectiveTable,
  entryKey,
  loadOverrides,
  saveOverrides,
  type Overrides,
} from '@/lib/data/abbreviationStore';
import { parsePdfBulletsFile, serializePdfBulletsFile } from '@/lib/data/pdfBulletsFile';
import { readForm, bulletFields } from '@/lib/pdf/form';
import { loadBenchPrefs, saveBenchPrefs, DEFAULT_BENCH_PREFS } from '@/lib/settings';
import { useMediaQuery, NARROW } from '@/lib/useMediaQuery';
import { STOPWORDS, WEAK_OPENERS } from '@/lib/data/vocab';
import { loadFontMetrics } from '@/lib/metrics/registry';
import { ensureFontFace } from '@/lib/metrics/fontface';
import type { FontMetrics } from '@/lib/metrics/font';
import { roundMm } from '@/lib/metrics/units';
import type { ShapeStatus } from '@/lib/shape/optimizer';
import {
  bulletText,
  displayRows,
  rowStatuses,
  shapeBullets,
  type BulletResult,
} from '@/lib/shape/bullet';
import { diagnose } from '@/lib/shape/diagnose';
import { SPACE_CHARS, countSpaces, plainSpaces, unshape } from '@/lib/shape/spaces';
import { splitLines } from '@/lib/text/tokenize';
import { findDuplicates } from '@/lib/text/analyze';
import { reviewDraft, KIND_LABEL, type Finding, type Occurrence } from '@/lib/text/review';
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
 *
 * ## The boxes are pdf-bullets' boxes
 *
 * The draft and the output are drawn the way github.com/AF-VCD/pdf-bullets
 * draws them, because that is the tool people already trust and the point is
 * for a bullet to look and behave identically here:
 *
 *   - each box is the field width plus one millimetre, with a 1.1px border
 *     and no padding, so text starts at the box edge and a line that reaches
 *     the field width reaches the box edge;
 *   - the type is Times New Roman at the form's size, 1.5 line height, with
 *     kerning off -- the measurement is unkerned, and a kerned drawing would
 *     sit a fraction narrower than the verdict says;
 *   - the boxes are never scaled down. Scaling shrank the type and the spacing
 *     with it, which is exactly what people compared against pdf-bullets and
 *     found different. When two boxes do not fit beside each other they stack;
 *   - each output bullet is at least as tall as its draft line, so the two
 *     boxes read across line for line;
 *   - a line is red when the optimizer could not land it: over the field even
 *     with every gap narrowed, or short of it by more than the underflow bound
 *     even with every gap widened. Short is a failure there, so it is here.
 *
 * One thing pdf-bullets does not do: a bullet too long for one row is broken
 * where the form will break it and every full row is shaped, with the last
 * row left as typed. See shape/bullet.ts. The other panels -- Review, and
 * Definition & Synonyms -- are separate boxes that read the same draft. There
 * is one text box on purpose: a second one to paste into would be a second
 * copy, and the two would drift.
 */

const DRAFT_KEY = 'ocg.bullet-bench.draft.v2';

// Every line lands within the field, and no word repeats across them: the
// sample is the first thing a visitor sees, and it should not be a rainbow.
const SAMPLE = [
  '- Type or paste your bullets here, one per row, and the shaped version appears in the pane on the right as it is typed',
  '- Spacing is adjusted with U+2004 and U+2006 Unicode characters, so it survives a copy-paste into the PDF text field',
  '- A statement that cannot be squeezed onto a single line stays red; hover over it to see roughly how much needs to go',
  '- Both boxes are the true width of the block, so whatever wraps in this editor breaks the same way on the real form',
  '- Everything you write is saved in this browser alone. Nothing is ever uploaded, logged, tracked, or sent anywhere else',
].join('\n');

/**
 * pdf-bullets' verdict: the line landed. Anything else is red there -- over
 * the field with every gap narrowed, or short of it by more than the underflow
 * bound with every gap widened -- and so it is red here.
 */
function landed(status: ShapeStatus): boolean {
  return status === 'at-target' || status === 'shaped';
}

/** Bulma's body line height, which is what pdf-bullets' boxes inherit. */
const LINE_HEIGHT = 1.5;

/** Enough empty box to invite typing; both boxes share it so they stay level. */
const BOX_MIN_HEIGHT = 230;

type StatusState = 'ok' | 'warn' | 'bad' | 'idle';

const STATE_COLOR: Record<StatusState, string> = {
  ok: 'var(--ok)',
  warn: 'var(--warn)',
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
  const [autoSpace, setAutoSpace] = useState(DEFAULT_BENCH_PREFS.autoSpace);
  // Approved abbreviations are replaced on the way to the output, before any
  // spacing work: shortening the words first is what gives the optimizer room.
  const [abbreviate, setAbbreviate] = useState(DEFAULT_BENCH_PREFS.abbreviate);
  const [showDuplicates, setShowDuplicates] = useState(DEFAULT_BENCH_PREFS.showDuplicates);
  const [activeLine, setActiveLine] = useState(0);
  const [copyNote, setCopyNote] = useState<string | null>(null);
  /** Two-step clear: one click arms it, a second within a few seconds does it. */
  const [clearArmed, setClearArmed] = useState(false);
  /** The word the caret or selection is on, and where it sits in the draft. */
  const [selection, setSelection] = useState<{
    word: string;
    start: number;
    end: number;
  } | null>(null);
  const [synonymData, setSynonymData] = useState<SynonymData | null>(null);
  /** Whatever the Abbreviations page has been edited to say. */
  const [overrides, setOverrides] = useState<Overrides | null>(null);

  const narrow = useMediaQuery(NARROW);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  /** In-flow twin of the textarea: sizes it, carries the marks, measures lines. */
  const draftMirrorRef = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<HTMLTextAreaElement>(null);
  /** Rendered height of each draft line, so the output can sit level with it. */
  const [lineHeights, setLineHeights] = useState<number[]>([]);

  useEffect(() => {
    if (!getField(form.data, fieldId)) setFieldId(form.data.fields[0]!.id);
  }, [form, fieldId]);

  // localStorage only -- nothing leaves the browser. Read after mount so the
  // server-rendered markup and the first client render agree.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      // Drafts stored before the bench stripped odd spaces may still hold them.
      if (saved !== null) setText(plainSpaces(saved));
    } catch {
      /* Blocked storage: the editor still works, the draft is not remembered. */
    }
    // The toggles used to reset on every visit; they are preferences, so they
    // come from the same place the Settings page writes.
    const prefs = loadBenchPrefs();
    setAutoSpace(prefs.autoSpace);
    setAbbreviate(prefs.abbreviate);
    setShowDuplicates(prefs.showDuplicates);
    if (prefs.formId && getForm(prefs.formId)) {
      setFormId(prefs.formId);
      if (prefs.fieldId) setFieldId(prefs.fieldId);
    }
    setDraftLoaded(true);
  }, []);

  // Write back so a change made here survives, and matches what Settings shows.
  useEffect(() => {
    if (!draftLoaded) return;
    saveBenchPrefs({
      ...loadBenchPrefs(),
      autoSpace,
      abbreviate,
      showDuplicates,
    });
  }, [autoSpace, abbreviate, showDuplicates, draftLoaded]);

  // Read after mount, and again when the tab regains focus, so an edit made on
  // the Abbreviations page in another tab is picked up without a reload.
  useEffect(() => {
    const read = () => setOverrides(loadOverrides());
    read();
    window.addEventListener('focus', read);
    return () => window.removeEventListener('focus', read);
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
  const suggestionTable = useMemo(() => {
    if (!overrides) return mergeAbbreviations([HQ_APPROVED.data, COMMON.data]);
    return mergeAbbreviations([
      effectiveTable('hq', overrides),
      effectiveTable('common', overrides),
    ]);
  }, [overrides]);

  /**
   * What the output is actually built from: the draft with approved
   * abbreviations substituted. Replacement runs before shaping: abbreviating
   * frees real width, and only then is it worth adjusting spaces.
   */
  const sourceText = useMemo(() => {
    if (!abbreviate || suggestionTable.entries.length === 0) return text;
    return splitLines(text)
      .map((line) => applyAbbreviations(line, suggestionTable))
      .join('\n');
  }, [text, abbreviate, suggestionTable]);

  const results: BulletResult[] = useMemo(() => {
    if (!font || targetMm <= 0 || sizePt <= 0) return [];
    return shapeBullets(sourceText, font, { targetMm, sizePt });
  }, [font, sourceText, targetMm, sizePt]);

  /** With Auto Space off, the output is the user's own spacing, normalized. */
  const outputLines = useMemo(
    () => results.map((b) => bulletText(b, autoSpace)),
    [results, autoSpace],
  );

  const lines = useMemo(() => splitLines(text), [text]);
  const active = Math.min(activeLine, Math.max(0, results.length - 1));
  const activeBullet = results[active];
  /** The bullet as one row: the readouts describe that, wrapped or not. */
  const activeResult = activeBullet?.whole;
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

  /**
   * One highlighter colour per repeated word, keyed by every form of it, so
   * the draft marks and the Review list agree. Eight colours cycle; the list
   * is ordered most-repeated first, so the words that matter most are the
   * ones least likely to share a colour.
   */
  const duplicateColour = useMemo(() => {
    const map = new Map<string, string>();
    duplicates.forEach((entry, i) => {
      const token = `var(--hl-${HIGHLIGHT_KEYS[i % HIGHLIGHT_KEYS.length]})`;
      for (const form of entry.forms) map.set(form, token);
    });
    return map;
  }, [duplicates]);

  /** Irregular whitespace the optimizer will collapse on the way out. */
  const needsNormalizing = useMemo(
    () => lines.some((l) => /\t| {2,}/.test(l) || l !== l.trim()),
    [lines],
  );

  /**
   * The verdict per row of each bullet. With Auto-Space off the output is the
   * text as typed, so the verdict is about that text, exactly as pdf-bullets
   * judges it with its optimizer switched off.
   */
  const rowVerdicts: ShapeStatus[][] = useMemo(
    () => results.map((b) => rowStatuses(b, autoSpace)),
    [results, autoSpace],
  );
  const overLines = rowVerdicts.filter((rows) => rows.includes('too-long')).length;
  const shortLines = rowVerdicts.filter((rows) => rows.includes('too-short')).length;
  const wrappedLines = results.filter((b) => b.wrapped).length;
  const liveLines = results.filter((b) => b.whole.status !== 'empty').length;

  /** What a reviewer would say, as a list. Reads the draft, not the output. */
  const findings = useMemo(
    () =>
      reviewDraft(text, {
        stopwords: STOPWORDS.data,
        hq: HQ_APPROVED.data,
        common: COMMON.data,
        weakOpeners: WEAK_OPENERS.data,
      }),
    [text],
  );
  /** Which occurrence of each finding the last click went to. */
  const [visited, setVisited] = useState<Record<string, number>>({});

  function jumpTo(finding: Finding) {
    const key = `${finding.kind}:${finding.token}`;
    const next = ((visited[key] ?? -1) + 1) % finding.occurrences.length;
    setVisited({ ...visited, [key]: next });
    const occurrence: Occurrence = finding.occurrences[next]!;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(occurrence.start, occurrence.end);
    syncActiveLine(el);
    const row = draftMirrorRef.current?.children[occurrence.line] as HTMLElement | undefined;
    row?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  /**
   * Keeps each output bullet level with its draft line, the way pdf-bullets
   * gives every output bullet the height of its input block. Measured off the
   * mirror rather than the textarea, which has no per-line elements.
   */
  useEffect(() => {
    const mirror = draftMirrorRef.current;
    if (!mirror) return;
    const measure = () => {
      const next = [...mirror.children].map((el) => (el as HTMLElement).offsetHeight);
      setLineHeights((prev) =>
        prev.length === next.length && prev.every((h, i) => h === next[i]) ? prev : next,
      );
    };
    measure();
    // Absent in jsdom and older browsers; the panes still render without it.
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(mirror);
    return () => observer.disconnect();
  }, [lines, showDuplicates, cssFamily, narrow]);

  const counterText =
    !activeResult || activeResult.status === 'empty'
      ? '—'
      : maxChars > 0
        ? `${activeResult.charCount} / ${maxChars}`
        : `${activeResult.charCount} ch`;

  /** The active bullet, in the user's units: rows, and characters to cut or spare. */
  const activeReadout = (() => {
    if (!measurable || !activeBullet || !activeResult || activeResult.status === 'empty') return null;
    if (activeBullet.wrapped) {
      const overBy = activeResult.minWidthMm - targetMm;
      const cut = meanCharMm > 0 ? Math.max(1, Math.round(overBy / meanCharMm)) : 0;
      return `${activeBullet.rows.length} rows · cut ~${cut} characters for one row`;
    }
    return spare >= 0 ? `${charsSpare} characters remaining` : `${roundMm(-spare, 1)} mm over`;
  })();

  const shapedText = outputLines.join('\n');

  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * Reads a pdf-bullets save file: the bullets replace the draft, and its
   * abbreviation table lands in the user's own additions to the Common list,
   * so nothing has to be retyped to switch tools.
   */
  async function importFile(file: File) {
    let note: string;
    try {
      const save = parsePdfBulletsFile(await file.text());
      setText(plainSpaces(save.text));
      setSelection(null);
      if (save.autoSpace !== null) setAutoSpace(save.autoSpace);

      let added = 0;
      if (save.abbreviations.length > 0) {
        const current = overrides ?? loadOverrides();
        const known = new Set(
          [...COMMON.data.entries, ...current.common.custom].map(entryKey),
        );
        const custom = [...current.common.custom];
        const disabled = new Set(current.common.disabled);
        for (const entry of save.abbreviations) {
          const key = entryKey(entry);
          if (!known.has(key)) {
            custom.push({ phrase: entry.phrase, abbr: entry.abbr });
            known.add(key);
            added += 1;
          }
          if (entry.enabled) disabled.delete(key);
          else disabled.add(key);
        }
        const next: Overrides = {
          ...current,
          common: { custom, disabled: [...disabled] },
        };
        saveOverrides(next);
        setOverrides(next);
      }

      const bullets = splitLines(save.text).filter((l) => l.trim() !== '').length;
      note = `Imported ${bullets} bullet${bullets === 1 ? '' : 's'}`;
      if (added > 0) note += `, ${added} abbreviation${added === 1 ? '' : 's'}`;
      if (save.widthMm !== null && Math.abs(save.widthMm - targetMm) > 0.01) {
        note += ` · file was ${roundMm(save.widthMm, 2)} mm, this form is ${roundMm(targetMm, 2)} mm`;
      }
    } catch (error: unknown) {
      note = error instanceof Error ? error.message : 'Could not read that file.';
    }
    setCopyNote(note);
    window.setTimeout(() => setCopyNote(null), 6000);
  }

  const formInputRef = useRef<HTMLInputElement>(null);

  /**
   * Opens a form PDF: the 1206 someone was sent, or a 910 with comments in
   * it. The form is identified from its own XFA data, the matching definition
   * is selected, and the bullets in its first filled block go into the draft.
   * The widths come from the data file, which the tests hold equal to what the
   * form says; the file only tells us which form it is and what it holds.
   */
  async function openFormFile(file: File) {
    let note: string;
    try {
      const form = await readForm(new Uint8Array(await file.arrayBuffer()));
      const number = form.formNumber?.replace(/^DAF/, 'AF') ?? null;
      const known = number
        ? FORMS.find((f) => `AF FORM ${f.data.id.replace(/^af/, '')}` === number)
        : undefined;
      const blocks = bulletFields(form);
      const filled = blocks.find((b) => b.value !== null);

      if (known) {
        setFormId(known.data.id);
        const field = filled && getField(known.data, filled.name) ? filled.name : undefined;
        if (field) setFieldId(field);
      }
      if (filled) {
        setText(plainSpaces(filled.value!));
        setSelection(null);
      }

      const what = form.formNumber ?? 'a form this tool does not know';
      const edition = form.edition ? ` (${form.edition})` : '';
      note = filled
        ? `Read ${what}${edition}: ${splitLines(filled.value!).filter((l) => l.trim() !== '').length} bullets from ${filled.name}`
        : `Read ${what}${edition}: no bullets in it`;
      if (!known && blocks[0]?.widthMm) {
        note += ` · its block is ${roundMm(blocks[0].widthMm, 2)} mm; this tool has no definition for it yet`;
      }
    } catch (error: unknown) {
      note = error instanceof Error ? error.message : 'Could not read that PDF.';
    }
    setCopyNote(note);
    window.setTimeout(() => setCopyNote(null), 8000);
  }

  /** Writes the draft in pdf-bullets' own format, so its Import reads it. */
  function exportFile() {
    const raw = serializePdfBulletsFile({
      text,
      widthMm: targetMm > 0 ? targetMm : null,
      autoSpace,
      abbreviations: suggestionTable.entries.map((e) => ({
        phrase: e.phrase,
        abbr: e.abbr,
        enabled: true,
      })),
    });
    const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bullets.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

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

  /**
   * Wipes the draft and the stored copy.
   *
   * Armed on the first click rather than acting immediately: this destroys
   * typed work that no undo can recover, because the textarea's value is being
   * set programmatically.
   */
  function clearDraft() {
    if (!clearArmed) {
      setClearArmed(true);
      window.setTimeout(() => setClearArmed(false), 4000);
      return;
    }
    setClearArmed(false);
    setText('');
    setSelection(null);
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* Nothing stored to remove. */
    }
    inputRef.current?.focus();
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

  /**
   * pdf-bullets' type, exactly: Times New Roman at the form's size, kerning
   * off, geometric precision. The installed Times New Roman is preferred so
   * the drawing matches pdf-bullets glyph for glyph on the machines people
   * compare on; the bundled Liberation Serif, which shares its metrics, stands
   * in where Times is not installed. Measurement never depends on either --
   * it reads the bundled font file.
   */
  const previewType = {
    fontFamily: cssFamily
      ? `'Times New Roman', '${cssFamily}', Times, serif`
      : `'Times New Roman', Times, serif`,
    fontSize: `${sizePt}pt`,
    lineHeight: LINE_HEIGHT,
    fontKerning: 'none' as const,
    textRendering: 'geometricPrecision' as const,
  };

  /**
   * A pane takes its width from the box inside it. Two fit side by side on a
   * wide screen and stack otherwise; on a phone each takes the full row.
   */
  const paneStyle = {
    flex: narrow ? '1 1 100%' : '1 1 auto',
    maxWidth: '100%',
    overflowX: 'auto' as const,
  };

  const statusState: StatusState = !measurable
    ? 'idle'
    : overLines + shortLines > 0
      ? 'bad'
      : wrappedLines > 0
        ? 'warn'
        : 'ok';

  const statusText = !measurable
    ? 'LOADING'
    : liveLines === 0
      ? 'EMPTY'
      : overLines + shortLines + wrappedLines > 0
        ? [
            overLines > 0 && `${overLines} OVER`,
            shortLines > 0 && `${shortLines} SHORT`,
            wrappedLines > 0 && `${wrappedLines} WRAP${wrappedLines === 1 ? 'S' : ''}`,
          ]
            .filter(Boolean)
            .join(', ')
        : 'FITS';

  return (
    <div className="mx-auto flex max-w-[1700px] flex-col gap-4 px-3 py-4 sm:px-6 sm:py-5">
      {/* ---- Configuration bar ------------------------------------------ */}
      <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <Field label="Form / Document">
          <select
            aria-label="Form or document"
            value={formId}
            onChange={(e) => setFormId(e.target.value)}
            className="w-full border px-3 py-2 text-[13px] sm:w-[330px]"
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
            className="w-full border px-3 py-2 text-[13px] sm:w-[270px]"
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
            className="flex items-center gap-2 py-2 text-[13px]"
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

        {/*
          The one flexible item in the bar. Its basis is fixed so the wrap
          decision never depends on how much the readout says: a long readout
          truncates inside the slot instead of pushing the buttons onto a new
          row and shifting the whole workspace. The transient note lives here
          for the same reason.
        */}
        <Field label="Status" style={{ flex: '1 1 220px', minWidth: 0 }}>
          <span className="flex min-w-0 items-center gap-3 whitespace-nowrap py-2 text-[13px]">
            <span className="shrink-0" style={{ color: STATE_COLOR[statusState] }}>
              {statusText}
            </span>
            {activeReadout && (
              <>
                <span className="shrink-0" style={{ color: 'var(--rule-strong)' }}>
                  |
                </span>
                <span
                  className="truncate"
                  title={activeReadout}
                  style={{ color: 'var(--ink-muted)' }}
                >
                  {activeReadout}
                </span>
              </>
            )}
            {copyNote && <span className="util ml-auto shrink-0 pl-3">{copyNote}</span>}
          </span>
        </Field>

        <div className="ml-auto flex flex-wrap items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            aria-hidden
            tabIndex={-1}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void importFile(file);
            }}
          />
          <input
            ref={formInputRef}
            type="file"
            accept=".pdf,application/pdf"
            className="hidden"
            aria-hidden
            tabIndex={-1}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void openFormFile(file);
            }}
          />
          <button
            type="button"
            onClick={() => formInputRef.current?.click()}
            className="util border px-3 py-2.5"
            title="Open an AF form PDF (1206, 910, 911). The form is recognised from its own data and the bullets already in it go into the draft. The file never leaves this browser."
            style={{
              background: 'var(--panel)',
              borderColor: 'var(--rule-strong)',
              color: 'var(--ink-muted)',
              letterSpacing: '0.1em',
            }}
          >
            Open Form
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="util border px-3 py-2.5"
            title="Open a pdf-bullets save file (.json). Its bullets replace the draft; its abbreviations join your Common list."
            style={{
              background: 'var(--panel)',
              borderColor: 'var(--rule-strong)',
              color: 'var(--ink-muted)',
              letterSpacing: '0.1em',
            }}
          >
            Import
          </button>
          <button
            type="button"
            onClick={exportFile}
            className="util border px-3 py-2.5"
            title="Save the draft as a pdf-bullets file (.json)"
            style={{
              background: 'var(--panel)',
              borderColor: 'var(--rule-strong)',
              color: 'var(--ink-muted)',
              letterSpacing: '0.1em',
            }}
          >
            Export
          </button>
          <button
            type="button"
            onClick={clearDraft}
            className="util border px-3 py-2.5"
            title="Removes the draft from this browser"
            style={{
              background: 'var(--panel)',
              borderColor: clearArmed ? 'var(--bad)' : 'var(--rule-strong)',
              color: clearArmed ? 'var(--bad)' : 'var(--ink-muted)',
              letterSpacing: '0.1em',
            }}
          >
            {clearArmed ? 'Clear — confirm' : 'Clear'}
          </button>
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
      {/*
        Two panes that sit beside each other when both fit at the field's true
        width and stack when they do not -- pdf-bullets' layout. Never scaled:
        the boxes are the form's real size or they are nothing. On a screen too
        narrow for even one, the pane scrolls sideways rather than clipping.
      */}
      <div className="flex flex-wrap items-start gap-3">
        {/* Draft */}
        <section className="panel flex min-w-0 flex-col p-4" style={paneStyle}>
          <div className="mb-3 flex items-start justify-between gap-4">
            <div>
              <h2 className="title m-0">Draft</h2>
              <p className="m-0 mt-1 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                Enter your bullet below.
              </p>
            </div>
            <span className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
              {counterText}
            </span>
          </div>

          {/*
            Same field width and same face as the output, so the two panes can
            be read across: the draft wraps where the form wraps, the output
            does not, and the difference is the point.
          */}
          <FieldBox widthMm={targetMm} type={previewType} minHeight={BOX_MIN_HEIGHT} reflow={narrow}>
            <div className="relative">
              {/*
                The mirror is the in-flow element and the textarea is laid over
                it, so the box grows with the draft instead of scrolling inside
                itself. The mirror also carries the duplicate marks behind the
                transparent textarea -- identical type keeps them on the glyphs
                -- and gives each line an element whose height can be read.
              */}
              <div
                ref={draftMirrorRef}
                aria-hidden
                className="pointer-events-none"
                style={{
                  ...previewType,
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'break-word',
                  color: 'transparent',
                  minHeight: BOX_MIN_HEIGHT,
                }}
              >
                {lines.map((line, i) => (
                  <div key={i}>
                    {line === '' ? (
                      '\u00a0'
                    ) : showDuplicates ? (
                      <DuplicateMarks text={line} colours={duplicateColour} />
                    ) : (
                      line
                    )}
                  </div>
                ))}
              </div>
              <textarea
                ref={inputRef}
                value={text}
                onChange={(e) => {
                  // A paste of shaped output arrives here with its half
                  // spaces. The draft holds plain spaces only; the output
                  // is where shaping shows. Same length, so the caret holds.
                  setText(plainSpaces(e.target.value));
                  syncActiveLine(e.currentTarget);
                }}
                onSelect={(e) => syncActiveLine(e.currentTarget)}
                spellCheck
                aria-label="Draft"
                placeholder="Paste or type your statement."
                className="absolute inset-0 block h-full w-full resize-none overflow-hidden border-0 bg-transparent p-0 outline-none"
                style={{ ...previewType, color: 'var(--ink)' }}
              />
            </div>
          </FieldBox>

          <div
            className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-t pt-3 text-[12px]"
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
            <span className="util" title="Saved in this browser only, never uploaded">
              Saved in this browser
            </span>
            <span style={{ color: 'var(--rule-strong)' }}>|</span>
            <span style={{ color: 'var(--ink-muted)' }}>
              Formatting:{' '}
              <span style={{ color: needsNormalizing ? 'var(--warn)' : 'var(--ok)' }}>
                {needsNormalizing ? 'Irregular' : 'Normalized'}
              </span>
            </span>
          </div>
        </section>

        {/* Output */}
        <section className="panel flex min-w-0 flex-col p-4" style={paneStyle}>
          <div className="mb-3 flex items-start justify-between gap-4">
            <div>
              <h2 className="title m-0">Output</h2>
              <p className="m-0 mt-1 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                Optimized to fit on one line using half-spaces.
              </p>
            </div>
            <span
              className="text-[13px]"
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
          <FieldBox widthMm={targetMm} type={previewType} minHeight={BOX_MIN_HEIGHT} reflow={narrow}>
            {!measurable ? (
              <p className="util m-0">{font ? 'No target width' : 'Loading'}</p>
            ) : (
              results.map((bullet, index) => {
                const level = { minHeight: lineHeights[index] };
                const result = bullet.whole;
                if (result.status === 'empty') {
                  return (
                    <div key={index} style={level}>
                      &nbsp;
                    </div>
                  );
                }
                const statuses = rowVerdicts[index]!;
                const bad = statuses.some((s) => !landed(s));
                const rows = displayRows(bullet, autoSpace, font!, { targetMm, sizePt });
                // Auto-Space off can draw more rows than were judged; then the
                // verdict is the bullet's, not the row's.
                const rowBad = (r: number) =>
                  rows.length === statuses.length ? !landed(statuses[r]!) : bad;
                const title = !font
                  ? undefined
                  : bullet.wrapped && autoSpace
                    ? `Takes ${rows.length} rows on the form. ${
                        diagnose(result, { font, sizePt, abbreviations: suggestionTable })
                          ?.message ?? ''
                      }`.replace("Can't reach flush. ", 'For one row: ')
                    : !bad
                      ? undefined
                      : autoSpace
                        ? (diagnose(result, { font, sizePt, abbreviations: suggestionTable })
                            ?.message ?? undefined)
                        : `Auto-Space is off. As typed, this line is ${roundMm(
                            Math.abs(result.naturalWidthMm - result.targetMm),
                            1,
                          )}mm ${statuses.includes('too-long') ? 'over' : 'short'}.`;
                return (
                  <div
                    key={index}
                    title={title}
                    onMouseDown={() => setActiveLine(index)}
                    style={level}
                  >
                    {rows.map((row, r) => (
                      <div
                        key={r}
                        // At true width the row is already broken by our own
                        // metrics and must not be re-wrapped. Reflowed, it has
                        // to wrap or it runs off the phone.
                        style={{
                          whiteSpace: narrow ? 'pre-wrap' : 'pre',
                          color: rowBad(r) ? 'var(--bad)' : 'var(--ink)',
                        }}
                      >
                        {row}
                      </div>
                    ))}
                  </div>
                );
              })
            )}
          </FieldBox>

          <div
            className="mt-3 border-t pt-3 text-[12px]"
            style={{ borderColor: 'var(--rule)' }}
          >
            {narrow && (
              <span className="util mr-3" title="The form field is wider than this screen">
                not to scale
              </span>
            )}
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

      {/* ---- Review ------------------------------------------------------ */}
      {/*
        Its own box, reading the same draft. Every finding is a place in the
        draft; clicking one puts the caret there, and clicking again walks to
        the next occurrence. The fix happens in the draft, and the shaper
        follows -- there is nothing to paste back.
      */}
      <section className="panel p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="title m-0">Review</h2>
          <span className="util">
            {liveLines === 0
              ? 'Nothing to review'
              : findings.length === 0
                ? 'Nothing flagged'
                : `${findings.length} finding${findings.length === 1 ? '' : 's'}`}
          </span>
        </div>
        <p className="m-0 mt-1 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
          Repeated words, weak openers, bullets with no number, and acronyms on neither
          list. Click a finding to go to it in the draft.
        </p>
        {findings.length > 0 && (
          <ul className="m-0 mt-3 flex list-none flex-col gap-1.5 p-0">
            {findings.map((finding) => (
              <li key={`${finding.kind}:${finding.token}:${finding.occurrences[0]!.start}`}>
                <button
                  type="button"
                  onClick={() => jumpTo(finding)}
                  className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 border px-3 py-2 text-left text-[12px]"
                  style={{
                    background: 'var(--panel-sunk)',
                    borderColor: 'var(--rule)',
                    color: 'var(--ink)',
                  }}
                >
                  <span
                    className="util shrink-0"
                    style={{
                      color: finding.kind === 'no-number' ? 'var(--ink-faint)' : 'var(--warn)',
                      minWidth: '7.5em',
                    }}
                  >
                    {KIND_LABEL[finding.kind]}
                  </span>
                  <span className="tabular shrink-0" style={{ color: 'var(--ink-faint)' }}>
                    line {finding.occurrences[0]!.line + 1}
                    {finding.occurrences.length > 1 ? ` +${finding.occurrences.length - 1}` : ''}
                  </span>
                  <span
                    style={{
                      fontWeight: 600,
                      background:
                        finding.kind === 'repeat'
                          ? duplicateColour.get(finding.token.split(' / ')[0]!.toLowerCase())
                          : undefined,
                      padding: finding.kind === 'repeat' ? '0 4px' : undefined,
                      borderRadius: 2,
                    }}
                  >
                    {finding.token}
                  </span>
                  <span style={{ color: 'var(--ink-muted)' }}>{finding.message}</span>
                  {finding.suggestions.length > 0 && (
                    <span style={{ color: 'var(--ink-muted)' }}>
                      Try: {finding.suggestions.join(', ')}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

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
              <span className="text-[13px]" style={{ color: 'var(--ink)' }}>
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
            <p className="m-0 mt-1.5 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
              {definition
                ? definition.text
                : synonymData
                  ? 'No definition available for this word.'
                  : 'Loading word list\u2026'}
            </p>
          </div>
        )}

        {selectionRepeats > 1 && (
          <p className="m-0 mt-2 text-[12px]" style={{ color: 'var(--warn)' }}>
            "{selection?.word}" appears {selectionRepeats} times in this draft.
          </p>
        )}

        {!selection ? (
          <p className="m-0 mt-3 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
            Highlight or click a word on the left. Replacements are listed shortest first,
            with the width each one adds or saves.
          </p>
        ) : options.length === 0 ? (
          <p className="m-0 mt-3 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
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
 * pdf-bullets' box: the field width plus one millimetre, border-box, with a
 * 1.1px border and no padding, so the text starts at the box edge.
 *
 * CSS `mm` is a fixed 96dpi unit, so the field is always the same pixel width
 * regardless of window size, and the box is drawn at that width or not at
 * all. It is never scaled: scaling shrinks the type and the spacing with it,
 * and the whole point of the box is that what you see is the form's size.
 */
function FieldBox({
  widthMm,
  type,
  minHeight,
  /**
   * Reflow instead of drawing at the field's true width.
   *
   * On a phone the field is wider than the screen. Reflowing gives up the
   * "wraps here means wraps on the form" property in exchange for text you can
   * read; the status readout still carries the verdict, and it never depended
   * on the drawing.
   */
  reflow = false,
  children,
}: {
  widthMm: number;
  type: React.CSSProperties;
  minHeight: number;
  reflow?: boolean;
  children: React.ReactNode;
}) {
  const trueWidth = widthMm > 0 && !reflow;
  return (
    <div
      style={{
        ...type,
        boxSizing: 'border-box',
        width: trueWidth ? ((widthMm + 1) / 25.4) * 96 : '100%',
        border: '1.1px solid var(--ink)',
        padding: 0,
        background: 'var(--panel-sunk)',
        minHeight,
        // Reflowed rows must be allowed to wrap; at true width they are
        // pre-wrapped by our own metrics and must not be re-wrapped.
        whiteSpace: reflow ? 'pre-wrap' : undefined,
        overflowWrap: reflow ? 'break-word' : undefined,
      }}
    >
      {children}
    </div>
  );
}

function Field({
  label,
  style,
  children,
}: {
  label: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5" style={style}>
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

/** The highlighter palette, as token suffixes: --hl-a through --hl-h. */
const HIGHLIGHT_KEYS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;

/**
 * Highlighter marks behind the draft. Every occurrence of a repeated word
 * gets that word's colour, inflections included, so a glance shows which
 * words are the same word.
 */
function DuplicateMarks({
  text,
  colours,
}: {
  text: string;
  colours: ReadonlyMap<string, string>;
}) {
  if (colours.size === 0) return <>{text}</>;

  const parts = text.split(/([A-Za-z][A-Za-z'’-]*)/g);
  return (
    <>
      {parts.map((part, i) => {
        const colour = colours.get(part.toLowerCase());
        if (colour === undefined) return part;
        return (
          <span key={i} style={{ background: colour, borderRadius: 2 }}>
            {part}
          </span>
        );
      })}
    </>
  );
}
